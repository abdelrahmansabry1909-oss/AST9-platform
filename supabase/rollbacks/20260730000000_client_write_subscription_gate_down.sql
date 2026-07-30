-- ═══════════════════════════════════════════════════════════════════════════════
--  DOWN — P3A-2F client write subscription gate
--  Reverses 20260730000000_client_write_subscription_gate.sql.
--
--  ⚠️  SECURITY: running this restores direct-PostgREST write access for
--  lapsed clients on these seven tables. Only run this to recover from a defect
--  in the gate itself, and record why.
--
--  Safe to run repeatedly. It drops only policies the up-migration added; no
--  pre-existing policy was modified, so nothing needs restoring.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "workout_logs_require_active_subscription_delete" ON public.workout_logs;
DROP POLICY IF EXISTS "workout_logs_require_active_subscription_update" ON public.workout_logs;
DROP POLICY IF EXISTS "workout_logs_require_active_subscription_insert" ON public.workout_logs;

DROP POLICY IF EXISTS "client_questions_require_active_subscription_delete" ON public.client_questions;
DROP POLICY IF EXISTS "client_questions_require_active_subscription_update" ON public.client_questions;
DROP POLICY IF EXISTS "client_questions_require_active_subscription_insert" ON public.client_questions;

DROP POLICY IF EXISTS "progress_logs_require_active_subscription_delete" ON public.progress_logs;
DROP POLICY IF EXISTS "progress_logs_require_active_subscription_update" ON public.progress_logs;
DROP POLICY IF EXISTS "progress_logs_require_active_subscription_insert" ON public.progress_logs;

DROP POLICY IF EXISTS "exercise_alternative_requests_require_active_subscription_delete" ON public.exercise_alternative_requests;
DROP POLICY IF EXISTS "exercise_alternative_requests_require_active_subscription_update" ON public.exercise_alternative_requests;
DROP POLICY IF EXISTS "exercise_alternative_requests_require_active_subscription_insert" ON public.exercise_alternative_requests;

DROP POLICY IF EXISTS "subjective_assessments_require_active_subscription_delete" ON public.subjective_assessments;
DROP POLICY IF EXISTS "subjective_assessments_require_active_subscription_update" ON public.subjective_assessments;
DROP POLICY IF EXISTS "subjective_assessments_require_active_subscription_insert" ON public.subjective_assessments;

DROP POLICY IF EXISTS "phase_submissions_require_active_subscription_delete" ON public.phase_submissions;
DROP POLICY IF EXISTS "phase_submissions_require_active_subscription_update" ON public.phase_submissions;
DROP POLICY IF EXISTS "phase_submissions_require_active_subscription_insert" ON public.phase_submissions;

DROP POLICY IF EXISTS "daily_routine_logs_require_active_subscription_delete" ON public.daily_routine_logs;
DROP POLICY IF EXISTS "daily_routine_logs_require_active_subscription_update" ON public.daily_routine_logs;
DROP POLICY IF EXISTS "daily_routine_logs_require_active_subscription_insert" ON public.daily_routine_logs;

COMMIT;
