-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK for: 20260629000000_program_versioning_publish_rpc.sql
-- Phase R2B — Program Versioning + Single Active Published Program Rule
--
-- Lives OUTSIDE supabase/migrations/ on purpose so it is never auto-applied
-- as a forward migration. Run it manually (SQL editor / MCP execute_sql) to
-- revert R2B.
--
-- Reverts ONLY what the forward migration introduced:
--   • function public.publish_program_version(uuid, text)
--   • partial unique index uq_cpv_one_active_per_client
--   • the tightened "cpv_select" client branch (restores the E1b original)
--   • CHECK client_program_versions_draft_unpublished_chk
--   • CHECK client_program_versions_active_published_chk
--   • the 'draft' value added to client_program_versions_status_check
--
-- Touches NOTHING else: client_programs, client_program_revisions, workout_*
-- (logs are never rewritten), profiles, auth, legal, athletic — all untouched.
--
-- NOTE: to restore the original (narrower) status CHECK, any rows currently in
-- the NEW 'draft' status are first converted to 'archived' (both are coach-only,
-- non-active, never client-visible). This is the minimal data change required to
-- reinstate the original constraint; no published/active/superseded rows and no
-- workout logs are affected.
-- ═══════════════════════════════════════════════════════════════

-- 1. Drop the RPC.
drop function if exists public.publish_program_version(uuid, text);

-- 2. Drop the single-active partial unique index.
drop index if exists public.uq_cpv_one_active_per_client;

-- 3. Restore the ORIGINAL E1b "cpv_select" policy (client branch WITHOUT the
--    status='active' tightening — i.e. published + effective_from only).
drop policy if exists "cpv_select" on public.client_program_versions;
create policy "cpv_select" on public.client_program_versions
  for select to authenticated
  using (
    (client_id = (select auth.uid()) and published = true and effective_from <= now())
    or public.is_admin()
    or coach_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = client_program_versions.client_id
        and p.assigned_coach = (select auth.uid())
    )
  );

-- 4. Drop the draft-unpublished and active-published guards.
alter table public.client_program_versions
  drop constraint if exists client_program_versions_draft_unpublished_chk;
alter table public.client_program_versions
  drop constraint if exists client_program_versions_active_published_chk;

-- 5. Convert any 'draft' rows to 'archived' so the original CHECK can be restored.
update public.client_program_versions
   set status = 'archived', updated_at = now()
 where status = 'draft';

-- 6. Restore the original four-value status CHECK.
alter table public.client_program_versions
  drop constraint if exists client_program_versions_status_check;
alter table public.client_program_versions
  add constraint client_program_versions_status_check
  check (status in ('scheduled','active','superseded','archived'));
