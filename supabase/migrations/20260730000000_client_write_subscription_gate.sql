-- ═══════════════════════════════════════════════════════════════════════════════
--  P3A-2F — Database-level client write gate for inactive clients
--
--  Seven legacy tables authorize client writes on ownership alone. These
--  RESTRICTIVE policies add effective subscription state to those write paths
--  without modifying any existing permissive policy.
--
--  Reads are deliberately NOT gated. The product rule is active/grace -> write,
--  expired/pending/none -> view only, so a lapsed client keeps access to their
--  own history.
--
--  `IS DISTINCT FROM` is intentional for nullable client IDs and is used
--  uniformly so staff writes remain governed by the existing permissive
--  policies even if another table's nullability changes later.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. daily_routine_logs — gate client writes. ─────────────────────────────────
DROP POLICY IF EXISTS "daily_routine_logs_require_active_subscription_insert" ON public.daily_routine_logs;
CREATE POLICY "daily_routine_logs_require_active_subscription_insert"
  ON public.daily_routine_logs AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "daily_routine_logs_require_active_subscription_update" ON public.daily_routine_logs;
CREATE POLICY "daily_routine_logs_require_active_subscription_update"
  ON public.daily_routine_logs AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  )
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "daily_routine_logs_require_active_subscription_delete" ON public.daily_routine_logs;
CREATE POLICY "daily_routine_logs_require_active_subscription_delete"
  ON public.daily_routine_logs AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

-- 2. phase_submissions — gate client writes. ──────────────────────────────────
DROP POLICY IF EXISTS "phase_submissions_require_active_subscription_insert" ON public.phase_submissions;
CREATE POLICY "phase_submissions_require_active_subscription_insert"
  ON public.phase_submissions AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "phase_submissions_require_active_subscription_update" ON public.phase_submissions;
CREATE POLICY "phase_submissions_require_active_subscription_update"
  ON public.phase_submissions AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  )
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "phase_submissions_require_active_subscription_delete" ON public.phase_submissions;
CREATE POLICY "phase_submissions_require_active_subscription_delete"
  ON public.phase_submissions AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

-- 3. subjective_assessments — gate client writes. ─────────────────────────────
DROP POLICY IF EXISTS "subjective_assessments_require_active_subscription_insert" ON public.subjective_assessments;
CREATE POLICY "subjective_assessments_require_active_subscription_insert"
  ON public.subjective_assessments AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "subjective_assessments_require_active_subscription_update" ON public.subjective_assessments;
CREATE POLICY "subjective_assessments_require_active_subscription_update"
  ON public.subjective_assessments AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  )
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "subjective_assessments_require_active_subscription_delete" ON public.subjective_assessments;
CREATE POLICY "subjective_assessments_require_active_subscription_delete"
  ON public.subjective_assessments AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

-- 4. exercise_alternative_requests — gate client writes. ──────────────────────
DROP POLICY IF EXISTS "exercise_alternative_requests_require_active_subscription_insert" ON public.exercise_alternative_requests;
CREATE POLICY "exercise_alternative_requests_require_active_subscription_insert"
  ON public.exercise_alternative_requests AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "exercise_alternative_requests_require_active_subscription_update" ON public.exercise_alternative_requests;
CREATE POLICY "exercise_alternative_requests_require_active_subscription_update"
  ON public.exercise_alternative_requests AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  )
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

-- Inert today because no permissive client DELETE policy exists; retained so
-- the subscription gate is already present if one is added in the future.
DROP POLICY IF EXISTS "exercise_alternative_requests_require_active_subscription_delete" ON public.exercise_alternative_requests;
CREATE POLICY "exercise_alternative_requests_require_active_subscription_delete"
  ON public.exercise_alternative_requests AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

-- 5. progress_logs — gate client writes. ──────────────────────────────────────
DROP POLICY IF EXISTS "progress_logs_require_active_subscription_insert" ON public.progress_logs;
CREATE POLICY "progress_logs_require_active_subscription_insert"
  ON public.progress_logs AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "progress_logs_require_active_subscription_update" ON public.progress_logs;
CREATE POLICY "progress_logs_require_active_subscription_update"
  ON public.progress_logs AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  )
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "progress_logs_require_active_subscription_delete" ON public.progress_logs;
CREATE POLICY "progress_logs_require_active_subscription_delete"
  ON public.progress_logs AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

-- 6. client_questions — gate client writes. ───────────────────────────────────
DROP POLICY IF EXISTS "client_questions_require_active_subscription_insert" ON public.client_questions;
CREATE POLICY "client_questions_require_active_subscription_insert"
  ON public.client_questions AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "client_questions_require_active_subscription_update" ON public.client_questions;
CREATE POLICY "client_questions_require_active_subscription_update"
  ON public.client_questions AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  )
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

-- Inert today because no permissive client DELETE policy exists; retained so
-- the subscription gate is already present if one is added in the future.
DROP POLICY IF EXISTS "client_questions_require_active_subscription_delete" ON public.client_questions;
CREATE POLICY "client_questions_require_active_subscription_delete"
  ON public.client_questions AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

-- 7. workout_logs (legacy) — gate client writes. ──────────────────────────────
DROP POLICY IF EXISTS "workout_logs_require_active_subscription_insert" ON public.workout_logs;
CREATE POLICY "workout_logs_require_active_subscription_insert"
  ON public.workout_logs AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "workout_logs_require_active_subscription_update" ON public.workout_logs;
CREATE POLICY "workout_logs_require_active_subscription_update"
  ON public.workout_logs AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  )
  WITH CHECK (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "workout_logs_require_active_subscription_delete" ON public.workout_logs;
CREATE POLICY "workout_logs_require_active_subscription_delete"
  ON public.workout_logs AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    client_id IS DISTINCT FROM (SELECT auth.uid())
    OR (SELECT public.client_has_write_access((SELECT auth.uid())))
  );

COMMIT;
