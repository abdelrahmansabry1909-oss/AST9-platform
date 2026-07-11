-- ═══════════════════════════════════════════════════════════════
--  Phase A — Client access subscription management
--  Lets an ADMIN or the ASSIGNED COACH create/edit a client's access
--  subscription (custom label, custom months, dates, notes, status)
--  WITHOUT broadening the admin-only table RLS. All coach-capable writes
--  go through SECURITY DEFINER RPCs that check `is_admin() OR assigned_coach`.
--
--  Note: `subscriptions` = per-client ACCESS. This is manual client-access
--  management, NOT billing — it is unrelated to `coach_subscriptions`
--  (coach package/slot/billing) and does not touch any payment provider.
-- ═══════════════════════════════════════════════════════════════

-- 1. Custom subscription label (safe display name). ───────────────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_name text;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_name_len_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_name_len_check
  CHECK (plan_name IS NULL OR char_length(plan_name) <= 80);

-- 2. Custom months: widen the old plan IN (3,6,12) to 1..60. ──────
--    Safe widening — every existing row already satisfies 1..60
--    (verified pre-migration: 0 rows outside the new range).
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan >= 1 AND plan <= 60);

-- 3. Data-integrity: end must be strictly after start. ────────────
--    Validated constraint — safe (verified pre-migration: 0 rows with
--    end_date <= start_date). Defense-in-depth behind the RPC checks.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_end_after_start_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_end_after_start_check
  CHECK (end_date > start_date);

-- 4. RPC: create a client access subscription. ───────────────────
--    Authorization (admin OR the client's assigned coach) lives in SQL,
--    mirroring reactivate_subscription(). Clients are neither → blocked.
CREATE OR REPLACE FUNCTION public.create_client_subscription(
  p_client_id uuid,
  p_plan_name text,
  p_months    integer,
  p_start      date,
  p_end        date DEFAULT NULL,
  p_status     text DEFAULT 'active',
  p_notes      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_start  date := COALESCE(p_start, current_date);
  v_status text := COALESCE(NULLIF(btrim(p_status), ''), 'active');
  v_end    date;
  v_id     uuid;
BEGIN
  -- authz: admin or the client's assigned coach
  IF NOT (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = p_client_id AND p.assigned_coach = v_actor)
  ) THEN
    RAISE EXCEPTION 'permission denied: not the assigned coach or admin';
  END IF;

  -- target must be a real client account (subscriptions are client access only)
  IF p_client_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = p_client_id AND p.role = 'client') THEN
    RAISE EXCEPTION 'target is not a client account';
  END IF;

  -- validation (honest errors, never silent success). The derived end date is
  -- computed AFTER the range check so a huge p_months returns a friendly error
  -- rather than a date-overflow — and never runs before authorization.
  IF p_months IS NULL OR p_months < 1 OR p_months > 60 THEN
    RAISE EXCEPTION 'months must be between 1 and 60';
  END IF;
  IF v_status NOT IN ('active', 'pending') THEN
    RAISE EXCEPTION 'new subscription status must be active or pending';
  END IF;
  v_end := COALESCE(p_end, (v_start + make_interval(months => p_months))::date);
  IF v_end <= v_start THEN
    RAISE EXCEPTION 'end date must be after the start date';
  END IF;
  IF p_plan_name IS NOT NULL AND char_length(btrim(p_plan_name)) > 80 THEN
    RAISE EXCEPTION 'plan name must be 80 characters or fewer';
  END IF;
  IF p_notes IS NOT NULL AND char_length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'notes must be 2000 characters or fewer';
  END IF;

  INSERT INTO public.subscriptions
    (client_id, plan_name, plan, start_date, end_date, status, notes, created_by)
  VALUES
    (p_client_id, NULLIF(btrim(p_plan_name), ''), p_months, v_start, v_end,
     v_status, NULLIF(btrim(p_notes), ''), v_actor)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Revoke from BOTH public and anon: Supabase default privileges grant EXECUTE
-- to anon on new public functions, and REVOKE ... FROM public does not remove
-- that explicit anon grant. Signed-out callers must never reach this RPC.
REVOKE ALL ON FUNCTION public.create_client_subscription(uuid, text, integer, date, date, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_client_subscription(uuid, text, integer, date, date, text, text) TO authenticated;

-- 5. RPC: edit an existing client access subscription. ────────────
--    Derives the client from the subscription, then the same authz.
--    Status is limited to active/pending/expired. 'cancelled' is intentionally
--    rejected because v_client_subscription_state has no 'cancelled' branch
--    (a future-dated cancelled row would read as active and keep write access);
--    only admins may set 'expired', so coaches are limited to active/pending.
CREATE OR REPLACE FUNCTION public.update_client_subscription(
  p_subscription_id uuid,
  p_plan_name text,
  p_months    integer,
  p_start      date,
  p_end        date,
  p_status     text,
  p_notes      text DEFAULT NULL,
  p_grace_days integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_client uuid;
BEGIN
  SELECT client_id INTO v_client
  FROM public.subscriptions
  WHERE id = p_subscription_id;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'subscription not found';
  END IF;

  -- authz: admin or the client's assigned coach
  IF NOT (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_client AND p.assigned_coach = v_actor)
  ) THEN
    RAISE EXCEPTION 'permission denied: not the assigned coach or admin';
  END IF;

  -- validation (honest errors)
  IF p_months IS NULL OR p_months < 1 OR p_months > 60 THEN
    RAISE EXCEPTION 'months must be between 1 and 60';
  END IF;
  -- Status is limited to the states the effective-state view understands
  -- (active/pending/expired). 'cancelled' is intentionally NOT accepted: the
  -- view has no 'cancelled' branch, so a future-dated cancelled row would read
  -- as active and keep write access. Only an admin may end (expire) access;
  -- coaches may set active/pending only (the inline End action is admin-only).
  IF p_status IS NULL OR p_status NOT IN ('active', 'pending', 'expired') THEN
    RAISE EXCEPTION 'status must be active, pending, or expired';
  END IF;
  IF p_status = 'expired' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only an admin may expire a subscription';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'end date must be after the start date';
  END IF;
  IF p_grace_days IS NOT NULL AND (p_grace_days < 0 OR p_grace_days > 60) THEN
    RAISE EXCEPTION 'grace days must be between 0 and 60';
  END IF;
  IF p_plan_name IS NOT NULL AND char_length(btrim(p_plan_name)) > 80 THEN
    RAISE EXCEPTION 'plan name must be 80 characters or fewer';
  END IF;
  IF p_notes IS NOT NULL AND char_length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'notes must be 2000 characters or fewer';
  END IF;

  UPDATE public.subscriptions SET
    plan_name  = NULLIF(btrim(p_plan_name), ''),
    plan       = p_months,
    start_date = p_start,
    end_date   = p_end,
    status     = p_status,
    notes      = NULLIF(btrim(p_notes), ''),
    grace_days = COALESCE(p_grace_days, grace_days)
  WHERE id = p_subscription_id;

  RETURN p_subscription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_client_subscription(uuid, text, integer, date, date, text, text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_client_subscription(uuid, text, integer, date, date, text, text, integer) TO authenticated;
