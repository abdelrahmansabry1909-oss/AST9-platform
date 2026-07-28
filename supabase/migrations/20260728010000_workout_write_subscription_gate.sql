-- ═══════════════════════════════════════════════════════════════
--  L12 — Database-level workout write gate for inactive clients
--
--  Before this migration, `workout_sessions_client_own` authorized client
--  writes on ownership alone (`client_id = auth.uid()`), and no policy in
--  the schema referenced effective subscription state. The inactive-client
--  takeover screen was therefore frontend-only: an authenticated client
--  whose access had lapsed could still write via direct PostgREST calls.
--
--  Design: RESTRICTIVE policies, which PostgreSQL ANDs with the existing
--  permissive policies. No existing policy is modified, so coach and admin
--  paths cannot regress, and rollback is dropping what this file adds.
--
--  Reads are deliberately NOT gated. The locked architecture rule is
--  active/grace -> write, expired/pending/none -> view only, so a lapsed
--  client must keep SELECT access to their own history.
--
--  Coach and admin writes on behalf of a client are unchanged, including
--  for a lapsed client. That is existing product behavior; narrowing it is
--  a separate decision, not part of L12.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Effective-access predicate. ─────────────────────────────────
--    SECURITY DEFINER (mirrors is_admin()) so the gate does not depend on
--    the caller being able to read `subscriptions` themselves; a future
--    change to that read policy must not silently disable this check.
--    STABLE so the planner may evaluate it once per statement.
CREATE OR REPLACE FUNCTION public.client_has_write_access(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT v.effective_status IN ('active', 'grace')
      FROM public.v_client_subscription_state v
      WHERE v.client_id = p_client_id
    ),
    false
  );
$$;

-- Supabase default privileges grant EXECUTE to anon on new public
-- functions, and REVOKE ... FROM PUBLIC does not remove that grant.
REVOKE ALL ON FUNCTION public.client_has_write_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_has_write_access(uuid) TO authenticated, service_role;

-- 2. workout_sessions — gate client writes. ──────────────────────
--    `client_id <> auth.uid()` short-circuits every non-owner caller
--    (coach, admin), leaving their existing policies to decide.
DROP POLICY IF EXISTS "workout_sessions_require_active_subscription_insert" ON public.workout_sessions;
CREATE POLICY "workout_sessions_require_active_subscription_insert"
  ON public.workout_sessions AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    client_id <> (SELECT auth.uid())
    OR (SELECT public.client_has_write_access(auth.uid()))
  );

DROP POLICY IF EXISTS "workout_sessions_require_active_subscription_update" ON public.workout_sessions;
CREATE POLICY "workout_sessions_require_active_subscription_update"
  ON public.workout_sessions AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    client_id <> (SELECT auth.uid())
    OR (SELECT public.client_has_write_access(auth.uid()))
  )
  WITH CHECK (
    client_id <> (SELECT auth.uid())
    OR (SELECT public.client_has_write_access(auth.uid()))
  );

DROP POLICY IF EXISTS "workout_sessions_require_active_subscription_delete" ON public.workout_sessions;
CREATE POLICY "workout_sessions_require_active_subscription_delete"
  ON public.workout_sessions AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    client_id <> (SELECT auth.uid())
    OR (SELECT public.client_has_write_access(auth.uid()))
  );

-- 3. workout_exercise_logs — gate via the parent session. ────────
--    Without this, a lapsed client simply writes logs into a session
--    created while they were active and the session gate is theatre.
DROP POLICY IF EXISTS "workout_logs_require_active_subscription_insert" ON public.workout_exercise_logs;
CREATE POLICY "workout_logs_require_active_subscription_insert"
  ON public.workout_exercise_logs AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.workout_sessions s
      WHERE s.id = workout_exercise_logs.session_id
        AND s.client_id = (SELECT auth.uid())
    )
    OR (SELECT public.client_has_write_access(auth.uid()))
  );

DROP POLICY IF EXISTS "workout_logs_require_active_subscription_update" ON public.workout_exercise_logs;
CREATE POLICY "workout_logs_require_active_subscription_update"
  ON public.workout_exercise_logs AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1 FROM public.workout_sessions s
      WHERE s.id = workout_exercise_logs.session_id
        AND s.client_id = (SELECT auth.uid())
    )
    OR (SELECT public.client_has_write_access(auth.uid()))
  )
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.workout_sessions s
      WHERE s.id = workout_exercise_logs.session_id
        AND s.client_id = (SELECT auth.uid())
    )
    OR (SELECT public.client_has_write_access(auth.uid()))
  );

DROP POLICY IF EXISTS "workout_logs_require_active_subscription_delete" ON public.workout_exercise_logs;
CREATE POLICY "workout_logs_require_active_subscription_delete"
  ON public.workout_exercise_logs AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1 FROM public.workout_sessions s
      WHERE s.id = workout_exercise_logs.session_id
        AND s.client_id = (SELECT auth.uid())
    )
    OR (SELECT public.client_has_write_access(auth.uid()))
  );

COMMIT;
