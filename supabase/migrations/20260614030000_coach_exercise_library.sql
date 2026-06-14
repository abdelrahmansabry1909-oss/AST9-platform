-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Coach Exercise Library (Phase 5)
-- Idempotent. Rollback: migrations/rollbacks/20260614030000_coach_exercise_library_down.sql
--
-- Turns the shared `exercises` table into a per-coach personal library
-- without breaking the (currently empty) system library, the program
-- generator, or client F5 metadata resolution.
--
-- BEFORE (audited):
--   exercises_client_read  SELECT  USING (true)            → everyone reads ALL
--   exercises_coach_crud   ALL     USING is_coach_or_admin → any coach edits ANY
-- AFTER:
--   • coach  → sees system (created_by IS NULL) + global + OWN; never another
--              coach's private exercises. CRUD only own (or admin).
--   • client → sees ONLY exercises referenced in their OWN published program
--              (keeps F5 working; no library browsing).
--   • admin  → sees/manages all.
--
-- Safe: exercises is empty at migration time (0 rows), so no visibility
-- changes to existing data. Helper fns is_admin()/is_coach_or_admin()/
-- get_my_role() are pre-existing SECURITY DEFINER.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Coach-library fields (all nullable/defaulted → additive) ──
alter table public.exercises
  add column if not exists target_area  text,
  add column if not exists difficulty   text,
  add column if not exists equipment    text,
  add column if not exists youtube_url  text,
  add column if not exists notes        text,
  add column if not exists channel_url  text,
  add column if not exists channel_name text,
  add column if not exists is_global    boolean not null default false;

comment on column public.exercises.is_global is
  'Admin-shared exercise visible to all coaches. created_by IS NULL is also '
  'treated as system/global. A coach''s own private exercises have '
  'created_by = the coach and is_global = false.';

-- ── 2. Replace permissive policies with owner-scoped ones ───────
alter table public.exercises enable row level security;

drop policy if exists "exercises_client_read" on public.exercises;
drop policy if exists "exercises_coach_crud"  on public.exercises;
drop policy if exists "exercises_select" on public.exercises;
drop policy if exists "exercises_insert" on public.exercises;
drop policy if exists "exercises_update" on public.exercises;
drop policy if exists "exercises_delete" on public.exercises;

create policy "exercises_select" on public.exercises
  for select to authenticated using (
    public.is_admin()
    or created_by = (select auth.uid())            -- own (any role)
    or (
      public.is_coach_or_admin()                   -- staff see the shared library
      and (created_by is null or is_global = true)
    )
    or (
      public.get_my_role() = 'client'              -- clients: ONLY assigned exercises
      and exists (
        select 1 from public.client_programs cp
        where cp.client_id = (select auth.uid())
          and position(exercises.id::text in cp.program::text) > 0
      )
    )
  );

create policy "exercises_insert" on public.exercises
  for insert to authenticated with check (
    public.is_coach_or_admin()
    and (created_by = (select auth.uid()) or public.is_admin())
  );

create policy "exercises_update" on public.exercises
  for update to authenticated
  using      (public.is_admin() or created_by = (select auth.uid()))
  with check (public.is_admin() or created_by = (select auth.uid()));

create policy "exercises_delete" on public.exercises
  for delete to authenticated
  using (public.is_admin() or created_by = (select auth.uid()));

-- Smoke:
--   set role authenticated; -- (impersonate) coach sees own+system; client sees assigned only
