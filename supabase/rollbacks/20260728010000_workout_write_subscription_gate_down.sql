-- ═══════════════════════════════════════════════════════════════
--  DOWN — L12 workout write subscription gate
--  Reverses 20260728010000_workout_write_subscription_gate.sql.
--
--  ⚠️  SECURITY: running this restores the frontend-only protection
--  described in KNOWN_LIMITATIONS L12. An authenticated client whose
--  subscription has lapsed regains the ability to write workout sessions
--  and logs through direct PostgREST calls. Only run this to recover from
--  a defect in the gate itself, and record why.
--
--  Safe to run repeatedly. It drops only objects the up-migration added;
--  no pre-existing policy was modified, so nothing needs restoring.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "workout_logs_require_active_subscription_delete" ON public.workout_exercise_logs;
DROP POLICY IF EXISTS "workout_logs_require_active_subscription_update" ON public.workout_exercise_logs;
DROP POLICY IF EXISTS "workout_logs_require_active_subscription_insert" ON public.workout_exercise_logs;

DROP POLICY IF EXISTS "workout_sessions_require_active_subscription_delete" ON public.workout_sessions;
DROP POLICY IF EXISTS "workout_sessions_require_active_subscription_update" ON public.workout_sessions;
DROP POLICY IF EXISTS "workout_sessions_require_active_subscription_insert" ON public.workout_sessions;

-- Dropped last: the policies above depend on it.
DROP FUNCTION IF EXISTS public.client_has_write_access(uuid);

COMMIT;
