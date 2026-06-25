-- ════════════════════════════════════════════════════════════════
--  Phase F2B-Fix — Athletic Assessment: index + default-battery RLS cleanup
--
--  Two non-blocking follow-ups to 20260625000000_athletic_assessment_foundation:
--
--   1. Missing indexes on athlete_assessments. The foundation's
--      idx_assessments_client / idx_assessments_coach were SILENTLY SKIPPED —
--      Postgres index names are schema-unique and those names already exist on
--      the rehab `assessments` table, so CREATE INDEX IF NOT EXISTS matched them
--      and no-op'd (the rehab table was NOT modified). We add the intended
--      indexes here under table-prefixed, non-colliding names.
--
--   2. Default batteries were readable by ANY authenticated user (the prior
--      batteries_select policy's `is_default = true` branch is role-agnostic),
--      which let clients read the 3 system templates. F2's intended model is
--      coach/admin-only, so we gate the default-battery read behind the existing
--      SECURITY DEFINER helper public.is_coach_or_admin().
--
--  Additive · idempotent · reversible. Alters NO data, drops NO table, touches
--  NO rehab / program / versioning / workout-logging table, and changes NO
--  app/CSS/JS. Only the assessment_batteries SELECT policy is replaced; the
--  insert/update/delete battery policies and all other tables are untouched.
--
--  Rollback: supabase/rollbacks/20260625010000_athletic_assessment_index_rls_fix_down.sql
--
--  Depends on: public.is_admin(), public.is_coach_or_admin() (both pre-existing,
--  SECURITY DEFINER, STABLE, search_path=public).
-- ════════════════════════════════════════════════════════════════

-- ── Issue 1 — add the two missing athlete_assessments indexes ──
create index if not exists idx_athlete_assessments_client
  on public.athlete_assessments(client_id, assessed_at desc);
create index if not exists idx_athlete_assessments_coach
  on public.athlete_assessments(coach_id);

-- ── Issue 2 — tighten default-battery read to coach/admin only ──
-- Replaces ONLY the SELECT policy. Result:
--   • admin/owner            → read all batteries
--   • coach                  → read own batteries + default/system batteries
--   • client (and any other) → read nothing (no own batteries, not coach/admin)
-- insert/update/delete battery policies are intentionally left unchanged.
drop policy if exists "batteries_select" on public.assessment_batteries;
create policy "batteries_select" on public.assessment_batteries
  for select to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or (is_default = true and public.is_coach_or_admin())
  );

-- ── Smoke (each should succeed) ─────────────────────────────────
--   SELECT indexname FROM pg_indexes
--     WHERE tablename='athlete_assessments' ORDER BY indexname;
--   -- impersonated client: SELECT count(*) FROM assessment_batteries  -> 0
--   -- impersonated coach:  SELECT count(*) FROM assessment_batteries  -> own + defaults
