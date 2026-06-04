-- ═══════════════════════════════════════════════════════════════
--  SECURITY STABILIZATION · Fix 3 — RLS unification (Audit H1 + H2)
--
--  The schema carried two tenancy idioms. The newer tables scope by
--  "admin OR owning/assigned coach OR self"; the original tables scoped
--  by ROLE ONLY (is_admin_or_coach() / role IN (coach,admin)), letting
--  ANY coach read every client's clinical data and write any client's
--  billing. This migration standardizes the legacy tables onto the
--  assigned-coach template (mirroring client_programs) and forces
--  subscription writes through the guarded reactivate_subscription() RPC.
--
--  Template:
--    coach surface  FOR ALL  USING/CHECK ( is_admin()
--                       OR coach_id = auth.uid()              -- if column exists
--                       OR EXISTS (profiles p WHERE p.id = <tbl>.client_id
--                                  AND p.assigned_coach = auth.uid()) )
--    client surface FOR SELECT USING ( client_id = auth.uid() )
--
--  Supported by profiles_assigned_coach_idx (added in Stabilization).
--  Both coach-facing views (v_client_subscription_state,
--  v_client_progression) are security_invoker=true, so these table
--  policies propagate through them automatically.
--
--  Verified live (impersonating actors as `authenticated`, rolled back):
--    NON-ASSIGNED coach sees assessments/gait/bodymap/subs = 0/0/0/0 and
--    is DENIED direct subscription writes; ASSIGNED coach sees subs=1.
--    pg_policies confirms zero role-only predicates remain on these tables.
-- ═══════════════════════════════════════════════════════════════

-- ── assessments (has coach_id) ─────────────────────────────────
DROP POLICY IF EXISTS assess_write ON public.assessments;
DROP POLICY IF EXISTS assess_read  ON public.assessments;
CREATE POLICY assessments_coach_all ON public.assessments
  FOR ALL TO authenticated
  USING (is_admin() OR coach_id = auth.uid()
         OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = assessments.client_id AND p.assigned_coach = auth.uid()))
  WITH CHECK (is_admin() OR coach_id = auth.uid()
         OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = assessments.client_id AND p.assigned_coach = auth.uid()));
CREATE POLICY assessments_client_read ON public.assessments
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

-- ── body_map_states (no coach_id) ──────────────────────────────
DROP POLICY IF EXISTS bodymap_write ON public.body_map_states;
DROP POLICY IF EXISTS bodymap_read  ON public.body_map_states;
CREATE POLICY body_map_states_coach_all ON public.body_map_states
  FOR ALL TO authenticated
  USING (is_admin()
         OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = body_map_states.client_id AND p.assigned_coach = auth.uid()))
  WITH CHECK (is_admin()
         OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = body_map_states.client_id AND p.assigned_coach = auth.uid()));
CREATE POLICY body_map_states_client_read ON public.body_map_states
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

-- ── gait_assessments (no coach_id) ─────────────────────────────
DROP POLICY IF EXISTS gait_write ON public.gait_assessments;
DROP POLICY IF EXISTS gait_read  ON public.gait_assessments;
CREATE POLICY gait_assessments_coach_all ON public.gait_assessments
  FOR ALL TO authenticated
  USING (is_admin()
         OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = gait_assessments.client_id AND p.assigned_coach = auth.uid()))
  WITH CHECK (is_admin()
         OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = gait_assessments.client_id AND p.assigned_coach = auth.uid()));
CREATE POLICY gait_assessments_client_read ON public.gait_assessments
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

-- ── rehab_objective_assessments (scoped via parent assessment) ──
DROP POLICY IF EXISTS rehab_obj_write ON public.rehab_objective_assessments;
DROP POLICY IF EXISTS rehab_obj_read  ON public.rehab_objective_assessments;
CREATE POLICY rehab_obj_coach_all ON public.rehab_objective_assessments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM assessments a
                 WHERE a.id = rehab_objective_assessments.assessment_id
                   AND (is_admin() OR a.coach_id = auth.uid()
                        OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = a.client_id AND p.assigned_coach = auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM assessments a
                 WHERE a.id = rehab_objective_assessments.assessment_id
                   AND (is_admin() OR a.coach_id = auth.uid()
                        OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = a.client_id AND p.assigned_coach = auth.uid()))));
CREATE POLICY rehab_obj_client_read ON public.rehab_objective_assessments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM assessments a
                 WHERE a.id = rehab_objective_assessments.assessment_id
                   AND a.client_id = auth.uid()));

-- ── progress_logs (client self-manages; coach read scoped) ─────
DROP POLICY IF EXISTS progress_coach_read ON public.progress_logs;
CREATE POLICY progress_coach_read ON public.progress_logs
  FOR SELECT TO authenticated
  USING (is_admin()
         OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = progress_logs.client_id AND p.assigned_coach = auth.uid()));
-- (progress_client_all — client_id = auth.uid() — left intact)

-- ── progress_snapshots (client owns; coach read+insert scoped) ─
DROP POLICY IF EXISTS progress_coach_read   ON public.progress_snapshots;
DROP POLICY IF EXISTS progress_coach_insert ON public.progress_snapshots;
CREATE POLICY progress_coach_read ON public.progress_snapshots
  FOR SELECT TO authenticated
  USING (is_admin()
         OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = progress_snapshots.client_id AND p.assigned_coach = auth.uid()));
CREATE POLICY progress_coach_insert ON public.progress_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (is_admin()
         OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = progress_snapshots.client_id AND p.assigned_coach = auth.uid()));
-- (progress_client_own — client_id = auth.uid() OR is_admin() — left intact)

-- ── subscriptions (H2: writes only via RPC/admin) ──────────────
DROP POLICY IF EXISTS "Admins and coaches manage subscriptions" ON public.subscriptions;
-- "Clients view own subscription" (client_id = auth.uid()) left intact.
CREATE POLICY subscriptions_coach_read ON public.subscriptions
  FOR SELECT TO authenticated
  USING (is_admin()
         OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = subscriptions.client_id AND p.assigned_coach = auth.uid()));
CREATE POLICY subscriptions_admin_write ON public.subscriptions
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
-- Coaches no longer have direct write; they renew via the guarded
-- reactivate_subscription() SECURITY DEFINER RPC (bypasses RLS).

-- ── daily_routine_logs (drop leftover permissive legacy policies) ─
DROP POLICY IF EXISTS "Coaches view daily logs"       ON public.daily_routine_logs;
DROP POLICY IF EXISTS "Clients manage own daily logs" ON public.daily_routine_logs;
-- Scoped dr_logs_* policies (client-own + assigned-coach read/insert/update)
-- remain as the single source of truth.
