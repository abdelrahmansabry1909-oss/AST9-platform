-- ════════════════════════════════════════════════════════════════
--  Phase R2D-1 — Workout Session Auto-Finish (stale session timeout)
--
--  Problem: a workout session is created with status='active' and is only
--  closed when the client taps finish/abandon. If the client leaves the app
--  mid-workout, the row stays 'active' forever (the UI shows an infinite
--  running workout).
--
--  Rule (owner): if a session is status='active' AND ended_at IS NULL AND
--  started_at < now() - interval '2 hours', auto-finish it: mark it
--  'abandoned', stamp the end metadata, and tag end_reason='auto_finished_2h'
--  so the UI can show "Auto-finished after 2h" distinctly from a manual abandon.
--
--  This migration is ADDITIVE and does three things:
--   1. Adds a nullable workout_sessions.end_reason text column (no backfill, no
--      CHECK — the existing status model 'active'/'completed'/'abandoned' is
--      UNCHANGED; auto-finished sessions reuse the existing 'abandoned' status).
--   2. Adds two SECURITY DEFINER sweep functions (search_path pinned):
--        • expire_my_stale_workout_sessions()  — app-callable, scoped to the
--          caller's own / assigned-client sessions (boot / workout-open cleanup).
--        • expire_stale_workout_sessions_all() — cron-only global sweep.
--   3. Schedules an hourly pg_cron job to call the global sweep.
--
--  EXPIRY (both functions, identical row effect):
--     status           = 'abandoned'
--     ended_at         = least(now(), started_at + interval '2 hours')
--     duration_seconds = extract(epoch from (ended_at - started_at))::int
--     end_reason       = 'auto_finished_2h'
--   For a stale row started_at+2h < now(), so ended_at is pinned to the moment
--   it SHOULD have finished (deterministic; not the random cron tick time).
--
--  UNCHANGED / PRESERVED (explicitly NOT touched):
--   • workout_exercise_logs — never updated or deleted; completed logs are kept.
--     (Sessions are UPDATEd in place, never deleted; the ON DELETE CASCADE on
--     logs is irrelevant because no session is deleted.)
--   • workout_sessions_status_check — NOT altered ('abandoned' already allowed).
--   • client_programs / client_program_versions / client_program_revisions —
--     not referenced.
--   • profiles / auth / legal / Athletic / subscription objects — not touched.
--   • Existing cron jobs (subscription-checker-daily, pulse-alerts-daily) — only
--     the named 'expire-stale-workouts-hourly' job is added (idempotently).
--
--  The single existing stale row (1 session, 0 logs) is cleaned by the first
--  hourly run — no manual data repair is performed in this migration.
--
--  Additive · idempotent · reversible · RLS-safe · no destructive data change.
--  Rollback: supabase/rollbacks/20260629160000_workout_session_auto_expire_down.sql
--
--  Depends on (pre-existing, live):
--   • public.workout_sessions (20260530202413 — workout_tracking)
--   • public.profiles(id, assigned_coach), public.is_admin()
--   • pg_cron (cron schema; already used by jobs 1–2)
-- ════════════════════════════════════════════════════════════════

-- ── 1. Add nullable end_reason column (no backfill, no CHECK) ─────
alter table public.workout_sessions
  add column if not exists end_reason text;

-- ── 2a. App-callable scoped sweep ────────────────────────────────
--    Called by the frontend on app boot / workout open. SECURITY DEFINER so it
--    can write the status, but the WHERE clause restricts the effect to the
--    authenticated caller's own sessions (client) or their assigned/owning
--    clients (coach) or all (admin). A non-assigned coach affects 0 rows.
create or replace function public.expire_my_stale_workout_sessions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  with expired as (
    update public.workout_sessions s
       set status           = 'abandoned',
           ended_at         = least(now(), s.started_at + interval '2 hours'),
           duration_seconds = extract(epoch from (least(now(), s.started_at + interval '2 hours') - s.started_at))::int,
           end_reason       = 'auto_finished_2h'
     where s.status = 'active'
       and s.ended_at is null
       and s.started_at < now() - interval '2 hours'
       and (
            s.client_id = v_uid
         or public.is_admin()
         or s.coach_id = v_uid
         or exists (
              select 1 from public.profiles p
              where p.id = s.client_id and p.assigned_coach = v_uid
            )
       )
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

revoke all on function public.expire_my_stale_workout_sessions() from public, anon;
grant execute on function public.expire_my_stale_workout_sessions() to authenticated;

-- ── 2b. Cron-only global sweep ───────────────────────────────────
--    No auth.uid() scope (runs in the trusted cron/postgres context). Execute is
--    revoked from public, anon AND authenticated — only the owner role (postgres,
--    which the hourly cron job runs as) can invoke it. Same row effect as 2a.
create or replace function public.expire_stale_workout_sessions_all()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  with expired as (
    update public.workout_sessions s
       set status           = 'abandoned',
           ended_at         = least(now(), s.started_at + interval '2 hours'),
           duration_seconds = extract(epoch from (least(now(), s.started_at + interval '2 hours') - s.started_at))::int,
           end_reason       = 'auto_finished_2h'
     where s.status = 'active'
       and s.ended_at is null
       and s.started_at < now() - interval '2 hours'
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

revoke all on function public.expire_stale_workout_sessions_all() from public, anon, authenticated;

-- ── 3. Hourly pg_cron sweep (idempotent; leaves other jobs alone) ─
--    Re-create only the named job; do not disturb jobs 1–2.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire-stale-workouts-hourly') then
    perform cron.unschedule('expire-stale-workouts-hourly');
  end if;
end $$;

select cron.schedule(
  'expire-stale-workouts-hourly',
  '0 * * * *',
  $cron$select public.expire_stale_workout_sessions_all();$cron$
);

-- ── Smoke (after apply) ──────────────────────────────────────────
--   seed: insert a workout_sessions row status='active', started_at=now()-3h
--   select public.expire_stale_workout_sessions_all();   -> returns >=1
--   that row                                             -> status='abandoned',
--       ended_at=started_at+2h, duration_seconds=7200, end_reason='auto_finished_2h'
--   its workout_exercise_logs                            -> unchanged (none deleted)
--   a status='active' row started_at=now()-30m           -> NOT touched (under 2h)
--   client impersonated: expire_my_stale_workout_sessions() affects only own row
--   non-assigned coach: expire_my_stale_workout_sessions() returns 0
--   cron.job                                             -> 3 jobs (subs, pulse, expire)
--   workout_sessions_status_check                        -> still ('active','completed','abandoned')
