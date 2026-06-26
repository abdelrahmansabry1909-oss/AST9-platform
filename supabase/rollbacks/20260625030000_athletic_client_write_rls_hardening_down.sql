-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK for: 20260625030000_athletic_client_write_rls_hardening.sql
-- Phase F3B-Hardening — Athletic F2/F3 client write-block RLS fix
--
-- Lives OUTSIDE supabase/migrations/ on purpose so it is never auto-applied
-- as a forward migration. Run it manually (SQL editor or MCP execute_sql) to
-- revert F3B-Hardening.
--
-- Restores the seven write-capable Athletic RLS policies to their exact
-- pre-hardening definitions (the ungated `coach_id = auth.uid()` owner-stamp
-- branch). POLICY-ONLY · changes NO data, drops NO table, alters NO column,
-- touches NO rehab / program / workout table. assessment_batteries' SELECT
-- policy was never changed by the forward migration, so it is not restored here.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. athlete_profiles_all (FOR ALL) — restore ungated ──
drop policy if exists "athlete_profiles_all" on public.athlete_profiles;
create policy "athlete_profiles_all" on public.athlete_profiles
  for all to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_profiles.client_id and p.assigned_coach = (select auth.uid()))
  )
  with check (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_profiles.client_id and p.assigned_coach = (select auth.uid()))
  );

-- ── 2. assessments_all (FOR ALL) — restore ungated ──
drop policy if exists "assessments_all" on public.athlete_assessments;
create policy "assessments_all" on public.athlete_assessments
  for all to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_assessments.client_id and p.assigned_coach = (select auth.uid()))
  )
  with check (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_assessments.client_id and p.assigned_coach = (select auth.uid()))
  );

-- ── 3. results_all (FOR ALL) — restore ungated ──
drop policy if exists "results_all" on public.athlete_test_results;
create policy "results_all" on public.athlete_test_results
  for all to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_test_results.client_id and p.assigned_coach = (select auth.uid()))
  )
  with check (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_test_results.client_id and p.assigned_coach = (select auth.uid()))
  );

-- ── 4. movement_observations_all (FOR ALL) — restore ungated ──
drop policy if exists "movement_observations_all" on public.athletic_movement_observations;
create policy "movement_observations_all" on public.athletic_movement_observations
  for all to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athletic_movement_observations.client_id and p.assigned_coach = (select auth.uid()))
  )
  with check (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athletic_movement_observations.client_id and p.assigned_coach = (select auth.uid()))
  );

-- ── 5-7. assessment_batteries write policies — restore (no role gate) ──
drop policy if exists "batteries_insert" on public.assessment_batteries;
create policy "batteries_insert" on public.assessment_batteries
  for insert to authenticated
  with check (
    public.is_admin()
    or (coach_id = (select auth.uid()) and is_default = false)
  );

drop policy if exists "batteries_update" on public.assessment_batteries;
create policy "batteries_update" on public.assessment_batteries
  for update to authenticated
  using (
    public.is_admin()
    or (coach_id = (select auth.uid()) and is_default = false)
  )
  with check (
    public.is_admin()
    or (coach_id = (select auth.uid()) and is_default = false)
  );

drop policy if exists "batteries_delete" on public.assessment_batteries;
create policy "batteries_delete" on public.assessment_batteries
  for delete to authenticated
  using (
    public.is_admin()
    or (coach_id = (select auth.uid()) and is_default = false)
  );
