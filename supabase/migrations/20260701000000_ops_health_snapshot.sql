-- ════════════════════════════════════════════════════════════════
--  Phase P1A — Ops Health Snapshot (cron / edge dispatch health)
--
--  Problem this closes (the S7 class of silent failure): a pg_cron job can
--  record status='succeeded' in cron.job_run_details because net.http_post
--  DISPATCHED the request, while the edge function itself returned 401/500.
--  Dispatch success != HTTP success. There is currently no owner-callable way
--  to see whether the expected jobs are present, active, running on time, and
--  whether recent edge HTTP calls actually returned 2xx.
--
--  This migration is ADDITIVE and creates ONE read-only, admin-only reporting
--  function that returns a jsonb snapshot:
--    public.ops_health_snapshot() → jsonb
--
--  It reports, for each EXPECTED job (fixed list, so a MISSING job is caught):
--    jobname, present, active, schedule, expected_interval_min,
--    last_run_at, last_run_status, minutes_since_last, stale, healthy, reason
--  Plus a best-effort GLOBAL edge-HTTP summary (see safety note below):
--    last_status, last_at, non_2xx_last_24h, timed_out_last_24h
--
--  ── SECURITY / PRIVACY (what it deliberately NEVER returns) ──────
--   • NO secrets, NO tokens, NO Vault values.
--   • NO request headers or bodies. It NEVER reads net.http_request_queue —
--     that table's `headers` jsonb holds the x-cron-secret request header.
--   • NO response headers/content/error_msg text. From net._http_response it
--     reads ONLY status_code / created / timed_out.
--   • NO cron command / return_message / username. From cron.job_run_details it
--     reads ONLY jobid / status / start_time / end_time.
--   • NO user / client / health data of any kind.
--
--  ── Retention caveat ────────────────────────────────────────────
--   pg_net prunes net._http_response within hours, so daily-job HTTP responses
--   are usually already gone by check time; the edge_http block is therefore a
--   BEST-EFFORT, NON-attributed signal (global across cron + app edge calls).
--   Per-job HTTP attribution is DEFERRED on purpose (it would require
--   net.http_request_queue.url, which co-locates the secret request headers).
--
--  ── Authorization ──────────────────────────────────────────────
--   SECURITY DEFINER + pinned search_path; execute revoked from public/anon,
--   granted to authenticated, and the body raises 42501 unless the caller is
--   the owner/admin (public.is_admin()). Single-admin model: only the owner
--   passes is_admin(). A future GitHub Action must NOT use service_role; a
--   secure caller strategy is documented in docs/INCIDENT_RESPONSE.md and is
--   intentionally NOT built in this migration.
--
--  Additive · idempotent · reversible · read-only (no data writes).
--  Rollback: supabase/rollbacks/20260701000000_ops_health_snapshot_down.sql
--
--  Depends on (pre-existing, live): cron.job, cron.job_run_details (pg_cron),
--  net._http_response (pg_net), public.is_admin().
-- ════════════════════════════════════════════════════════════════

create or replace function public.ops_health_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_jobs    jsonb;
  v_edge    jsonb;
  v_overall boolean;
begin
  -- Owner/admin only (single-admin model). No cross-user information leak.
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- ── Per-expected-job DISPATCH health (from cron.* only) ─────────
  with expected(jobname, expected_interval_min) as (
    values
      ('subscription-checker-daily',   1440),
      ('pulse-alerts-daily',           1440),
      ('expire-stale-workouts-hourly',   60)
  ),
  jobrow as (
    select
      e.jobname,
      e.expected_interval_min,
      j.jobid,
      (j.jobid is not null)     as present,
      coalesce(j.active, false) as active,
      j.schedule,
      lr.last_run_at,
      lr.last_run_status
    from expected e
    left join cron.job j on j.jobname = e.jobname
    left join lateral (
      select coalesce(d.end_time, d.start_time) as last_run_at,
             d.status                           as last_run_status
      from cron.job_run_details d
      where d.jobid = j.jobid
      order by coalesce(d.end_time, d.start_time) desc nulls last
      limit 1
    ) lr on true
  ),
  calc as (
    select
      jobname, expected_interval_min, present, active, schedule,
      last_run_at, last_run_status,
      case when last_run_at is null then null
           else floor(extract(epoch from (now() - last_run_at)) / 60)::int
      end as minutes_since_last,
      case
        when last_run_at is null then true
        when extract(epoch from (now() - last_run_at)) / 60
             > (expected_interval_min * 1.5 + 15) then true
        else false
      end as stale
    from jobrow
  )
  select jsonb_agg(
           jsonb_build_object(
             'jobname',               jobname,
             'present',               present,
             'active',                active,
             'schedule',              schedule,
             'expected_interval_min', expected_interval_min,
             'last_run_at',           last_run_at,
             'last_run_status',       last_run_status,
             'minutes_since_last',    minutes_since_last,
             'stale',                 stale,
             'healthy',               (present and active and not stale
                                       and last_run_status = 'succeeded'),
             'reason',
               case
                 when not present then 'job missing from cron.job'
                 when not active  then 'job inactive'
                 when last_run_at is null then 'no run recorded'
                 when stale then 'stale: no dispatch within expected window'
                 when last_run_status is distinct from 'succeeded'
                   then 'last dispatch status: ' || coalesce(last_run_status, 'unknown')
                 else 'ok'
               end
           )
           order by jobname
         )
    into v_jobs
    from calc;

  -- ── GLOBAL edge-HTTP summary (best-effort; SAFE columns only) ───
  --  Reads ONLY status_code / created / timed_out from net._http_response.
  --  NEVER touches net.http_request_queue (secret headers) and NEVER returns
  --  response headers / content / error_msg. Wrapped so a net read failure
  --  degrades gracefully instead of breaking the whole snapshot.
  begin
    select jsonb_build_object(
             'available', true,
             'last_status',
               (select r.status_code from net._http_response r
                 order by r.created desc nulls last limit 1),
             'last_at',
               (select r.created from net._http_response r
                 order by r.created desc nulls last limit 1),
             'non_2xx_last_24h',
               (select count(*) from net._http_response r
                 where r.created > now() - interval '24 hours'
                   and (r.status_code is null or r.status_code < 200 or r.status_code >= 300)),
             'timed_out_last_24h',
               (select count(*) from net._http_response r
                 where r.created > now() - interval '24 hours'
                   and r.timed_out is true),
             'note', 'Global pg_net responses (cron + app edge calls). '
                     || 'Best-effort, short retention, not attributed per job. '
                     || 'No headers/body/secret exposed.'
           )
      into v_edge;
  exception when others then
    v_edge := jsonb_build_object(
                'available', false,
                'note', 'net._http_response not readable in this context');
  end;

  select bool_and((x ->> 'healthy')::boolean)
    into v_overall
    from jsonb_array_elements(coalesce(v_jobs, '[]'::jsonb)) x;

  return jsonb_build_object(
    'generated_at',    now(),
    'overall_healthy', coalesce(v_overall, false),
    'jobs',            coalesce(v_jobs, '[]'::jsonb),
    'edge_http',       v_edge
  );
end;
$fn$;

revoke all     on function public.ops_health_snapshot() from public, anon;
grant  execute on function public.ops_health_snapshot() to authenticated;

-- ── Smoke (after apply, owner-approved separate phase) ───────────
--   owner/admin  → select public.ops_health_snapshot();  -> jsonb, 3 jobs
--   non-admin    → select public.ops_health_snapshot();  -> 42501 not authorized
--   anon         → execute                               -> denied (revoked)
--   returned jsonb contains NO headers/body/tokens/vault/user data
