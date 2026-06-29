-- ════════════════════════════════════════════════════════════════
--  Rollback — Phase R2D-1 Workout Session Auto-Finish
--  Reverses supabase/migrations/20260629160000_workout_session_auto_expire.sql
--
--  Drops ONLY the objects this migration created:
--   1. Unschedules ONLY the 'expire-stale-workouts-hourly' cron job (the other
--      jobs — subscription-checker-daily, pulse-alerts-daily — are left intact).
--   2. Drops the two sweep functions.
--   3. Drops the end_reason column.
--
--  Already auto-finished sessions are NOT reverted: they remain a correct
--  terminal state (status='abandoned', ended_at set). Dropping end_reason only
--  removes the 'auto_finished_2h' tag; status/ended_at/duration are unchanged.
--  No workout log, program, profile, auth, legal, Athletic, or subscription
--  object is touched.
-- ════════════════════════════════════════════════════════════════

-- 1. Unschedule only our job (guarded — no error if already gone).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire-stale-workouts-hourly') then
    perform cron.unschedule('expire-stale-workouts-hourly');
  end if;
end $$;

-- 2. Drop the functions created by this migration.
drop function if exists public.expire_stale_workout_sessions_all();
drop function if exists public.expire_my_stale_workout_sessions();

-- 3. Drop the column added by this migration.
alter table public.workout_sessions
  drop column if exists end_reason;
