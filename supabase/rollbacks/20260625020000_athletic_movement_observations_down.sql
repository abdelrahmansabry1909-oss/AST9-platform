-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK for: 20260625020000_athletic_movement_observations.sql
-- Phase F3B — Athletic Movement Observations
--
-- Lives OUTSIDE supabase/migrations/ on purpose so it is never auto-applied
-- as a forward migration. Run it manually (SQL editor or MCP execute_sql) to
-- revert F3B.
--
-- Fully reversible · drops ONLY the objects this migration created. Touches NO
-- existing table — athlete_assessments, athlete_test_results, athlete_profiles,
-- assessment_batteries, profiles, rehab assessments / body-map / gait,
-- client_programs, client_program_versions, workout_sessions and
-- workout_exercise_logs are all untouched (referenced only by FK, removed with
-- the child table).
--
-- Does NOT drop public.tg_athletic_touch() — that touch function is shared with
-- and still used by the F2 tables (athlete_profiles, assessment_batteries,
-- athlete_assessments, athlete_test_results).
-- ═══════════════════════════════════════════════════════════════

-- 1. Drop the trigger (defensive — dropping the table drops it anyway).
drop trigger if exists trg_movement_observations_touch on public.athletic_movement_observations;

-- 2. Drop the policy (defensive — dropping the table drops it anyway).
drop policy if exists "movement_observations_all" on public.athletic_movement_observations;

-- 3. Drop the table (cascade clears its FKs + indexes).
drop table if exists public.athletic_movement_observations cascade;

-- NOTE: public.tg_athletic_touch() is intentionally NOT dropped — it is the
-- shared F2 touch function still relied on by the F2 athletic tables.
