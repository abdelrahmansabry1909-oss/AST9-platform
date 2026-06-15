-- ════════════════════════════════════════════════════════════════
--  Rollback for 20260615000000_program_modes.sql
--  Removes the versioning trigger, audit table, and the added columns.
--  Existing client_programs rows + their program jsonb are untouched.
-- ════════════════════════════════════════════════════════════════

drop trigger   if exists trg_cp_revision_set  on public.client_programs;
drop trigger   if exists trg_cp_revision_snap on public.client_programs;
drop trigger   if exists trg_client_programs_revision on public.client_programs;  -- pre-hotfix name
drop function  if exists public.tg_cp_revision_set();
drop function  if exists public.tg_cp_revision_snap();
drop function  if exists public.tg_client_programs_revision();                    -- pre-hotfix name
drop table     if exists public.client_program_revisions;

alter table public.client_programs drop constraint if exists client_programs_mode_chk;
alter table public.client_programs
  drop column if exists program_mode,
  drop column if exists revision,
  drop column if exists change_note,
  drop column if exists changed_by;
