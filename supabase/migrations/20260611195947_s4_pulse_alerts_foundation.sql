-- ════════════════════════════════════════════════════════════════════
-- S4 — Recovery Pulse proactive alerts: foundation (gate 2 of 5)
-- ════════════════════════════════════════════════════════════════════
-- Per S4_AND_REFERRALS_PLANNING.md §1.2–1.4. Additive automation layer:
-- the classifier (v_client_pulse) is NOT touched; notify() remains the
-- only insert path into notifications.
--
-- 1) fn_pulse_for_alerts() — the cron feed. v_client_pulse is
--    security_invoker with a literal caller-scoping WHERE, so the
--    service role sees 0 rows. Rather than duplicating the classifier
--    SQL (rejected: two copies drift), this SECURITY DEFINER function
--    sets transaction-local JWT claims to a real admin id and selects
--    from the view — the admin branch opens and the single classifier
--    stays the single source of truth. EXECUTE is revoked from all
--    client roles; only service_role (the cron edge fn) may call it.
--
-- 2) pulse_alert_state — per-client transition memory: what we last
--    saw, whether a risk episode is open, and what we last alerted on.
--    This is what makes alerts transition-based and episode-deduped
--    ("one risk episode = one alert", no daily repeats).
--
-- 3) pulse_alert_log — append-only audit of every alert actually sent
--    (recipients + reasons), used by verification and future calibration.
--
-- RLS: both tables admin-read-only; no client-role write policies at
-- all (the edge fn writes via service role, which bypasses RLS).
-- Rollback: rollbacks/20260611195947_s4_pulse_alerts_foundation_down.sql

create table public.pulse_alert_state (
  client_id          uuid primary key references public.profiles(id) on delete cascade,
  last_status        text not null,
  last_severity      int  not null,
  episode_active     boolean not null default false,
  episode_started_at timestamptz,
  last_alerted_status text,
  last_alerted_at    timestamptz,
  updated_at         timestamptz not null default now()
);

create table public.pulse_alert_log (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.profiles(id) on delete cascade,
  pulse_status text not null,
  severity     int  not null,
  recipients   uuid[] not null,
  reasons      text[] not null default '{}',
  created_at   timestamptz not null default now()
);

alter table public.pulse_alert_state enable row level security;
alter table public.pulse_alert_log   enable row level security;

create policy pulse_alert_state_admin_read on public.pulse_alert_state
  for select using ((select public.is_admin()));
create policy pulse_alert_log_admin_read on public.pulse_alert_log
  for select using ((select public.is_admin()));

create or replace function public.fn_pulse_for_alerts()
returns table (
  client_id           uuid,
  pulse_status        text,
  severity            int,
  reasons             text[],
  churn_risk          boolean,
  effective_status    text,
  days_since_activity int,
  adherence_7d        numeric
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is null then
    return;  -- no admin: nothing can be scoped, return empty
  end if;
  -- Transaction-local claims (is_local => true): auth.uid() resolves to the
  -- admin for the remainder of THIS transaction only, opening the view's
  -- admin branch. The single classifier is reused, never copied.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text,
    true
  );
  return query
    select v.client_id, v.pulse_status, v.severity::int, v.reasons,
           v.churn_risk, v.effective_status, v.days_since_activity, v.adherence_7d
    from public.v_client_pulse v;
end;
$$;

revoke all on function public.fn_pulse_for_alerts() from public;
revoke all on function public.fn_pulse_for_alerts() from anon;
revoke all on function public.fn_pulse_for_alerts() from authenticated;
grant execute on function public.fn_pulse_for_alerts() to service_role;
