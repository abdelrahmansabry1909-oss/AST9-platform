-- ═══════════════════════════════════════════════════════════════
--  DOWN — Phase A client access subscription management
--  Reverses 20260710000000_client_subscription_management.sql.
--
--  ⚠️  WARNING: restoring the old plan IN (3,6,12) constraint will FAIL
--  if any subscription created after this migration used a custom month
--  count (anything other than 3/6/12). Reconcile those rows first, e.g.:
--    UPDATE public.subscriptions SET plan = 3 WHERE plan NOT IN (3,6,12);
--  before running this rollback. plan_name is dropped (data lost).
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.update_client_subscription(uuid, text, integer, date, date, text, text, integer);
DROP FUNCTION IF EXISTS public.create_client_subscription(uuid, text, integer, date, date, text, text);

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_end_after_start_check;

-- Restore the original narrow month constraint.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan = ANY (ARRAY[3, 6, 12]));

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_name_len_check;
ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS plan_name;
