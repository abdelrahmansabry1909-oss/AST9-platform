-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Per-client published Program + Daily Routine
-- Run in the Supabase SQL Editor (new query). Idempotent.
--
-- The coach configures → generates → edits → PUBLISHES a program and a
-- daily routine for a specific client. These two tables hold the
-- published copy the client reads.
--
-- Depends on public.is_admin() — created in 20260515_rpm_foundation.sql.
-- ═══════════════════════════════════════════════════════════════

-- ── Published training program (one current row per client) ──────
CREATE TABLE IF NOT EXISTS client_programs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  coach_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  program      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- phase, structure{warmup,main,cooldown}, defaults, days_per_week …
  published    boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);
CREATE INDEX IF NOT EXISTS client_programs_client_idx ON client_programs(client_id);

ALTER TABLE client_programs ENABLE ROW LEVEL SECURITY;

-- Client can read their own published program.
DROP POLICY IF EXISTS "client_programs_client_read" ON client_programs;
CREATE POLICY "client_programs_client_read" ON client_programs
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() AND published = true);

-- Coach/admin full control over their clients' programs.
DROP POLICY IF EXISTS "client_programs_coach_all" ON client_programs;
CREATE POLICY "client_programs_coach_all" ON client_programs
  FOR ALL TO authenticated
  USING (
    is_admin()
    OR coach_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = client_programs.client_id AND p.assigned_coach = auth.uid())
  )
  WITH CHECK (
    is_admin()
    OR coach_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = client_programs.client_id AND p.assigned_coach = auth.uid())
  );

-- ── Published daily routine (one current row per client) ─────────
-- tasks jsonb = array of { id, label, section('morning'|'evening'),
--   emoji, meta, details[] } — the shape the client tracker renders.
CREATE TABLE IF NOT EXISTS client_routines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  coach_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  tasks        jsonb NOT NULL DEFAULT '[]'::jsonb,
  published    boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);
CREATE INDEX IF NOT EXISTS client_routines_client_idx ON client_routines(client_id);

ALTER TABLE client_routines ENABLE ROW LEVEL SECURITY;

-- Client can read their own published routine.
DROP POLICY IF EXISTS "client_routines_client_read" ON client_routines;
CREATE POLICY "client_routines_client_read" ON client_routines
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() AND published = true);

-- Coach/admin full control over their clients' routines.
DROP POLICY IF EXISTS "client_routines_coach_all" ON client_routines;
CREATE POLICY "client_routines_coach_all" ON client_routines
  FOR ALL TO authenticated
  USING (
    is_admin()
    OR coach_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = client_routines.client_id AND p.assigned_coach = auth.uid())
  )
  WITH CHECK (
    is_admin()
    OR coach_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = client_routines.client_id AND p.assigned_coach = auth.uid())
  );
