BEGIN;

CREATE TABLE IF NOT EXISTS public.package_prices (
  package_key           text NOT NULL
                          CHECK (package_key IN ('starter', 'growth', 'pro', 'scale')),
  months                integer NOT NULL CHECK (months IN (1, 12)),
  list_amount_minor     integer NOT NULL CHECK (list_amount_minor >= 0),
  list_currency         text NOT NULL DEFAULT 'USD'
                          CHECK (list_currency ~ '^[A-Z]{3}$'),
  list_was_amount_minor integer CHECK (
                          list_was_amount_minor IS NULL OR list_was_amount_minor >= 0
                        ),
  charge_amount_minor   integer CHECK (
                          charge_amount_minor IS NULL OR charge_amount_minor >= 0
                        ),
  charge_currency       text NOT NULL DEFAULT 'EGP'
                          CHECK (charge_currency ~ '^[A-Z]{3}$'),
  active                boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  PRIMARY KEY (package_key, months),
  -- An unpriced tier must remain unrequestable.
  CONSTRAINT package_prices_active_requires_charge_check
    CHECK (NOT active OR charge_amount_minor IS NOT NULL)
);

INSERT INTO public.package_prices
  (package_key, months, list_amount_minor, list_currency,
   list_was_amount_minor, charge_amount_minor, charge_currency, active)
VALUES
  ('starter', 1, 500, 'USD', 1000, NULL, 'EGP', false),
  ('starter', 12, 5000, 'USD', 10000, NULL, 'EGP', false),
  ('growth', 1, 1000, 'USD', 2000, NULL, 'EGP', false),
  ('growth', 12, 10000, 'USD', 20000, NULL, 'EGP', false),
  ('pro', 1, 2000, 'USD', 3500, NULL, 'EGP', false),
  ('pro', 12, 20000, 'USD', 35000, NULL, 'EGP', false),
  ('scale', 1, 3500, 'USD', 4500, NULL, 'EGP', false),
  ('scale', 12, 35000, 'USD', 45000, NULL, 'EGP', false)
ON CONFLICT (package_key, months) DO NOTHING;

ALTER TABLE public.package_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "package_prices_authenticated_select" ON public.package_prices;
CREATE POLICY "package_prices_authenticated_select" ON public.package_prices
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "package_prices_admin_insert" ON public.package_prices;
CREATE POLICY "package_prices_admin_insert" ON public.package_prices
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "package_prices_admin_update" ON public.package_prices;
CREATE POLICY "package_prices_admin_update" ON public.package_prices
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "package_prices_admin_delete" ON public.package_prices;
CREATE POLICY "package_prices_admin_delete" ON public.package_prices
  FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

REVOKE ALL ON TABLE public.package_prices FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.package_prices TO authenticated;

-- PostgreSQL identifies functions by argument types. Drop the caller-supplied
-- amount signature first so CREATE below cannot leave the unsafe overload callable.
DROP FUNCTION IF EXISTS public.request_coach_package_payment(text, integer, integer, text);

CREATE OR REPLACE FUNCTION public.request_coach_package_payment(
  p_package_key text,
  p_months integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_coach_id uuid := auth.uid();
  v_request_id uuid;
  v_role text;
  v_price public.package_prices%ROWTYPE;
  v_instructions jsonb := NULL;
BEGIN
  IF v_coach_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_coach_id;
  IF v_role IS DISTINCT FROM 'coach' THEN
    RAISE EXCEPTION 'coach role required';
  END IF;

  SELECT * INTO v_price
  FROM public.package_prices
  WHERE package_key = p_package_key
    AND months = p_months
    AND active = true
    AND charge_amount_minor IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'package price is unavailable or inactive';
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
    (v_coach_id, v_price.package_key, NULL, v_price.months,
     v_price.charge_amount_minor, v_price.charge_currency)
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
    'amount_minor', v_price.charge_amount_minor,
    'currency', v_price.charge_currency,
    'list_amount_minor', v_price.list_amount_minor,
    'list_currency', v_price.list_currency,
    'payment_instructions', v_instructions
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.request_coach_package_payment(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_coach_package_payment(text, integer) TO authenticated;

COMMIT;
