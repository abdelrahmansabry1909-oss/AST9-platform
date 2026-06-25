-- ════════════════════════════════════════════════════════════════
--  Phase F3B — Athletic Movement Observations
--
--  Adds the movement-intelligence layer for the Athletic Performance lane:
--  coach-observed dynamic movement findings (dynamic ROM, control, symmetry,
--  finding tags, pain / confidence) captured during a movement screen.
--
--  ONE new table — athletic_movement_observations — a multi-attribute child of
--  athlete_assessments (the session anchor), optionally linked to a discrete
--  athlete_test_results row. ADDITIVE and INDEPENDENT: touches NO existing
--  table (athlete_assessments / athlete_test_results / athlete_profiles /
--  profiles are referenced by FK only; rehab assessments, client_programs,
--  client_program_versions, workout_sessions / workout_exercise_logs are NOT
--  touched).
--
--  Security model (RLS, server-side — NEVER the frontend service switcher),
--  identical to the proven F2 pattern:
--   • Admin/owner            → manage all.
--   • Assigned/owning coach   → manage only their assigned athletes' records.
--   • Unassigned coach        → blocked.
--   • Client (athlete)        → NO access in F3 (no read, no write).
--
--  Scoring is deferred: raw values + coach qualitative rating + finding tags +
--  pain flag + confidence + self-referential asymmetry + coach notes ONLY.
--  NO 0-100 score, NO norm band, NO percentile, NO risk %, NO ML output, and
--  NO external / normative content of any kind.
--
--  Additive · idempotent · reversible.
--  Rollback: supabase/rollbacks/20260625020000_athletic_movement_observations_down.sql
--
--  Depends on (all pre-existing and live):
--   • public.is_admin()                   (role helper, SECURITY DEFINER)
--   • public.tg_athletic_touch()          (F2 shared updated_at touch — REUSED)
--   • public.athlete_assessments(id)      (F2 — session anchor)
--   • public.athlete_test_results(id)     (F2 — optional discrete-test link)
--   • public.profiles(id, assigned_coach) (FK + RLS scoping)
-- ════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- athletic_movement_observations — one row per coach-observed movement
-- finding, keyed to an assessment session, domain, phase, region and side.
-- client_id / coach_id denormalized for fast joinless RLS (F2 pattern).
-- ════════════════════════════════════════════════════════════════
create table if not exists public.athletic_movement_observations (
  id                      uuid primary key default gen_random_uuid(),

  assessment_id           uuid not null references public.athlete_assessments(id) on delete cascade,
  client_id               uuid not null references public.profiles(id) on delete cascade,
  coach_id                uuid          references public.profiles(id) on delete set null,

  movement_domain         text not null check (
    movement_domain in (
      'accel','maxv','jump_takeoff','landing','decel',
      'cod','sl_control','lateral','rotation','dyn_mobility'
    )
  ),

  movement_phase          text,                       -- free text in F3B (no vocab CHECK yet)
  region                  text not null,              -- e.g. ankle | knee | hip | pelvis | trunk | …
  joint                   text,
  chain                   text,

  plane                   text check (
    plane is null or plane in ('sagittal','frontal','transverse','multi','na')
  ),

  side                    text not null default 'na' check (
    side in ('left','right','bilateral','na')
  ),

  observed_range_value    numeric,                    -- dynamic range during the movement
  range_unit              text,                       -- deg | cm | ratio
  passive_reference_value numeric,                    -- enables future usable_range (derived, never stored)

  quality_rating          text check (
    quality_rating is null or quality_rating in (
      'solid','adequate','limited','poor','not_assessed'
    )
  ),

  control_note            text,
  symmetry_note           text,
  asymmetry_pct           numeric,                    -- self-referential L↔R only (never vs external norm)

  finding_tags            text[] not null default '{}'::text[],

  pain_flag               boolean not null default false,

  confidence              text check (
    confidence is null or confidence in ('high','medium','low')
  ),

  source                  text not null default 'coach_visual' check (
    source in ('coach_visual','video','wearable','other')
  ),

  linked_test_result_id   uuid references public.athlete_test_results(id) on delete set null,

  coach_note              text,
  assessed_at             timestamptz,

  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- DB-level controlled vocabulary for finding_tags (defense in depth alongside
  -- the app-level picker). `<@` = "is contained by": every element of finding_tags
  -- must appear in the allowed set. The default empty array trivially satisfies it.
  constraint athletic_movement_observations_finding_tags_valid check (
    finding_tags <@ array[
      'limited_range','range_loss_under_load','poor_control','asymmetry',
      'delayed_braking','early_collapse','insufficient_stiffness','excessive_stiffness',
      'poor_trunk_control','poor_pelvic_control','low_force_projection','low_force_absorption',
      'energy_leak','timing_fault','pain_limited','fatigue_limited'
    ]::text[]
  )
);

-- ── Indexes (table-prefixed — avoids the F2C schema-unique name collision) ──
create index if not exists idx_athletic_movement_observations_assessment
  on public.athletic_movement_observations(assessment_id);
create index if not exists idx_athletic_movement_observations_client_domain
  on public.athletic_movement_observations(client_id, movement_domain, assessed_at desc);
create index if not exists idx_athletic_movement_observations_coach
  on public.athletic_movement_observations(coach_id);
create index if not exists idx_athletic_movement_observations_domain
  on public.athletic_movement_observations(movement_domain);
create index if not exists idx_athletic_movement_observations_linked_test
  on public.athletic_movement_observations(linked_test_result_id);
create index if not exists idx_athletic_movement_observations_tags
  on public.athletic_movement_observations using gin(finding_tags);

-- ── RLS — identical proven F2 pattern; client has zero access in F3 ──
alter table public.athletic_movement_observations enable row level security;
drop policy if exists "movement_observations_all" on public.athletic_movement_observations;
create policy "movement_observations_all" on public.athletic_movement_observations
  for all to authenticated
  using (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athletic_movement_observations.client_id and p.assigned_coach = (select auth.uid()))
  )
  with check (
    public.is_admin()
    or coach_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = athletic_movement_observations.client_id and p.assigned_coach = (select auth.uid()))
  );

-- ── updated_at touch — REUSE the live F2 function (no duplicate created) ──
drop trigger if exists trg_movement_observations_touch on public.athletic_movement_observations;
create trigger trg_movement_observations_touch before update on public.athletic_movement_observations
  for each row execute function public.tg_athletic_touch();

-- ── Smoke (each should succeed) ─────────────────────────────────
--   SELECT count(*) FROM public.athletic_movement_observations;            -- 0
--   -- impersonated client:        SELECT count(*) -> 0 ; INSERT -> 42501
--   -- impersonated assigned coach: INSERT own athlete observation -> ok
--   -- impersonated unassigned coach: that athlete's rows hidden; INSERT -> 42501
