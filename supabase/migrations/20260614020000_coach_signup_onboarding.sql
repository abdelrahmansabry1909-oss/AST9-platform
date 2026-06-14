-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Coach signup onboarding state (Phase 4)
-- Idempotent. Rollback: migrations/rollbacks/20260614020000_coach_signup_onboarding_down.sql
--
-- Adds first-login onboarding state for coaches. Public coach SIGNUP uses
-- Supabase's built-in auth.signUp (mailer_autoconfirm = false → real email
-- verification); the handle_new_user trigger still forces role=client (no
-- spoofing). Promotion client→coach happens in the claim-coach edge
-- function (service role, after email verification) — NOT here.
--
-- This migration only stores onboarding completion + the completion RPC.
-- ═══════════════════════════════════════════════════════════════

-- 1. Onboarding completion timestamp (NULL = tour not yet finished/skipped)
alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.profiles.onboarding_completed_at is
  'When the coach finished or skipped the first-login tour. NULL = show the '
  'tour. Backfilled to now() for pre-Phase-4 coaches/admins so they are not '
  'disrupted. New self-signup coaches start NULL.';

-- 2. Backfill: existing coaches/admins should NOT see the tour.
update public.profiles
   set onboarding_completed_at = now()
 where onboarding_completed_at is null
   and role in ('coach', 'admin');

-- 3. complete_onboarding() — the coach marks their own tour done.
-- SECURITY DEFINER + single-purpose so it can only ever set this one
-- column for the caller (cannot be abused to touch role/assigned_coach).
create or replace function public.complete_onboarding()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
     set onboarding_completed_at = now()
   where id = auth.uid()
     and onboarding_completed_at is null;
end;
$$;

revoke execute on function public.complete_onboarding() from public, anon;
grant  execute on function public.complete_onboarding() to authenticated;

-- Smoke:
--   select public.complete_onboarding();   -- as an authenticated coach
