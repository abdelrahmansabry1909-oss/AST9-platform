-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Client onboarding backfill (story tour, coach + client)
-- Idempotent. Rollback: migrations/rollbacks/20260808000000_client_onboarding_backfill_down.sql
--
-- The onboarding tour is being extended from coaches to clients. Its gate is
-- `profiles.onboarding_completed_at IS NULL`, and 20260614020000 backfilled
-- only `role in ('coach','admin')` because no client tour existed then.
--
-- Every existing client therefore still reads NULL. Extending the gate without
-- this migration would show the first-login tour to the ENTIRE existing client
-- base on their next login — the opposite of "new clients only".
--
-- Measured on production immediately before applying:
--   admin  1 total — 0 would see the tour
--   coach  2 total — 0 would see the tour
--   client 6 total — 6 would see the tour   <- the rows this migration fixes
--
-- No RPC change is required: complete_onboarding() is already role-agnostic
-- (`where id = auth.uid()`), so it serves clients unchanged.
-- ═══════════════════════════════════════════════════════════════

-- Existing clients should NOT see the first-login tour. Only clients created
-- after this point start NULL and are toured once.
update public.profiles
   set onboarding_completed_at = now()
 where onboarding_completed_at is null
   and role = 'client';

-- Re-running is a no-op: the predicate no longer matches the rows it just set.

comment on column public.profiles.onboarding_completed_at is
  'When the user finished or skipped the first-login tour. NULL = show the '
  'tour. Applies to coaches AND clients as of 2026-08-08. Pre-existing '
  'coaches/admins were backfilled by 20260614020000 and pre-existing clients '
  'by 20260808000000, so only genuinely new accounts are toured.';

-- Smoke:
--   select role, count(*) filter (where onboarding_completed_at is null)
--     from public.profiles group by role;   -- expect 0 for every existing role
