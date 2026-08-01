BEGIN;

DROP FUNCTION IF EXISTS public.request_coach_package_payment(text, integer);

DROP POLICY IF EXISTS "package_prices_admin_delete" ON public.package_prices;
DROP POLICY IF EXISTS "package_prices_admin_update" ON public.package_prices;
DROP POLICY IF EXISTS "package_prices_admin_insert" ON public.package_prices;
DROP POLICY IF EXISTS "package_prices_authenticated_select" ON public.package_prices;
DROP TABLE IF EXISTS public.package_prices;

-- Reversing restores caller-supplied amounts. This is acceptable only because
-- package approval remains a manual owner step.
CREATE OR REPLACE FUNCTION public.request_coach_package_payment(
  p_package_key text,
  p_months integer,
  p_amount_minor integer,
  p_currency text DEFAULT 'EGP'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_coach_id uuid := auth.uid();
  v_request_id uuid;
  v_currency text := upper(trim(coalesce(p_currency, '')));
  v_role text;
  v_client_limit integer;
  v_instructions jsonb := NULL;
BEGIN
  IF v_coach_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_coach_id;
  IF v_role IS DISTINCT FROM 'coach' THEN
    RAISE EXCEPTION 'coach role required';
  END IF;
  IF p_package_key IS NULL OR p_package_key NOT IN
     ('free','starter','growth','pro','scale','custom') THEN
    RAISE EXCEPTION 'invalid package_key';
  END IF;
  -- This fixed-signature request API has no quantity argument; a custom request
  -- therefore starts at the foundation's minimum valid custom limit. The owner
  -- may review/adjust it before approval through the admin update path.
  v_client_limit := CASE WHEN p_package_key = 'custom' THEN 60 ELSE NULL END;
  IF p_months IS NULL OR p_months NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'months must be between 1 and 60';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor < 0 THEN
    RAISE EXCEPTION 'amount_minor must be non-negative';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'currency must be a three-letter uppercase code';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.coach_payment_requests
    WHERE coach_id = v_coach_id AND status IN ('pending', 'awaiting_review')
  ) THEN
    RAISE EXCEPTION 'an open payment request already exists';
  END IF;

  INSERT INTO public.coach_payment_requests
    (coach_id, package_key, client_limit, months, amount_minor, currency)
  VALUES
    (v_coach_id, p_package_key, v_client_limit, p_months, p_amount_minor, v_currency)
  RETURNING id INTO v_request_id;

  SELECT jsonb_build_object(
           'payment_link', payment_link,
           'display_label', display_label
         )
    INTO v_instructions
  FROM public.payment_settings
  WHERE singleton = true AND enabled = true;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'payment_instructions', v_instructions
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.request_coach_package_payment(text, integer, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_coach_package_payment(text, integer, integer, text) TO authenticated;

COMMIT;
