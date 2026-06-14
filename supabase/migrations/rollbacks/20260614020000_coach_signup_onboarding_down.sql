-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK — Coach signup onboarding state (Phase 4)
-- Reverses 20260614020000_coach_signup_onboarding.sql.
-- Drops only the onboarding RPC + column. Auth/role logic untouched.
-- ═══════════════════════════════════════════════════════════════

drop function if exists public.complete_onboarding();
alter table public.profiles drop column if exists onboarding_completed_at;
