-- ═══════════════════════════════════════════════════════════════
-- NeuCore RPM — Phase 5 Migration (Integration & Polish)
-- Run in Supabase SQL Editor AFTER 20260515_rpm_foundation.sql.
-- Self-contained; re-uses the public.is_admin() helper from Phase 1.
--
-- Adds:
--   1. rpm_phases.target_regions   — body regions each phase addresses (5B)
--   2. rpm_phase_messages          — per-phase progressive chat (5D)
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1. BodyMap integration — which body regions a phase targets (5B)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE rpm_phases
  ADD COLUMN IF NOT EXISTS target_regions text[] DEFAULT '{}';

COMMENT ON COLUMN rpm_phases.target_regions IS
  'Body regions this phase addresses — drives phase-aware coloring on the body map. '
  'Values from a fixed vocabulary: CervicalSpine, ThoracicSpine, LumbarSpine, Pelvis, '
  'Left/Right Shoulder|Elbow|Wrist|Hip|Knee|Ankle|Foot.';

-- ───────────────────────────────────────────────────────────────
-- 2. Progressive Chat — per-phase coach <-> client messages (5D)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rpm_phase_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id    uuid NOT NULL REFERENCES rpm_graphs(id) ON DELETE CASCADE,
  phase_id    uuid REFERENCES rpm_phases(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES auth.users(id),
  author_role text CHECK (author_role IN ('coach','client','admin')),
  body        text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rpm_phase_messages_graph_idx ON rpm_phase_messages(graph_id);
CREATE INDEX IF NOT EXISTS rpm_phase_messages_phase_idx ON rpm_phase_messages(phase_id);
CREATE INDEX IF NOT EXISTS rpm_phase_messages_created_idx ON rpm_phase_messages(created_at);

ALTER TABLE rpm_phase_messages ENABLE ROW LEVEL SECURITY;

-- Participants of the parent graph (its coach OR its client) — plus admins —
-- can read and write messages. RLS USING also acts as WITH CHECK for INSERT.
DROP POLICY IF EXISTS "rpm_phase_messages_participants" ON rpm_phase_messages;
CREATE POLICY "rpm_phase_messages_participants" ON rpm_phase_messages
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM rpm_graphs g
      WHERE g.id = rpm_phase_messages.graph_id
        AND (g.coach_id = auth.uid() OR g.client_id = auth.uid())
    )
    OR is_admin()
  );

-- ───────────────────────────────────────────────────────────────
-- Smoke test (each should return 0 rows, no error):
--   SELECT target_regions FROM rpm_phases LIMIT 1;
--   SELECT * FROM rpm_phase_messages LIMIT 1;
-- ───────────────────────────────────────────────────────────────
