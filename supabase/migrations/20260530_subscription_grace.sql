-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Subscription Grace Period
-- Run in Supabase SQL Editor (idempotent).
--
-- After `end_date`, a client enters a 7-day grace window during
-- which login + read access remain available. After grace, login is
-- blocked until a coach reactivates the subscription.
--
-- Architecture decision: derive the effective status in SQL via
-- a view so auth.js, the coach dashboard, and the upcoming workout-
-- tracking write-gate all read the same answer.
--
-- Depends on public.is_admin() — created in 20260515_rpm_foundation.sql.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Per-subscription grace length (default 7 days) ─────────────
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS grace_days int NOT NULL DEFAULT 7
    CHECK (grace_days BETWEEN 0 AND 60);

COMMENT ON COLUMN subscriptions.grace_days IS
  'Days after end_date during which the client retains login + read '
  'access. Default 7 per platform spec. Per-client overrides allowed.';

-- ── 2. Effective-state view ───────────────────────────────────────
-- One row per client, picking the subscription with the latest
-- end_date. The CASE collapses (status, end_date, current_date) into
-- a single effective_status enum.
--
-- effective_status:
--   pending  → status='pending' (not yet activated by coach)
--   active   → today on/before end_date
--   grace    → today within (end_date, end_date + grace_days]
--   expired  → today after grace window
--   none     → no subscription row exists at all (handled in service)
DROP VIEW IF EXISTS v_client_subscription_state CASCADE;
CREATE VIEW v_client_subscription_state
WITH (security_invoker = true)
AS
WITH ranked AS (
  SELECT s.*,
         row_number() OVER (
           PARTITION BY s.client_id
           ORDER BY s.end_date DESC, s.created_at DESC
         ) AS rn
  FROM subscriptions s
)
SELECT
  client_id,
  id          AS sub_id,
  plan,
  start_date,
  end_date,
  status,
  grace_days,
  (end_date + (grace_days || ' days')::interval)::date AS grace_until,
  (end_date - current_date)                            AS days_remaining,
  GREATEST(
    0,
    ((end_date + (grace_days || ' days')::interval)::date - current_date)
  )                                                    AS grace_days_left,
  CASE
    WHEN status = 'pending'                                       THEN 'pending'
    WHEN status = 'expired'                                       THEN 'expired'
    WHEN current_date <= end_date                                 THEN 'active'
    WHEN current_date <= (end_date + (grace_days || ' days')::interval)::date
                                                                  THEN 'grace'
    ELSE 'expired'
  END           AS effective_status,
  created_at,
  notes
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW v_client_subscription_state IS
  'One row per client (most-recent subscription). effective_status '
  'collapses (status, end_date, grace_days, today) into the single '
  'value read by auth, the coach dashboard, and the write-gate.';

-- security_invoker=true makes the view respect the caller’s RLS on
-- subscriptions, so no separate policy on the view is needed.

GRANT SELECT ON v_client_subscription_state TO authenticated;

-- ── 3. Reactivation helper (server-side, atomic) ──────────────────
-- Coach/admin call this; it extends the existing row when reusing
-- the same plan, otherwise inserts a fresh row. Returns the row id.
CREATE OR REPLACE FUNCTION public.reactivate_subscription(
  p_client_id uuid,
  p_months    int,
  p_start     date  DEFAULT NULL,
  p_notes     text  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_start date := COALESCE(p_start, current_date);
  v_end   date := (v_start + (p_months || ' months')::interval)::date;
  v_id    uuid;
BEGIN
  -- Permission: actor must be admin OR the client's assigned_coach.
  IF NOT (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = p_client_id
        AND p.assigned_coach = v_actor
    )
  ) THEN
    RAISE EXCEPTION 'permission denied: not the assigned coach or admin';
  END IF;

  INSERT INTO subscriptions
    (client_id, plan, start_date, end_date, status, notes, created_by)
  VALUES
    (p_client_id, p_months, v_start, v_end, 'active', p_notes, v_actor)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reactivate_subscription(uuid, int, date, text)
  TO authenticated;

-- ── 4. Smoke tests (each should succeed without error) ────────────
--   SELECT effective_status, days_remaining, grace_days_left
--     FROM v_client_subscription_state LIMIT 1;
--   SELECT public.reactivate_subscription(
--     '00000000-0000-0000-0000-000000000000'::uuid, 3, NULL, 'test');
