BEGIN;

-- P2C-1: manual InstaPay requests. The owner remains the sole authority that
-- can turn an externally verified transfer into package access.

-- A boolean primary key constrained to TRUE permits exactly one settings row.
CREATE TABLE IF NOT EXISTS public.payment_settings (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  payment_link text,
  display_label text,
  enabled      boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.payment_settings IS
  'Single-row public payment instructions. This send-money handle is not a secret. '
  'Never store API keys, passwords, tokens, or other credentials here.';

INSERT INTO public.payment_settings (singleton, payment_link, display_label, enabled)
VALUES (true, NULL, NULL, false)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_settings_authenticated_select" ON public.payment_settings;
CREATE POLICY "payment_settings_authenticated_select" ON public.payment_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "payment_settings_admin_insert" ON public.payment_settings;
CREATE POLICY "payment_settings_admin_insert" ON public.payment_settings
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "payment_settings_admin_update" ON public.payment_settings;
CREATE POLICY "payment_settings_admin_update" ON public.payment_settings
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

REVOKE ALL ON TABLE public.payment_settings FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_settings TO authenticated;

CREATE TABLE IF NOT EXISTS public.coach_payment_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  package_key      text NOT NULL
                     CHECK (package_key IN ('free','starter','growth','pro','scale','custom')),
  client_limit     integer,
  months           integer NOT NULL CHECK (months BETWEEN 1 AND 60),
  amount_minor     integer NOT NULL CHECK (amount_minor >= 0),
  currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN
                       ('pending','awaiting_review','approved','rejected','cancelled')),
  coach_reference  text CHECK (coach_reference IS NULL OR length(coach_reference) <= 500),
  admin_note       text,
  reviewed_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  payment_event_id uuid REFERENCES public.payment_events(id) ON DELETE RESTRICT,
  CONSTRAINT coach_payment_requests_custom_limit_check
    CHECK (package_key <> 'custom' OR client_limit >= 60)
);

COMMENT ON COLUMN public.coach_payment_requests.coach_reference IS
  'Coach-supplied free text, capped at 500 characters. Never interpolate it into SQL, HTML, or email without escaping.';

CREATE INDEX IF NOT EXISTS coach_payment_requests_coach_created_idx
  ON public.coach_payment_requests (coach_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_payment_requests_status_idx
  ON public.coach_payment_requests (status);
CREATE UNIQUE INDEX IF NOT EXISTS coach_payment_requests_one_open_per_coach_idx
  ON public.coach_payment_requests (coach_id)
  WHERE status IN ('pending', 'awaiting_review');
COMMENT ON INDEX public.coach_payment_requests_one_open_per_coach_idx IS
  'Allows at most one open request per coach, preventing a coach from queuing many requests.';

ALTER TABLE public.coach_payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach_payment_requests_coach_select" ON public.coach_payment_requests;
CREATE POLICY "coach_payment_requests_coach_select" ON public.coach_payment_requests
  FOR SELECT TO authenticated
  USING (
    coach_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND role = 'coach'
    )
  );

DROP POLICY IF EXISTS "coach_payment_requests_admin_select" ON public.coach_payment_requests;
CREATE POLICY "coach_payment_requests_admin_select" ON public.coach_payment_requests
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "coach_payment_requests_coach_insert" ON public.coach_payment_requests;
CREATE POLICY "coach_payment_requests_coach_insert" ON public.coach_payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    coach_id = (SELECT auth.uid())
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND role = 'coach'
    )
    AND admin_note IS NULL
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND payment_event_id IS NULL
  );

-- RLS enforces ownership and the sole coach-visible state transition. The
-- trigger below separately enforces the column-level restriction.
DROP POLICY IF EXISTS "coach_payment_requests_coach_update" ON public.coach_payment_requests;
CREATE POLICY "coach_payment_requests_coach_update" ON public.coach_payment_requests
  FOR UPDATE TO authenticated
  USING (
    coach_id = (SELECT auth.uid())
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND role = 'coach'
    )
  )
  WITH CHECK (
    coach_id = (SELECT auth.uid())
    AND status = 'awaiting_review'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND role = 'coach'
    )
  );

DROP POLICY IF EXISTS "coach_payment_requests_admin_update" ON public.coach_payment_requests;
CREATE POLICY "coach_payment_requests_admin_update" ON public.coach_payment_requests
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- Deliberately no DELETE policy: requests are an audit trail for every role.
REVOKE ALL ON TABLE public.coach_payment_requests FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.coach_payment_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_coach_payment_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.updated_at := now();
  IF NOT (SELECT public.is_admin()) THEN
    IF OLD.coach_id <> (SELECT auth.uid())
       OR OLD.status <> 'pending'
       OR NEW.status <> 'awaiting_review'
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.coach_id IS DISTINCT FROM OLD.coach_id
       OR NEW.package_key IS DISTINCT FROM OLD.package_key
       OR NEW.client_limit IS DISTINCT FROM OLD.client_limit
       OR NEW.months IS DISTINCT FROM OLD.months
       OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.admin_note IS DISTINCT FROM OLD.admin_note
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.payment_event_id IS DISTINCT FROM OLD.payment_event_id THEN
      RAISE EXCEPTION 'coach may only mark an owned pending request awaiting review and set coach_reference';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS coach_payment_requests_guard_update
  ON public.coach_payment_requests;
CREATE TRIGGER coach_payment_requests_guard_update
BEFORE UPDATE ON public.coach_payment_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_coach_payment_request_update();

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

CREATE OR REPLACE FUNCTION public.mark_coach_payment_sent(
  p_request_id uuid,
  p_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_coach_id uuid := auth.uid();
  v_admin_id uuid;
BEGIN
  IF v_coach_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_reference IS NOT NULL AND length(p_reference) > 500 THEN
    RAISE EXCEPTION 'reference must be at most 500 characters';
  END IF;

  UPDATE public.coach_payment_requests
  SET status = 'awaiting_review', coach_reference = p_reference
  WHERE id = p_request_id
    AND coach_id = v_coach_id
    AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owned pending payment request not found';
  END IF;

  SELECT id INTO v_admin_id
  FROM public.profiles
  WHERE role = 'admin'
  ORDER BY id
  LIMIT 1;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'owner profile not found';
  END IF;

  INSERT INTO public.notifications
    (recipient_id, actor_id, type, title, body, link_section,
     link_params, severity, data)
  VALUES
    (v_admin_id, v_coach_id, 'coach_payment_awaiting_review',
     'Coach payment awaiting review',
     'A coach marked a manual package payment as sent.',
     'notifications', jsonb_build_object('request_id', p_request_id),
     'info', jsonb_build_object('request_id', p_request_id));

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'status', 'awaiting_review'
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.approve_coach_payment(
  p_request_id uuid,
  p_period_start timestamptz DEFAULT now(),
  p_admin_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_admin_id uuid := auth.uid();
  v_request public.coach_payment_requests%ROWTYPE;
  v_period_end timestamptz;
  v_apply_result jsonb;
  v_provider_event_id text;
  v_event_id uuid;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF p_period_start IS NULL THEN
    RAISE EXCEPTION 'period start required';
  END IF;

  SELECT * INTO v_request
  FROM public.coach_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'awaiting_review' THEN
    RAISE EXCEPTION 'awaiting-review payment request not found';
  END IF;

  v_period_end := p_period_start + make_interval(months => v_request.months);
  v_provider_event_id := 'manual:req:' || p_request_id::text;

  -- Legitimate nested privilege: this SECURITY DEFINER approval is internally
  -- admin-authorized, so its definer rights may reach the pre-existing
  -- service-role-only apply function without widening that function's EXECUTE ACL.
  v_apply_result := public.apply_paid_coach_package_period_system(
    p_provider => 'manual',
    p_provider_event_id => v_provider_event_id,
    p_coach_id => v_request.coach_id,
    p_package_key => v_request.package_key,
    p_client_limit => v_request.client_limit,
    p_period_start => p_period_start,
    p_period_end => v_period_end,
    p_amount_minor => v_request.amount_minor,
    p_currency => v_request.currency,
    p_payment_status => 'paid',
    p_event_type => 'manual_payment_approved',
    p_summary => jsonb_build_object('request_id', p_request_id)
  );
  v_event_id := (v_apply_result ->> 'event_id')::uuid;

  UPDATE public.coach_payment_requests
  SET status = 'approved',
      admin_note = p_admin_note,
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      payment_event_id = v_event_id
  WHERE id = p_request_id;

  INSERT INTO public.notifications
    (recipient_id, actor_id, type, title, body, link_section,
     link_params, severity, data)
  VALUES
    (v_request.coach_id, v_admin_id, 'coach_payment_approved',
     'Package payment approved',
     'Your manual payment was approved and your package period is active.',
     'notifications', jsonb_build_object('request_id', p_request_id),
     'info', jsonb_build_object('request_id', p_request_id));

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'status', 'approved',
    'applied', coalesce((v_apply_result ->> 'applied')::boolean, false),
    'duplicate', coalesce((v_apply_result ->> 'duplicate')::boolean, false),
    'payment_event_id', v_event_id,
    'period_end', v_period_end
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reject_coach_payment(
  p_request_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_admin_id uuid := auth.uid();
  v_coach_id uuid;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'rejection reason required';
  END IF;

  UPDATE public.coach_payment_requests
  SET status = 'rejected',
      admin_note = p_reason,
      reviewed_by = v_admin_id,
      reviewed_at = now()
  WHERE id = p_request_id AND status = 'awaiting_review'
  RETURNING coach_id INTO v_coach_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'awaiting-review payment request not found';
  END IF;

  INSERT INTO public.notifications
    (recipient_id, actor_id, type, title, body, link_section,
     link_params, severity, data)
  VALUES
    (v_coach_id, v_admin_id, 'coach_payment_rejected',
     'Package payment needs attention',
     'Your manual payment request was rejected. Review the owner note.',
     'notifications', jsonb_build_object('request_id', p_request_id),
     'warning', jsonb_build_object('request_id', p_request_id));

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'status', 'rejected'
  );
END;
$fn$;

-- Supabase public-schema defaults may grant anon directly; PUBLIC revocation
-- alone does not remove that ACL. Every new function is therefore revoked from
-- both PUBLIC and anon, then exposed only to authenticated callers. No new
-- service-role ACL change is needed.
REVOKE ALL ON FUNCTION public.guard_coach_payment_request_update() FROM public, anon;
REVOKE ALL ON FUNCTION public.guard_coach_payment_request_update() FROM authenticated, service_role;
-- Trigger execution is attached to the table statement and does not require the
-- DML caller to hold EXECUTE on this helper, so no API role receives that grant.
REVOKE ALL ON FUNCTION public.request_coach_package_payment(text, integer, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_coach_package_payment(text, integer, integer, text) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_coach_payment_sent(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_coach_payment_sent(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_coach_payment(uuid, timestamptz, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_coach_payment(uuid, timestamptz, text) TO authenticated;
REVOKE ALL ON FUNCTION public.reject_coach_payment(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reject_coach_payment(uuid, text) TO authenticated;

COMMIT;
