-- ════════════════════════════════════════════════════════════════
--  Phase P1B-SQL — Service-role Ops Health system path
--
--  Why: the future `ops-health` Edge Function will run with the service role
--  and NO user JWT. The live admin function public.ops_health_snapshot() is
--  gated by public.is_admin(), which resolves auth.uid() — null for a
--  service-role call — so the edge path can never pass that gate. This
--  migration adds a SEPARATE service-role-only path so the edge wrapper can
--  read the SAME safe health snapshot, WITHOUT touching or weakening the
--  already-live, admin-gated public.ops_health_snapshot().
--
--  This migration is ADDITIVE and creates exactly two functions:
--    1. public.ops_health_snapshot_system() → jsonb
--         Same safe data shape as public.ops_health_snapshot() but WITHOUT the
--         is_admin() gate. Execute revoked from public/anon/authenticated and
--         granted ONLY to service_role (postgres owns it implicitly). It is
--         therefore NOT browser-reachable (anon/authenticated cannot call it).
--    2. public.verify_ops_health_secret(p_secret text) → boolean
--         Vault-backed secret check mirroring public.verify_cron_secret():
--         compares the caller-supplied value against the Vault secret
--         'ops_health_secret' IN-DB and returns only a boolean. service_role
--         only. It does NOT create the Vault secret (the owner creates
--         'ops_health_secret' out-of-band later), never returns/logs the secret,
--         and returns false (never raises) for null/empty/missing input.
--
--  ── SECURITY / PRIVACY (unchanged from the admin function's guarantees) ──
--   • NO secrets/tokens/Vault values returned. verify_ops_health_secret reads
--     vault.decrypted_secrets ONLY to compare, and returns only true/false.
--   • ops_health_snapshot_system NEVER reads net.http_request_queue (its
--     `headers` hold the x-cron-secret). From net._http_response it reads ONLY
--     status_code / created / timed_out. From cron.job_run_details it reads
--     ONLY jobid / status / start_time / end_time. No response headers/content/
--     error_msg, no cron command/return_message, no user/client/health data.
--
--  ── EXPLICITLY NOT TOUCHED ──
--   • public.ops_health_snapshot() (the live admin function) — unchanged.
--   • No tables/columns/RLS policies/cron jobs created or altered.
--   • No Vault secret created. No app data written.
--
--  Additive · idempotent · reversible · read-only (no data writes).
--  Rollback: supabase/rollbacks/20260701120000_ops_health_system_down.sql
--
--  Depends on (pre-existing, live): cron.job, cron.job_run_details (pg_cron),
--  net._http_response (pg_net), vault.decrypted_secrets (Supabase Vault).
-- ════════════════════════════════════════════════════════════════

-- ── 1. Service-role-only health snapshot (no is_admin gate) ──────
--    Body is the same safe snapshot as public.ops_health_snapshot(); the ONLY
--    difference is the absence of the admin gate (access is instead restricted
--    purely by the service_role-only EXECUTE grant below).
create or replace function public.ops_health_snapshot_system()
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
  -- Per-expected-job DISPATCH health (from cron.* only)
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

  -- GLOBAL edge-HTTP summary (best-effort; SAFE columns only).
  -- Reads ONLY status_code / created / timed_out from net._http_response.
  -- NEVER touches net.http_request_queue (secret headers) and NEVER returns
  -- response headers / content / error_msg.
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

revoke all     on function public.ops_health_snapshot_system() from public, anon, authenticated;
grant  execute on function public.ops_health_snapshot_system() to service_role;

-- ── 2. Service-role-only Vault secret checker ────────────────────
--    Mirrors public.verify_cron_secret(): compares the supplied value against
--    the Vault secret 'ops_health_secret' in-DB and returns only a boolean.
--    Guards null/empty BEFORE reading Vault so it never raises on bad input.
--    Does NOT create the secret (owner adds 'ops_health_secret' out-of-band).
create or replace function public.verify_ops_health_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select case
    when p_secret is null or length(p_secret) = 0 then false
    else exists (
      select 1 from vault.decrypted_secrets
      where name = 'ops_health_secret'
        and decrypted_secret = p_secret
    )
  end;
$fn$;

revoke all     on function public.verify_ops_health_secret(text) from public, anon, authenticated;
grant  execute on function public.verify_ops_health_secret(text) to service_role;

-- ── Smoke (after apply, owner-approved separate phase) ───────────
--   service_role → select public.ops_health_snapshot_system();   -> jsonb, 3 jobs
--   authenticated/anon → same call                               -> permission denied (revoked)
--   admin public.ops_health_snapshot() STILL works + non-admin 42501 (regression)
--   verify_ops_health_secret(null) / ('')                        -> false (no vault read)
--   verify_ops_health_secret('wrong')                            -> false
--   verify_ops_health_secret(<vault value>)                      -> true (after owner seeds it)
--   returned jsonb contains NO headers/body/tokens/vault/user data
