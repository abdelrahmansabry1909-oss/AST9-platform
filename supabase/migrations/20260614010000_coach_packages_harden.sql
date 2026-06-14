-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Coach Packages hardening (Phase 2 follow-up)
-- Addresses Supabase advisors 0011 (mutable search_path) and
-- 0028/0029 (SECURITY DEFINER callable by anon/authenticated) on the
-- objects added in 20260614000000_coach_packages_foundation.sql.
-- Idempotent. Rollback: rollbacks/20260614010000_coach_packages_harden_down.sql
--
-- The RPC bodies already enforce admin/self authorization and would
-- reject anon (auth.uid() is null). This change matches the project's
-- established posture for privileged RPCs (reactivate_subscription,
-- set_client_phase, notify): revoke the default PUBLIC execute and grant
-- only to authenticated — defense in depth, no behaviour change for
-- legitimate signed-in callers.
-- ═══════════════════════════════════════════════════════════════

-- 1) Pin search_path on the (non-DEFINER) trigger function.
create or replace function public.touch_coach_subscriptions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin new.updated_at = now(); return new; end;
$$;

-- 2) Restrict the two RPCs to authenticated only.
revoke execute on function public.coach_slot_status(uuid)                    from public, anon;
revoke execute on function public.admin_set_coach_package(uuid, text, int, text) from public, anon;
grant  execute on function public.coach_slot_status(uuid)                    to authenticated;
grant  execute on function public.admin_set_coach_package(uuid, text, int, text) to authenticated;
