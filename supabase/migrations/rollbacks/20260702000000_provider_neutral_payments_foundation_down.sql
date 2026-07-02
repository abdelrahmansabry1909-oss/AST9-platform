-- ═══════════════════════════════════════════════════════════════
-- Rollback for 20260702000000_provider_neutral_payments_foundation
-- Drops ONLY the objects/columns created by that (additive) migration and
-- returns coach_subscriptions to its exact prior shape. Touches nothing else:
-- NOT subscriptions / v_client_subscription_state / reactivate_subscription,
-- NOT admin_set_coach_package, NOT coach_slot_status, NOT auth/legal/program/
-- workout/athletic objects.
-- ═══════════════════════════════════════════════════════════════

-- ── 3. service-role RPC ──────────────────────────────────────────
drop function if exists public.apply_paid_coach_package_period_system(
  text, text, uuid, text, integer, timestamptz, timestamptz, integer, text, text, text, jsonb
);

-- ── 2. provider-neutral columns (drops their inline CHECKs with them) ──
alter table public.coach_subscriptions drop column if exists billing_currency;
alter table public.coach_subscriptions drop column if exists last_payment_status;
alter table public.coach_subscriptions drop column if exists cancel_at_period_end;
alter table public.coach_subscriptions drop column if exists current_period_end;
alter table public.coach_subscriptions drop column if exists provider_subscription_id;
alter table public.coach_subscriptions drop column if exists provider_customer_id;
alter table public.coach_subscriptions drop column if exists provider;

-- ── 1. ledger (drops its policy, indexes, and unique constraint too) ──
drop table if exists public.payment_events;
