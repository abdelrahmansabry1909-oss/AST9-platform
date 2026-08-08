-- ═══════════════════════════════════════════════════════════════
-- Rollback for 20260808000000_client_onboarding_backfill.sql
--
-- Restores clients to NULL so they are treated as un-toured again.
--
-- PRECISION NOTE — read before running.
-- This clears `onboarding_completed_at` for EVERY client, not only the rows the
-- migration set. It cannot distinguish them, because a backfilled row and a
-- genuinely completed row are the same shape.
--
--   * Run BEFORE the client tour ships → exact. No client can have completed a
--     tour that does not exist yet, so every non-NULL client value is one this
--     migration wrote.
--   * Run AFTER the client tour ships → also clears real completions, and those
--     clients see the tour once more. Annoying, not destructive: no data is
--     lost and the tour is skippable.
--
-- Coaches and admins are untouched in both directions.
-- ═══════════════════════════════════════════════════════════════

update public.profiles
   set onboarding_completed_at = null
 where role = 'client';

comment on column public.profiles.onboarding_completed_at is
  'When the coach finished or skipped the first-login tour. NULL = show the '
  'tour. Backfilled to now() for pre-Phase-4 coaches/admins so they are not '
  'disrupted. New self-signup coaches start NULL.';
