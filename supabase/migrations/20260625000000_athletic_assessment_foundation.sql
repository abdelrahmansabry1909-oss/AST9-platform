-- ════════════════════════════════════════════════════════════════
--  Phase F2B — Athletic Performance: Assessment Foundation
--
--  Adds the first real backend for the Athletic Performance service lane
--  (athlete story intake + assessment batteries + assessment sessions +
--  long-format test results). ADDITIVE and INDEPENDENT — touches NO existing
--  table (profiles is only referenced by FK; rehab assessments, client_programs,
--  client_program_versions, workout_sessions/_logs are NOT touched).
--
--  Security model (RLS, server-side — NEVER the frontend service switcher):
--   • Admin/owner            → manage all.
--   • Assigned/owning coach   → manage only their assigned athletes' records.
--   • Unassigned coach        → blocked.
--   • Client (athlete)        → NO access in F2 (no read, no write). A future
--                               athlete-facing summary will add a scoped read
--                               behind an explicit share flag.
--   • assessment_batteries    → coaches read system/default batteries; only
--                               admin manages defaults; coaches manage their own.
--
--  Scoring is deferred: raw_value + self-referential derivations (trend /
--  asymmetry / confidence) + coach notes only. ast9_score / reference_band are
--  nullable and unused in F2 (AST9 reference bands come later, grown from our
--  own athlete data — NEVER copied from any external normative table).
--
--  Additive · idempotent · reversible.
--  Rollback: supabase/rollbacks/20260625000000_athletic_assessment_foundation_down.sql
--
--  Depends on: public.is_admin() (20260515…), public.profiles(id, assigned_coach).
-- ════════════════════════════════════════════════════════════════

-- ── Shared updated_at touch (BEFORE) — safe search_path, off the API ──
create or replace function public.tg_athletic_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.tg_athletic_touch() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 1. athlete_profiles — one current sport-performance identity per athlete
-- ════════════════════════════════════════════════════════════════
create table if not exists public.athlete_profiles (
  id                       uuid primary key default gen_random_uuid(),
  client_id                uuid not null references public.profiles(id) on delete cascade,
  coach_id                 uuid          references public.profiles(id) on delete set null,
  sport                    text,
  position                 text,
  level                    text,
  training_age_years       numeric,
  dominant_side            text not null default 'unknown'
                             check (dominant_side in ('left','right','bilateral','unknown')),
  season_phase             text not null default 'unknown'
                             check (season_phase in ('off','pre','in','post','unknown')),
  goals                    jsonb,
  competition_dates        jsonb,
  available_days_per_week  int,
  session_duration_minutes int,
  equipment                jsonb,
  training_environment     text,
  injury_history           jsonb,
  current_flags            jsonb,
  created_by               uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (client_id)
);
create index if not exists idx_athlete_profiles_coach on public.athlete_profiles(coach_id);
create index if not exists idx_athlete_profiles_sport on public.athlete_profiles(sport, position);

alter table public.athlete_profiles enable row level security;
drop policy if exists "athlete_profiles_all" on public.athlete_profiles;
create policy "athlete_profiles_all" on public.athlete_profiles
  for all to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_profiles.client_id and p.assigned_coach = (select auth.uid()))
  )
  with check (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_profiles.client_id and p.assigned_coach = (select auth.uid()))
  );

drop trigger if exists trg_athlete_profiles_touch on public.athlete_profiles;
create trigger trg_athlete_profiles_touch before update on public.athlete_profiles
  for each row execute function public.tg_athletic_touch();

-- ════════════════════════════════════════════════════════════════
-- 2. assessment_batteries — reusable test-battery templates
--    coach_id NULL + is_default = AST9 system battery (read by all coaches).
-- ════════════════════════════════════════════════════════════════
create table if not exists public.assessment_batteries (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid references public.profiles(id) on delete cascade,
  name        text not null,
  sport       text,
  position    text,
  level       text,
  test_order  jsonb not null default '[]'::jsonb,   -- [{category, test_key, target?}, …]
  is_default  boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_batteries_coach   on public.assessment_batteries(coach_id);
create index if not exists idx_batteries_default on public.assessment_batteries(is_default);

alter table public.assessment_batteries enable row level security;

-- Read: admin, owner-coach, OR any default/system battery.
drop policy if exists "batteries_select" on public.assessment_batteries;
create policy "batteries_select" on public.assessment_batteries
  for select to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or is_default = true
  );

-- Write: admin manages anything; a coach manages only their OWN non-default
-- batteries (cannot create or alter system/default batteries).
drop policy if exists "batteries_insert" on public.assessment_batteries;
create policy "batteries_insert" on public.assessment_batteries
  for insert to authenticated
  with check (
    public.is_admin()
    or (coach_id = (select auth.uid()) and is_default = false)
  );

drop policy if exists "batteries_update" on public.assessment_batteries;
create policy "batteries_update" on public.assessment_batteries
  for update to authenticated
  using (
    public.is_admin()
    or (coach_id = (select auth.uid()) and is_default = false)
  )
  with check (
    public.is_admin()
    or (coach_id = (select auth.uid()) and is_default = false)
  );

drop policy if exists "batteries_delete" on public.assessment_batteries;
create policy "batteries_delete" on public.assessment_batteries
  for delete to authenticated
  using (
    public.is_admin()
    or (coach_id = (select auth.uid()) and is_default = false)
  );

drop trigger if exists trg_batteries_touch on public.assessment_batteries;
create trigger trg_batteries_touch before update on public.assessment_batteries
  for each row execute function public.tg_athletic_touch();

-- ════════════════════════════════════════════════════════════════
-- 3. athlete_assessments — one assessment session / test day
-- ════════════════════════════════════════════════════════════════
create table if not exists public.athlete_assessments (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.profiles(id) on delete cascade,
  coach_id      uuid          references public.profiles(id) on delete set null,
  battery_id    uuid          references public.assessment_batteries(id) on delete set null,
  assessed_at   timestamptz not null default now(),
  season_phase  text check (season_phase is null or season_phase in ('off','pre','in','post','unknown')),
  conditions    jsonb,
  notes         text,
  status        text not null default 'draft' check (status in ('draft','final')),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_assessments_client  on public.athlete_assessments(client_id, assessed_at desc);
create index if not exists idx_assessments_coach    on public.athlete_assessments(coach_id);
create index if not exists idx_assessments_battery  on public.athlete_assessments(battery_id);
create index if not exists idx_assessments_status   on public.athlete_assessments(status);

alter table public.athlete_assessments enable row level security;
drop policy if exists "assessments_all" on public.athlete_assessments;
create policy "assessments_all" on public.athlete_assessments
  for all to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_assessments.client_id and p.assigned_coach = (select auth.uid()))
  )
  with check (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_assessments.client_id and p.assigned_coach = (select auth.uid()))
  );

drop trigger if exists trg_assessments_touch on public.athlete_assessments;
create trigger trg_assessments_touch before update on public.athlete_assessments
  for each row execute function public.tg_athletic_touch();

-- ════════════════════════════════════════════════════════════════
-- 4. athlete_test_results — long-format, one row per measured thing.
--    client_id/coach_id denormalized for fast joinless RLS.
-- ════════════════════════════════════════════════════════════════
create table if not exists public.athlete_test_results (
  id               uuid primary key default gen_random_uuid(),
  assessment_id    uuid not null references public.athlete_assessments(id) on delete cascade,
  client_id        uuid not null references public.profiles(id) on delete cascade,
  coach_id         uuid          references public.profiles(id) on delete set null,
  category         text not null,
  test_key         text not null,
  raw_value        numeric,
  text_value       text,
  unit             text,
  side             text not null default 'na' check (side in ('left','right','bilateral','na')),
  trial_n          int,
  best_of          int,
  protocol_version text,
  conditions       jsonb,
  ast9_score       numeric,                                   -- deferred (nullable)
  score_confidence text check (score_confidence is null or score_confidence in ('high','medium','low')),
  reference_band   text,                                      -- deferred (nullable)
  asymmetry_pct    numeric,
  trend_dir        text check (trend_dir is null or trend_dir in ('up','down','flat')),
  coach_note       text,
  is_retest        boolean not null default false,
  assessed_at      timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (assessment_id, test_key, side, trial_n)            -- dedupe trials (NULL trial_n stays distinct)
);
create index if not exists idx_results_assessment    on public.athlete_test_results(assessment_id);
create index if not exists idx_results_client_test   on public.athlete_test_results(client_id, test_key, assessed_at desc);
create index if not exists idx_results_client_cat    on public.athlete_test_results(client_id, category, assessed_at desc);
create index if not exists idx_results_coach         on public.athlete_test_results(coach_id);
create index if not exists idx_results_category      on public.athlete_test_results(category);
create index if not exists idx_results_test_key      on public.athlete_test_results(test_key);

alter table public.athlete_test_results enable row level security;
drop policy if exists "results_all" on public.athlete_test_results;
create policy "results_all" on public.athlete_test_results
  for all to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_test_results.client_id and p.assigned_coach = (select auth.uid()))
  )
  with check (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athlete_test_results.client_id and p.assigned_coach = (select auth.uid()))
  );

drop trigger if exists trg_results_touch on public.athlete_test_results;
create trigger trg_results_touch before update on public.athlete_test_results
  for each row execute function public.tg_athletic_touch();

-- ════════════════════════════════════════════════════════════════
-- 5. AST9 default batteries (system templates) — idempotent seed.
--    All test_keys are ORIGINAL AST9 keys; ordered by the AST9 fatigue-
--    minimizing sequence. No external/copyrighted names, norms, or tables.
-- ════════════════════════════════════════════════════════════════
insert into public.assessment_batteries (coach_id, name, test_order, is_default, created_by)
select null, b.name, b.test_order, true, null
from (values
  ('AST9 General Athletic Screen', '[
     {"category":"body_composition","test_key":"body_mass"},
     {"category":"readiness","test_key":"readiness_score"},
     {"category":"mobility","test_key":"ankle_df"},
     {"category":"power","test_key":"cmj_height"},
     {"category":"power","test_key":"broad_jump"},
     {"category":"speed","test_key":"sprint_20m"},
     {"category":"strength","test_key":"squat_est_max"},
     {"category":"anaerobic_capacity","test_key":"shuttle_300"}
   ]'::jsonb),
  ('AST9 Sprint-Sport Screen', '[
     {"category":"readiness","test_key":"readiness_score"},
     {"category":"mobility","test_key":"hip_ext"},
     {"category":"power","test_key":"cmj_height"},
     {"category":"power","test_key":"rsi"},
     {"category":"acceleration","test_key":"split_0_10m"},
     {"category":"max_velocity","test_key":"fly_30_40m"},
     {"category":"strength","test_key":"hinge_3rm"}
   ]'::jsonb),
  ('AST9 Court-Sport Screen', '[
     {"category":"readiness","test_key":"readiness_score"},
     {"category":"mobility","test_key":"ankle_df"},
     {"category":"power","test_key":"cmj_height"},
     {"category":"agility_cod","test_key":"proagility"},
     {"category":"agility_cod","test_key":"reactive_cod"},
     {"category":"landing","test_key":"drop_land_grade"},
     {"category":"single_leg_control","test_key":"sl_hop_dist"}
   ]'::jsonb)
) as b(name, test_order)
where not exists (
  select 1 from public.assessment_batteries d
  where d.is_default = true and d.name = b.name
);

-- ── Smoke (each should succeed) ─────────────────────────────────
--   SELECT count(*) FROM public.assessment_batteries WHERE is_default;
--   -- impersonated coach: own + default visible; unassigned athlete rows hidden.
