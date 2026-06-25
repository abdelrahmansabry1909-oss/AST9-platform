-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK for: 20260625000000_athletic_assessment_foundation.sql
-- Phase F2B — Athletic Performance assessment foundation
--
-- Lives OUTSIDE supabase/migrations/ on purpose so it is never auto-applied
-- as a forward migration. Run it manually (SQL editor or MCP execute_sql) to
-- revert F2B.
--
-- Fully reversible · additive-only original · drops ONLY the objects this
-- migration created. Touches NO existing table — profiles, rehab assessments,
-- client_programs, client_program_versions, workout_sessions, and
-- workout_exercise_logs are all untouched (referenced only by FK, removed with
-- the child tables). Seeded default batteries are removed with their table.
-- ═══════════════════════════════════════════════════════════════

-- Drop policies first (defensive — dropping the tables drops them anyway).
drop policy if exists "results_all"        on public.athlete_test_results;
drop policy if exists "assessments_all"    on public.athlete_assessments;
drop policy if exists "batteries_select"   on public.assessment_batteries;
drop policy if exists "batteries_insert"   on public.assessment_batteries;
drop policy if exists "batteries_update"   on public.assessment_batteries;
drop policy if exists "batteries_delete"   on public.assessment_batteries;
drop policy if exists "athlete_profiles_all" on public.athlete_profiles;

-- Drop tables (children first; cascade clears FKs + indexes + touch triggers).
drop table if exists public.athlete_test_results cascade;
drop table if exists public.athlete_assessments cascade;
drop table if exists public.assessment_batteries cascade;
drop table if exists public.athlete_profiles    cascade;

-- Drop the shared touch function (no other dependents — created by this migration).
drop function if exists public.tg_athletic_touch();
