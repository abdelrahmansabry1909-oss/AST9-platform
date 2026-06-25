-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK for: 20260625010000_athletic_assessment_index_rls_fix.sql
-- Phase F2B-Fix — Athletic Assessment index + default-battery RLS cleanup
--
-- Lives OUTSIDE supabase/migrations/ on purpose so it is never auto-applied
-- as a forward migration. Run it manually (SQL editor or MCP execute_sql) to
-- revert F2B-Fix.
--
-- Reverts to the post-F2C state:
--   1. Drops the two indexes this migration added.
--   2. Restores the prior batteries_select policy (default batteries readable
--      by any authenticated user).
--
-- Alters NO data, drops NO table, touches NO rehab / program / versioning /
-- workout-logging table. The athlete_assessments / assessment_batteries tables
-- themselves remain (they belong to the foundation migration, not this one).
-- ═══════════════════════════════════════════════════════════════

-- 1. Drop the indexes added by F2B-Fix.
drop index if exists public.idx_athlete_assessments_client;
drop index if exists public.idx_athlete_assessments_coach;

-- 2. Restore the previous (foundation) batteries_select behavior.
drop policy if exists "batteries_select" on public.assessment_batteries;
create policy "batteries_select" on public.assessment_batteries
  for select to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or is_default = true
  );
