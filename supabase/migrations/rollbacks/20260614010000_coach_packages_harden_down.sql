-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK — Coach Packages hardening (Phase 2 follow-up)
-- Restores the pre-hardening state of 20260614010000.
-- ═══════════════════════════════════════════════════════════════

-- Restore the default PUBLIC execute grant on the two RPCs.
grant execute on function public.coach_slot_status(uuid)                    to public;
grant execute on function public.admin_set_coach_package(uuid, text, int, text) to public;

-- Recreate the trigger function without the pinned search_path.
create or replace function public.touch_coach_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin new.updated_at = now(); return new; end;
$$;
