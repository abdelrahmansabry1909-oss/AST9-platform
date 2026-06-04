-- ═══════════════════════════════════════════════════════════════
-- NeuCore RPM Foundation Migration — Phase 1
-- Run this in Supabase SQL Editor (new query).
-- This file is SELF-CONTAINED — it creates its own role-check helpers
-- in the `public` schema (Supabase blocks user-defined functions in `auth`).
--
-- Cites:
--   subjective_assessments    → o-sullivan-subjective-assessment.md §2.1 (13 aims)
--   rpm_graphs / rpm_phases   → o-sullivan-graded-exposure-ladder.md §1.1
--   rpm_phase_exercises       → o-sullivan-fogg-behavior-model.md (B = MAP prescriptions)
--   phase_submissions         → o-sullivan-graded-exposure-ladder.md §1.2 (Tripwires)
--   ai_feedback_log           → ML training corpus per workflow Phase 4
--   visitor_inquiries         → workflow Phase 1 §1C visitor entry flow
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 0. PREREQUISITES — role-check helper functions in `public` schema
--    (idempotent; safe to re-run)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_coach()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'coach'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_coach_or_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('coach','admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_coach()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_coach_or_admin() TO authenticated;


-- ───────────────────────────────────────────────────────────────
-- 1. visitor_inquiries — pre-signup leads (no auth required)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor_inquiries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL,
  email       text NOT NULL,
  phone       text,
  symptoms    text,
  source      text CHECK (source IN ('survey','calendly_redirect')),
  email_sent  boolean DEFAULT false,
  ip_hash     text,                              -- For light-touch rate limiting at edge
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visitor_inquiries_created_idx ON visitor_inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS visitor_inquiries_email_idx   ON visitor_inquiries(email);

ALTER TABLE visitor_inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visitor_inquiries_anon_insert" ON visitor_inquiries;
CREATE POLICY "visitor_inquiries_anon_insert" ON visitor_inquiries
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "visitor_inquiries_admin_read" ON visitor_inquiries;
CREATE POLICY "visitor_inquiries_admin_read" ON visitor_inquiries
  FOR SELECT TO authenticated USING (is_admin());


-- ───────────────────────────────────────────────────────────────
-- 2. subjective_assessments — Mode A (O'Sullivan 13-aim) OR Mode B (free-form)
--    Cite: o-sullivan-subjective-assessment.md §2.1
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subjective_assessments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              uuid REFERENCES profiles(id) ON DELETE CASCADE,
  coach_id               uuid REFERENCES auth.users(id),
  assessment_id          uuid REFERENCES assessments(id) ON DELETE SET NULL,
  mode                   text NOT NULL CHECK (mode IN ('osullivan','free_form')),
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','complete')),

  -- Aim 3: Internal motivator (the "Northern Star")
  dream_outcome          text,
  -- Aim 4: External pain → internal problem
  external_pain          text,
  life_impact            text,
  -- Aim 5: Mechanism + Aim 7: stress timeline
  mechanism_of_injury    text,
  stress_timeline        jsonb DEFAULT '[]',     -- [{ year, event, type:'physical|emotional' }]
  -- Aim 6: Aggravating / easing factors
  aggravating_factors    jsonb DEFAULT '[]',
  easing_factors         jsonb DEFAULT '[]',
  -- Aim 8: Tripwires / past failed treatments
  past_treatments        jsonb DEFAULT '[]',
  hidden_objections      text,
  -- Aim 9: Likelihood scoring
  confidence_score       int CHECK (confidence_score BETWEEN 0 AND 10),
  importance_score       int CHECK (importance_score BETWEEN 0 AND 10),
  -- Aim 10: Fast start opportunity
  fast_start_opportunity text,
  -- Aim 11: Red flags screen
  red_flag_screen        jsonb DEFAULT '{}',     -- { bladder_bowel:bool, night_pain:bool, weight_loss:bool, ... }
  -- Aim 12: Yellow flags & medical
  medications            jsonb DEFAULT '[]',
  yellow_flags           text,
  -- Aim 13: Recap notes
  recap_notes            text,

  -- Free-form mode only
  free_form_notes        text,

  -- Wizard state for resumable Mode A
  wizard_step            int DEFAULT 1 CHECK (wizard_step BETWEEN 1 AND 13),

  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subj_assess_client_idx ON subjective_assessments(client_id);
CREATE INDEX IF NOT EXISTS subj_assess_coach_idx  ON subjective_assessments(coach_id);
CREATE INDEX IF NOT EXISTS subj_assess_assess_idx ON subjective_assessments(assessment_id);

ALTER TABLE subjective_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subj_assess_access" ON subjective_assessments;
CREATE POLICY "subj_assess_access" ON subjective_assessments
  FOR ALL TO authenticated USING (
    coach_id  = auth.uid()
    OR client_id = auth.uid()
    OR is_admin()
  );


-- ───────────────────────────────────────────────────────────────
-- 3. rpm_graphs — one Reactive Graph per coach build
--    Cite: o-sullivan-graded-exposure-ladder.md §1.1
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rpm_graphs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid REFERENCES profiles(id) ON DELETE CASCADE,
  coach_id            uuid REFERENCES auth.users(id),
  subjective_id       uuid REFERENCES subjective_assessments(id),
  objective_id        uuid REFERENCES rehab_objective_assessments(id),

  point_a_summary     text,                       -- Current state
  point_b_dream       text,                       -- Destination / dream outcome
  inversion_question  text,                       -- "What needs to happen before…"
  phase_count         int DEFAULT 5 CHECK (phase_count BETWEEN 3 AND 7),
  status              text DEFAULT 'draft'
                       CHECK (status IN ('draft','published','completed','archived')),
  ai_generated        boolean DEFAULT false,
  composite_score     numeric(5,1),               -- Pulled from ScoringEngine

  published_at        timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rpm_graphs_client_idx  ON rpm_graphs(client_id);
CREATE INDEX IF NOT EXISTS rpm_graphs_coach_idx   ON rpm_graphs(coach_id);
CREATE INDEX IF NOT EXISTS rpm_graphs_status_idx  ON rpm_graphs(status);

ALTER TABLE rpm_graphs ENABLE ROW LEVEL SECURITY;

-- Coaches: full CRUD on graphs they own.
-- Clients: SELECT only, and only when published.
-- Admin:   full access.
DROP POLICY IF EXISTS "rpm_graphs_coach_full"   ON rpm_graphs;
DROP POLICY IF EXISTS "rpm_graphs_client_read"  ON rpm_graphs;
DROP POLICY IF EXISTS "rpm_graphs_admin_full"   ON rpm_graphs;

CREATE POLICY "rpm_graphs_coach_full" ON rpm_graphs
  FOR ALL TO authenticated USING (coach_id = auth.uid());
CREATE POLICY "rpm_graphs_client_read" ON rpm_graphs
  FOR SELECT TO authenticated USING (
    client_id = auth.uid() AND status = 'published'
  );
CREATE POLICY "rpm_graphs_admin_full" ON rpm_graphs
  FOR ALL TO authenticated USING (is_admin());


-- ───────────────────────────────────────────────────────────────
-- 4. rpm_phases — ladder rungs (phase_index 1 = bottom = entry, N = top = resilience)
--    Cite: o-sullivan-graded-exposure-ladder.md §1.1 (Stage 1..5) + §1.2 (Tripwires)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rpm_phases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id            uuid REFERENCES rpm_graphs(id) ON DELETE CASCADE,
  phase_index         int NOT NULL,                -- 1..N, 1 closest to Point A
  stage_name          text NOT NULL,               -- "Bed-based", "Standing", "Bridging", "High-Load", "Resilience"
  milestone_label     text,                        -- "Walk up stairs pain-free" — D.O.M.S. milestone
  emotional_win       text,                        -- "Lift husband off chair"
  tripwire_test       text,                        -- "Midfoot bridge 30s"
  tripwire_pass       boolean DEFAULT false,
  load_tolerance      text,                        -- "Submaximal" / "Gravity" / "Impact" / "External"
  cue_mode            text DEFAULT 'top_down'
                       CHECK (cue_mode IN ('top_down','bottom_up','mixed')),
  status              text DEFAULT 'locked'
                       CHECK (status IN ('locked','active','completed')),
  ai_generated        boolean DEFAULT false,
  unlocked_at         timestamptz,
  completed_at        timestamptz,
  UNIQUE (graph_id, phase_index)
);
CREATE INDEX IF NOT EXISTS rpm_phases_graph_idx ON rpm_phases(graph_id);

ALTER TABLE rpm_phases ENABLE ROW LEVEL SECURITY;

-- Inherit access via parent graph
DROP POLICY IF EXISTS "rpm_phases_via_graph" ON rpm_phases;
CREATE POLICY "rpm_phases_via_graph" ON rpm_phases
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM rpm_graphs g
      WHERE g.id = rpm_phases.graph_id
        AND (
          g.coach_id = auth.uid()
          OR (g.client_id = auth.uid() AND g.status = 'published')
          OR is_admin()
        )
    )
  );


-- ───────────────────────────────────────────────────────────────
-- 5. rpm_phase_exercises — many-to-many phase↔exercise with prescriptions
--    Cite: o-sullivan-fogg-behavior-model.md (B = MAP prescription details)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rpm_phase_exercises (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id            uuid REFERENCES rpm_phases(id) ON DELETE CASCADE,
  exercise_id         uuid REFERENCES exercises(id) ON DELETE SET NULL,
  prescription        jsonb DEFAULT '{}',     -- { sets, reps, tempo, rest, cue_type, prompt_trigger }
  display_order       int DEFAULT 0,
  ai_generated        boolean DEFAULT false,
  client_completed    boolean DEFAULT false,
  client_completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS rpm_phase_ex_phase_idx ON rpm_phase_exercises(phase_id);

ALTER TABLE rpm_phase_exercises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rpm_phase_ex_via_phase" ON rpm_phase_exercises;
CREATE POLICY "rpm_phase_ex_via_phase" ON rpm_phase_exercises
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM rpm_phases p
      JOIN rpm_graphs g ON g.id = p.graph_id
      WHERE p.id = rpm_phase_exercises.phase_id
        AND (
          g.coach_id = auth.uid()
          OR (g.client_id = auth.uid() AND g.status = 'published')
          OR is_admin()
        )
    )
  );


-- ───────────────────────────────────────────────────────────────
-- 6. phase_submissions — Client → Coach approval queue
--    Cite: workflow Phase 4 §4A (notification pipeline)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phase_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id          uuid REFERENCES rpm_graphs(id) ON DELETE CASCADE,
  phase_id          uuid REFERENCES rpm_phases(id) ON DELETE CASCADE,
  client_id         uuid REFERENCES profiles(id),
  client_note       text,
  status            text DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','modified')),
  coach_decision_at timestamptz,
  coach_note        text,
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phase_subm_graph_idx  ON phase_submissions(graph_id);
CREATE INDEX IF NOT EXISTS phase_subm_status_idx ON phase_submissions(status);

ALTER TABLE phase_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "phase_subm_access" ON phase_submissions;
CREATE POLICY "phase_subm_access" ON phase_submissions
  FOR ALL TO authenticated USING (
    client_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM rpm_graphs g
      WHERE g.id = phase_submissions.graph_id AND g.coach_id = auth.uid()
    )
    OR is_admin()
  );


-- ───────────────────────────────────────────────────────────────
-- 7. ai_feedback_log — ML training corpus
--    Cite: workflow Phase 4 §4C
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_feedback_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id        uuid REFERENCES auth.users(id),
  graph_id        uuid REFERENCES rpm_graphs(id) ON DELETE SET NULL,
  suggestion_kind text,             -- "phase_name" | "milestone" | "exercise_pick" | "tripwire" | "prescription"
  original_text   text,             -- The AI suggestion
  modified_text   text,             -- The coach's version
  reason_category text,             -- "wrong_phase_match" | "patient_not_ready" | "exercise_unsafe" | "other"
  reason_text     text,             -- Free-form explanation
  context_jsonb   jsonb DEFAULT '{}', -- Snapshot of subjective + objective + phase index
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_fb_coach_idx ON ai_feedback_log(coach_id);
CREATE INDEX IF NOT EXISTS ai_fb_kind_idx  ON ai_feedback_log(suggestion_kind);

ALTER TABLE ai_feedback_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_fb_coach_write" ON ai_feedback_log;
DROP POLICY IF EXISTS "ai_fb_admin_read"  ON ai_feedback_log;
CREATE POLICY "ai_fb_coach_write" ON ai_feedback_log
  FOR INSERT TO authenticated WITH CHECK (coach_id = auth.uid());
CREATE POLICY "ai_fb_admin_read" ON ai_feedback_log
  FOR SELECT TO authenticated USING (is_admin());


-- ───────────────────────────────────────────────────────────────
-- 8. ALTER existing programs table — soft-link to RPM graph
-- ───────────────────────────────────────────────────────────────
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS rpm_graph_id uuid REFERENCES rpm_graphs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS programs_rpm_graph_idx ON programs(rpm_graph_id);


-- ───────────────────────────────────────────────────────────────
-- 9. Auto-update timestamps for tables with updated_at
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rpm_touch_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subj_assess_touch ON subjective_assessments;
CREATE TRIGGER subj_assess_touch
  BEFORE UPDATE ON subjective_assessments
  FOR EACH ROW EXECUTE FUNCTION rpm_touch_updated_at();

DROP TRIGGER IF EXISTS rpm_graphs_touch ON rpm_graphs;
CREATE TRIGGER rpm_graphs_touch
  BEFORE UPDATE ON rpm_graphs
  FOR EACH ROW EXECUTE FUNCTION rpm_touch_updated_at();


-- ═══════════════════════════════════════════════════════════════
-- POST-MIGRATION SMOKE TESTS (run as separate query in SQL Editor)
-- ═══════════════════════════════════════════════════════════════
-- SELECT * FROM visitor_inquiries     LIMIT 1;   -- expect: 0 rows, no error
-- SELECT * FROM subjective_assessments LIMIT 1;
-- SELECT * FROM rpm_graphs            LIMIT 1;
-- SELECT * FROM rpm_phases            LIMIT 1;
-- SELECT * FROM rpm_phase_exercises   LIMIT 1;
-- SELECT * FROM phase_submissions     LIMIT 1;
-- SELECT * FROM ai_feedback_log       LIMIT 1;
--
-- RLS verification (as anon):
-- SELECT * FROM rpm_graphs;            -- expect: 0 rows (no anon read)
-- INSERT INTO visitor_inquiries (full_name, email, source)
--   VALUES ('Test', 'test@example.com', 'survey');  -- expect: success
