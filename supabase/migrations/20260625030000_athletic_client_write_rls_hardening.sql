-- ════════════════════════════════════════════════════════════════
--  Phase F3B-Hardening — Athletic F2/F3 client write-block RLS fix
--
--  Closes an inherited RLS gap on the Athletic Performance tables: the
--  owning-coach branch `coach_id = auth.uid()` had NO role gate, so ANY
--  authenticated user (incl. a client) could satisfy WITH CHECK by stamping
--  their own id into coach_id — a self-stamped write. Read isolation was never
--  affected (clients still read 0 rows); this only closes the WRITE path.
--
--  Fix: gate every owning-coach / assigned-coach branch behind the existing
--  SECURITY DEFINER helper public.is_coach_or_admin(). public.is_admin() is
--  preserved verbatim. Logic is identical to the approved pattern
--    is_admin()
--    OR (is_coach_or_admin() AND coach_id = auth.uid())
--    OR (is_coach_or_admin() AND EXISTS(assigned-coach …))
--  factored to call is_coach_or_admin() once:
--    is_admin() OR (is_coach_or_admin() AND (coach_id = auth.uid() OR EXISTS(…)))
--
--  Net effect by role (all five tables):
--    • client                 → no write (and still no read)            [HARDENED]
--    • coach (own / assigned)  → unchanged (still manages own/assigned)
--    • admin / owner           → unchanged (manages all)
--    • unassigned coach        → unchanged (blocked)
--
--  POLICY-ONLY · additive · idempotent · reversible. Changes NO data, drops NO
--  table, alters NO column, touches NO rehab / program / versioning / workout
--  table and NO app / CSS / JS. Only the write-capable Athletic RLS policies are
--  replaced. assessment_batteries' SELECT policy is intentionally left unchanged
--  (it is a read and is already client-safe: a client matches no branch → 0 rows).
--
--  Rollback: supabase/rollbacks/20260625030000_athletic_client_write_rls_hardening_down.sql
--
--  Depends on (pre-existing, live): public.is_admin(), public.is_coach_or_admin()
--  (both SECURITY DEFINER, STABLE, search_path=public).
-- ════════════════════════════════════════════════════════════════

-- ── 1. athlete_profiles_all (FOR ALL) ──
drop policy if exists "athlete_profiles_all" on public.athlete_profiles;
create policy "athlete_profiles_all" on public.athlete_profiles
  for all to authenticated
  using (
    public.is_admin()
    or (
      public.is_coach_or_admin()
      and (
        coach_id = (select auth.uid())
        or exists (select 1 from public.profiles p
                   where p.id = athlete_profiles.client_id and p.assigned_coach = (select auth.uid()))
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_coach_or_admin()
      and (
        coach_id = (select auth.uid())
        or exists (select 1 from public.profiles p
                   where p.id = athlete_profiles.client_id and p.assigned_coach = (select auth.uid()))
      )
    )
  );

-- ── 2. assessments_all (FOR ALL) on athlete_assessments ──
drop policy if exists "assessments_all" on public.athlete_assessments;
create policy "assessments_all" on public.athlete_assessments
  for all to authenticated
  using (
    public.is_admin()
    or (
      public.is_coach_or_admin()
      and (
        coach_id = (select auth.uid())
        or exists (select 1 from public.profiles p
                   where p.id = athlete_assessments.client_id and p.assigned_coach = (select auth.uid()))
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_coach_or_admin()
      and (
        coach_id = (select auth.uid())
        or exists (select 1 from public.profiles p
                   where p.id = athlete_assessments.client_id and p.assigned_coach = (select auth.uid()))
      )
    )
  );

-- ── 3. results_all (FOR ALL) on athlete_test_results ──
drop policy if exists "results_all" on public.athlete_test_results;
create policy "results_all" on public.athlete_test_results
  for all to authenticated
  using (
    public.is_admin()
    or (
      public.is_coach_or_admin()
      and (
        coach_id = (select auth.uid())
        or exists (select 1 from public.profiles p
                   where p.id = athlete_test_results.client_id and p.assigned_coach = (select auth.uid()))
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_coach_or_admin()
      and (
        coach_id = (select auth.uid())
        or exists (select 1 from public.profiles p
                   where p.id = athlete_test_results.client_id and p.assigned_coach = (select auth.uid()))
      )
    )
  );

-- ── 4. movement_observations_all (FOR ALL) on athletic_movement_observations ──
drop policy if exists "movement_observations_all" on public.athletic_movement_observations;
create policy "movement_observations_all" on public.athletic_movement_observations
  for all to authenticated
  using (
    public.is_admin()
    or (
      public.is_coach_or_admin()
      and (
        coach_id = (select auth.uid())
        or exists (select 1 from public.profiles p
                   where p.id = athletic_movement_observations.client_id and p.assigned_coach = (select auth.uid()))
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_coach_or_admin()
      and (
        coach_id = (select auth.uid())
        or exists (select 1 from public.profiles p
                   where p.id = athletic_movement_observations.client_id and p.assigned_coach = (select auth.uid()))
      )
    )
  );

-- ── 5-7. assessment_batteries write policies — add the is_coach_or_admin()
--         gate to the owning-coach branch (is_default=false rule preserved;
--         admin-manages-defaults preserved; SELECT policy left unchanged). ──
drop policy if exists "batteries_insert" on public.assessment_batteries;
create policy "batteries_insert" on public.assessment_batteries
  for insert to authenticated
  with check (
    public.is_admin()
    or (public.is_coach_or_admin() and coach_id = (select auth.uid()) and is_default = false)
  );

drop policy if exists "batteries_update" on public.assessment_batteries;
create policy "batteries_update" on public.assessment_batteries
  for update to authenticated
  using (
    public.is_admin()
    or (public.is_coach_or_admin() and coach_id = (select auth.uid()) and is_default = false)
  )
  with check (
    public.is_admin()
    or (public.is_coach_or_admin() and coach_id = (select auth.uid()) and is_default = false)
  );

drop policy if exists "batteries_delete" on public.assessment_batteries;
create policy "batteries_delete" on public.assessment_batteries
  for delete to authenticated
  using (
    public.is_admin()
    or (public.is_coach_or_admin() and coach_id = (select auth.uid()) and is_default = false)
  );

-- ── Smoke (after apply, impersonated) ───────────────────────────
--   client  → INSERT any of the 5 tables with coach_id = self  -> 42501
--   coach   → INSERT own/assigned                              -> ok (unchanged)
--   admin   → INSERT any                                        -> ok (unchanged)
--   client  → SELECT count(*)                                   -> 0 (unchanged)
