-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK — Coach Packages + Billing Foundation (Phase 2)
-- Reverses 20260614000000_coach_packages_foundation.sql.
--
-- Safe: drops only the new billing objects. The per-CLIENT
-- public.subscriptions table + v_client_subscription_state are NOT
-- touched. Dropping coach_subscriptions removes the backfilled rows
-- (data-only, no FK fan-out beyond this table).
-- ═══════════════════════════════════════════════════════════════

drop function if exists public.admin_set_coach_package(uuid, text, int, text);
drop function if exists public.coach_slot_status(uuid);

drop trigger if exists coach_subscriptions_touch on public.coach_subscriptions;
drop function if exists public.touch_coach_subscriptions_updated_at();

drop policy if exists "coach_subscriptions_select" on public.coach_subscriptions;
drop table if exists public.coach_subscriptions;
