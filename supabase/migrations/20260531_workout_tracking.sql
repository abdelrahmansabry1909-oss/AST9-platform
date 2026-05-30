-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Workout Session Tracking
-- Run in Supabase SQL Editor (idempotent).
--
-- Captures the client's execution of a published workout:
--   workout_sessions       — 1 row per "Start Workout" press
--   workout_exercise_logs  — 1 row per exercise inside that session
--                             (sets/reps/weight + a compact note)
--
-- Feeds: coach Workout History view (this feature) and the future
-- progression engine (composite score) once it lands.
--
-- Depends on:
--   public.is_admin()                         — 20260515_rpm_foundation.sql
--   profiles.assigned_coach                   — base schema
--   client_programs                           — 20260522_client_program_publish.sql
--   exercises                                 — AST9_Phase3_Migrations.sql
-- ═══════════════════════════════════════════════════════════════

-- ── 1. workout_sessions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workout_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  coach_id          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  program_id        uuid REFERENCES client_programs(id) ON DELETE SET NULL,

  -- Which workout inside the published program (workouts[].id key, e.g. 'A')
  workout_key       text NOT NULL,
  workout_label     text,

  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  duration_seconds  int,                                -- set at finish

  intensity_rating  int CHECK (intensity_rating BETWEEN 1 AND 10),
  session_notes     text,

  status            text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','completed','abandoned')),

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workout_sessions_client_idx
  ON workout_sessions(client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS workout_sessions_coach_idx
  ON workout_sessions(coach_id, started_at DESC);
CREATE INDEX IF NOT EXISTS workout_sessions_status_idx
  ON workout_sessions(client_id, status);

-- At most one ACTIVE session per client — gives the client a clean
-- "resume in-progress workout" affordance instead of orphan rows.
CREATE UNIQUE INDEX IF NOT EXISTS workout_sessions_one_active_uidx
  ON workout_sessions(client_id)
  WHERE status = 'active';

COMMENT ON TABLE workout_sessions IS
  'One row per "Start Workout" press. Closes at "Finish Workout" with '
  'duration + intensity rating + optional notes.';

-- ── 2. workout_exercise_logs ───────────────────────────────────
CREATE TABLE IF NOT EXISTS workout_exercise_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,

  -- Position inside the workout (so order is stable even if names change)
  exercise_index  int NOT NULL,
  exercise_name   text NOT NULL,
  -- Optional link to the Exercise Library (for video previews + analytics)
  exercise_id     uuid REFERENCES exercises(id) ON DELETE SET NULL,

  -- Per-set log: [{ n:1, reps:8, weight:50 }, { n:2, reps:8, weight:50, rpe:7 }, …]
  sets            jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes           text,
  completed       boolean NOT NULL DEFAULT false,
  completed_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (session_id, exercise_index)
);

CREATE INDEX IF NOT EXISTS workout_exercise_logs_session_idx
  ON workout_exercise_logs(session_id);
CREATE INDEX IF NOT EXISTS workout_exercise_logs_ex_idx
  ON workout_exercise_logs(exercise_id) WHERE exercise_id IS NOT NULL;

COMMENT ON COLUMN workout_exercise_logs.sets IS
  'Array of { n, reps, weight, rpe? } objects — one per logged set. '
  'Free-form jsonb keeps it forward-compatible with future fields.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_workout_log_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS workout_exercise_logs_touch ON workout_exercise_logs;
CREATE TRIGGER workout_exercise_logs_touch
  BEFORE UPDATE ON workout_exercise_logs
  FOR EACH ROW EXECUTE FUNCTION public.touch_workout_log_updated_at();

-- ── 3. Row Level Security ──────────────────────────────────────
ALTER TABLE workout_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_exercise_logs ENABLE ROW LEVEL SECURITY;

-- Client owns their own session rows (full CRUD on themselves).
DROP POLICY IF EXISTS "workout_sessions_client_own" ON workout_sessions;
CREATE POLICY "workout_sessions_client_own" ON workout_sessions
  FOR ALL TO authenticated
  USING      (client_id = auth.uid())
  WITH CHECK (client_id = auth.uid());

-- Coach (or admin) can SELECT and INSERT/UPDATE on their assigned
-- clients — INSERT exists so coaches can log an in-clinic session.
DROP POLICY IF EXISTS "workout_sessions_coach_read"   ON workout_sessions;
DROP POLICY IF EXISTS "workout_sessions_coach_write"  ON workout_sessions;
DROP POLICY IF EXISTS "workout_sessions_coach_update" ON workout_sessions;

CREATE POLICY "workout_sessions_coach_read" ON workout_sessions
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR coach_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = workout_sessions.client_id
        AND p.assigned_coach = auth.uid()
    )
  );

CREATE POLICY "workout_sessions_coach_write" ON workout_sessions
  FOR INSERT TO authenticated WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = workout_sessions.client_id
        AND p.assigned_coach = auth.uid()
    )
  );

CREATE POLICY "workout_sessions_coach_update" ON workout_sessions
  FOR UPDATE TO authenticated USING (
    public.is_admin()
    OR coach_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = workout_sessions.client_id
        AND p.assigned_coach = auth.uid()
    )
  );

-- Logs inherit access via their parent session.
DROP POLICY IF EXISTS "workout_logs_access" ON workout_exercise_logs;
CREATE POLICY "workout_logs_access" ON workout_exercise_logs
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_sessions s
      WHERE s.id = workout_exercise_logs.session_id
        AND (
          s.client_id = auth.uid()
          OR s.coach_id  = auth.uid()
          OR public.is_admin()
          OR EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = s.client_id AND p.assigned_coach = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workout_sessions s
      WHERE s.id = workout_exercise_logs.session_id
        AND (
          s.client_id = auth.uid()
          OR public.is_admin()
          OR EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = s.client_id AND p.assigned_coach = auth.uid()
          )
        )
    )
  );

-- ── 4. Smoke tests (each should succeed, return 0 rows) ────────
--   SELECT * FROM workout_sessions LIMIT 1;
--   SELECT * FROM workout_exercise_logs LIMIT 1;
