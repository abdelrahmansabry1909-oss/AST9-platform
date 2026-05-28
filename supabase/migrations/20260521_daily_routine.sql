-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Daily Routine adherence tracking
-- Run this in the Supabase SQL Editor (new query). Idempotent.
--
-- One row per client per calendar day. The client's Daily Routine
-- tracker upserts this row as tasks are checked off; the coach reads
-- it to see day-by-day adherence.
--
-- Depends on public.is_admin() — created in 20260515_rpm_foundation.sql.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS daily_routine_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  log_date         date NOT NULL DEFAULT current_date,
  completed_tasks  jsonb NOT NULL DEFAULT '[]'::jsonb,  -- array of completed task ids
  total_tasks      int  NOT NULL DEFAULT 0,
  completed_count  int  NOT NULL DEFAULT 0,
  percent          int  NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, log_date)
);

CREATE INDEX IF NOT EXISTS daily_routine_logs_client_idx
  ON daily_routine_logs(client_id, log_date DESC);

ALTER TABLE daily_routine_logs ENABLE ROW LEVEL SECURITY;

-- A client fully manages their own daily-routine logs.
DROP POLICY IF EXISTS "dr_logs_client_own" ON daily_routine_logs;
CREATE POLICY "dr_logs_client_own" ON daily_routine_logs
  FOR ALL TO authenticated
  USING      (client_id = auth.uid())
  WITH CHECK (client_id = auth.uid());

-- A coach (or admin) can READ the logs of clients assigned to them.
DROP POLICY IF EXISTS "dr_logs_coach_read" ON daily_routine_logs;
CREATE POLICY "dr_logs_coach_read" ON daily_routine_logs
  FOR SELECT TO authenticated
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = daily_routine_logs.client_id
        AND p.assigned_coach = auth.uid()
    )
  );

-- Coaches/admins may also seed or correct a log for their own clients
-- (e.g. logging an in-clinic session on the client's behalf).
DROP POLICY IF EXISTS "dr_logs_coach_write" ON daily_routine_logs;
CREATE POLICY "dr_logs_coach_write" ON daily_routine_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = daily_routine_logs.client_id
        AND p.assigned_coach = auth.uid()
    )
  );

DROP POLICY IF EXISTS "dr_logs_coach_update" ON daily_routine_logs;
CREATE POLICY "dr_logs_coach_update" ON daily_routine_logs
  FOR UPDATE TO authenticated
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = daily_routine_logs.client_id
        AND p.assigned_coach = auth.uid()
    )
  );
