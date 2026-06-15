-- ════════════════════════════════════════════════════════════════
--  Phase 6 — Program modes + revision/audit trail
--
--  Adds, additively and reversibly:
--   • client_programs.program_mode  one_time | ongoing_manual | ongoing_auto
--       (ongoing_auto is RESERVED for a future coach-approved AI flow —
--        no automation is built here.)
--   • client_programs.revision / change_note / changed_by  (current state)
--   • client_program_revisions  — append-only snapshot per material change
--       (the history/audit trail). Coach/admin read-only via RLS; written
--       only by the SECURITY DEFINER versioning trigger, so the trail can't
--       be tampered with and clients never see it (they see the active
--       program only, unchanged).
--
--  Existing one-row-per-client model is preserved (UNIQUE(client_id) upsert).
--  Workout history is already snapshot-safe (workout_exercise_logs store the
--  performed exercise_name/sets; workout_sessions store workout_label) — no
--  change needed there.
--
--  Backfill: existing programs -> revision 1, mode 'one_time', plus one
--  baseline revision row each so the trail is never empty.
--
--  Reversible — see rollbacks/20260615000000_program_modes_down.sql
--
--  NOTE: this file reflects the FINAL trigger design. The live project first
--  received a single-trigger version that failed FK on the first INSERT; it was
--  corrected in-place by the follow-up `program_modes_fix_trigger` migration.
--  A fresh apply of this file alone is correct (no follow-up needed).
-- ════════════════════════════════════════════════════════════════

-- ── 1. Columns on client_programs (constant defaults = fast, additive) ──
alter table public.client_programs
  add column if not exists program_mode text not null default 'one_time',
  add column if not exists revision     int  not null default 1,
  add column if not exists change_note  text,
  add column if not exists changed_by   uuid references public.profiles(id) on delete set null;

alter table public.client_programs drop constraint if exists client_programs_mode_chk;
alter table public.client_programs
  add constraint client_programs_mode_chk
  check (program_mode in ('one_time','ongoing_manual','ongoing_auto'));

-- ── 2. Append-only revision/audit table ──
create table if not exists public.client_program_revisions (
  id           uuid primary key default gen_random_uuid(),
  program_id   uuid references public.client_programs(id) on delete cascade,
  client_id    uuid not null references public.profiles(id) on delete cascade,
  coach_id     uuid references public.profiles(id) on delete set null,
  revision     int  not null,
  program      jsonb not null,
  program_mode text,
  change_note  text,
  changed_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_cpr_client  on public.client_program_revisions(client_id, created_at desc);
create index if not exists idx_cpr_program on public.client_program_revisions(program_id, revision desc);

alter table public.client_program_revisions enable row level security;

-- Read: admin / owning coach / assigned coach. No client access (client sees
-- the active program only). No insert/update/delete policy — the trail is
-- written solely by the SECURITY DEFINER trigger below.
drop policy if exists "cpr_select" on public.client_program_revisions;
create policy "cpr_select" on public.client_program_revisions
  for select to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = client_program_revisions.client_id
        and p.assigned_coach = (select auth.uid())
    )
  );

-- ── 3. Baseline snapshot for existing programs ──
insert into public.client_program_revisions
  (program_id, client_id, coach_id, revision, program, program_mode, change_note, changed_by, created_at)
select id, client_id, coach_id, 1, program, 'one_time', 'Baseline (pre-versioning)', coach_id,
       coalesce(published_at, updated_at, now())
from public.client_programs cp
where not exists (
  select 1 from public.client_program_revisions r where r.program_id = cp.id
);

-- ── 4. Versioning triggers ──
-- Split into BEFORE (mutate the row: revision/changed_by/updated_at) + AFTER
-- (append the audit snapshot once the parent row exists). A single BEFORE
-- trigger can't write the child row on a first INSERT (the parent row doesn't
-- exist yet → FK violation) and would misfire under ON CONFLICT, hence two.

-- BEFORE: bump revision + stamp editor, only on a material change.
create or replace function public.tg_cp_revision_set()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.revision   := 1;
    new.changed_by := coalesce(auth.uid(), new.changed_by, new.coach_id);
    new.updated_at := now();
  elsif new.program      is distinct from old.program
        or new.program_mode is distinct from old.program_mode
        or new.change_note  is distinct from old.change_note then
    new.revision   := coalesce(old.revision, 0) + 1;
    new.changed_by := coalesce(auth.uid(), new.changed_by, new.coach_id);
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- AFTER: write the immutable snapshot (skip no-op updates). SECURITY DEFINER
-- so the audit insert bypasses RLS — the trail can't be user-tampered.
create or replace function public.tg_cp_revision_snap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.program      is not distinct from old.program
     and new.program_mode is not distinct from old.program_mode
     and new.change_note  is not distinct from old.change_note then
    return null;
  end if;
  insert into public.client_program_revisions
    (program_id, client_id, coach_id, revision, program, program_mode, change_note, changed_by)
    values (new.id, new.client_id, new.coach_id, new.revision, new.program,
            new.program_mode, new.change_note, new.changed_by);
  return null;
end;
$$;

drop trigger if exists trg_cp_revision_set  on public.client_programs;
drop trigger if exists trg_cp_revision_snap on public.client_programs;
create trigger trg_cp_revision_set  before insert or update on public.client_programs
  for each row execute function public.tg_cp_revision_set();
create trigger trg_cp_revision_snap after  insert or update on public.client_programs
  for each row execute function public.tg_cp_revision_snap();

-- Trigger functions are invoked by the trigger system, never by API callers —
-- keep them off the REST RPC surface.
revoke all on function public.tg_cp_revision_set()  from public, anon, authenticated;
revoke all on function public.tg_cp_revision_snap() from public, anon, authenticated;
