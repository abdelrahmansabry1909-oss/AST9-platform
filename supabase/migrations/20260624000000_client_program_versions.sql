-- ════════════════════════════════════════════════════════════════
--  Phase E1b-1 — Effective-date program versioning (FOUNDATION)
--
--  Adds public.client_program_versions: a per-client timeline of program
--  versions, each with an effective_from instant. The client is served the
--  version with the greatest effective_from <= now(). RLS enforces the date
--  boundary with SERVER time (now()), so a client can never read a FUTURE
--  (scheduled) version — date gating is not trusted to the browser.
--
--  client_programs is UNCHANGED and remains the live "current pointer":
--   • the existing publish flow keeps writing client_programs as today;
--   • this phase only ADDS the versions table + backfill + a serving overlay
--     in resolveClientProgram (it serves a version only when that version is
--     at least as fresh as the client_programs pointer, so a normal republish
--     is never shadowed by a stale baseline version);
--   • clients with no version row fall back to client_programs (back-compat).
--
--  History is already snapshot-safe (workout_exercise_logs copy name/sets;
--  workout_sessions copy workout_label/program_id) — those tables are NOT
--  touched here.
--
--  Additive · reversible · idempotent.
--  Rollback: supabase/rollbacks/20260624000000_client_program_versions_down.sql
--
--  Depends on:
--   • public.is_admin()            — 20260515000000_rpm_foundation.sql
--   • public.profiles.assigned_coach
--   • public.client_programs       — 20260522000000_client_program_publish.sql
-- ════════════════════════════════════════════════════════════════

-- ── 1. Table ─────────────────────────────────────────────────────
create table if not exists public.client_program_versions (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.profiles(id)        on delete cascade,
  coach_id          uuid          references public.profiles(id)        on delete set null,
  program           jsonb not null,                       -- full program JSON (workouts[], schedule[], exercise_id+video_url per row)
  effective_from    timestamptz not null default now(),   -- when the client starts seeing this version
  status            text not null default 'scheduled'
                      check (status in ('scheduled','active','superseded','archived')),
  published         boolean not null default true,
  source_program_id uuid references public.client_programs(id) on delete set null,
  source_revision   int,                                  -- client_programs.revision this was derived from
  change_note       text,
  created_by        uuid references public.profiles(id)   on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  published_at      timestamptz default now(),
  unique (client_id, effective_from)                      -- one version per instant per client
);

-- ── 2. Indexes (serving path + status filtering) ─────────────────
create index if not exists idx_cpv_client_eff
  on public.client_program_versions(client_id, effective_from desc);
create index if not exists idx_cpv_client_status
  on public.client_program_versions(client_id, status);

comment on table public.client_program_versions is
  'Phase E1b — per-client timeline of program versions. Client is served the '
  'version with the greatest effective_from <= now() (RLS enforces the server-'
  'time date boundary). client_programs remains the live current pointer.';

-- ── 3. Row Level Security ────────────────────────────────────────
alter table public.client_program_versions enable row level security;

-- SELECT
--   Client: ONLY their own, published, and already-effective versions
--           (effective_from <= now() ⇒ future schedules are invisible).
--   Coach/admin: full visibility incl. scheduled, for management.
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

-- INSERT / UPDATE / DELETE: admin or the ASSIGNED coach only.
-- (Mirrors client_programs_coach_all. No client write path exists.)
drop policy if exists "cpv_write" on public.client_program_versions;
create policy "cpv_write" on public.client_program_versions
  for all to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = client_program_versions.client_id
        and p.assigned_coach = (select auth.uid())
    )
  )
  with check (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = client_program_versions.client_id
        and p.assigned_coach = (select auth.uid())
    )
  );

-- ── 4. updated_at touch (BEFORE) — reuse the established pattern ──
create or replace function public.tg_cpv_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_cpv_touch on public.client_program_versions;
create trigger trg_cpv_touch before update on public.client_program_versions
  for each row execute function public.tg_cpv_touch();

-- Trigger function is invoked by the trigger system, never by API callers.
revoke all on function public.tg_cpv_touch() from public, anon, authenticated;

-- ── 5. Baseline backfill (idempotent · safe for clients with no program) ──
-- Seed exactly one ACTIVE baseline version per existing PUBLISHED program.
-- published_at/effective_from are set to the program's own publish time so the
-- serving overlay treats the version as equal-fresh to the pointer (invisible:
-- identical content). Skips clients that already have any version row, and
-- skips unpublished/absent programs (no version is created for them).
insert into public.client_program_versions
  (client_id, coach_id, program, effective_from, status, published,
   source_program_id, source_revision, change_note, created_by, created_at, published_at)
select
  cp.client_id,
  cp.coach_id,
  cp.program,
  coalesce(cp.published_at, cp.updated_at, now()),
  'active',
  true,
  cp.id,
  cp.revision,
  'Baseline (pre-versioning)',
  cp.coach_id,
  coalesce(cp.published_at, cp.updated_at, now()),
  coalesce(cp.published_at, cp.updated_at, now())
from public.client_programs cp
where cp.published = true
  and cp.program is not null
  and (cp.program ? 'structure' or cp.program ? 'workouts')
  and not exists (
    select 1 from public.client_program_versions v
    where v.client_id = cp.client_id
  );

-- ── 6. Smoke (each should succeed) ──────────────────────────────
--   SELECT count(*) FROM public.client_program_versions;
--   -- as a client (impersonated): only own rows with effective_from <= now()
--   SELECT id, effective_from, status FROM public.client_program_versions
--     WHERE client_id = auth.uid();
