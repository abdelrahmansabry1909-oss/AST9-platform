BEGIN;

DROP TRIGGER IF EXISTS coach_payment_requests_guard_update
  ON public.coach_payment_requests;

DROP POLICY IF EXISTS "coach_payment_requests_admin_update" ON public.coach_payment_requests;
DROP POLICY IF EXISTS "coach_payment_requests_coach_update" ON public.coach_payment_requests;
DROP POLICY IF EXISTS "coach_payment_requests_coach_insert" ON public.coach_payment_requests;
DROP POLICY IF EXISTS "coach_payment_requests_admin_select" ON public.coach_payment_requests;
DROP POLICY IF EXISTS "coach_payment_requests_coach_select" ON public.coach_payment_requests;
DROP POLICY IF EXISTS "payment_settings_admin_update" ON public.payment_settings;
DROP POLICY IF EXISTS "payment_settings_admin_insert" ON public.payment_settings;
DROP POLICY IF EXISTS "payment_settings_authenticated_select" ON public.payment_settings;

DROP FUNCTION IF EXISTS public.reject_coach_payment(uuid, text);
DROP FUNCTION IF EXISTS public.approve_coach_payment(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.mark_coach_payment_sent(uuid, text);
DROP FUNCTION IF EXISTS public.request_coach_package_payment(text, integer, integer, text);
DROP FUNCTION IF EXISTS public.guard_coach_payment_request_update();

DROP TABLE IF EXISTS public.coach_payment_requests;
DROP TABLE IF EXISTS public.payment_settings;

COMMIT;
