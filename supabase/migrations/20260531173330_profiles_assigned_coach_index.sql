-- ═══════════════════════════════════════════════════════════════
--  Partial index supporting the assigned_coach EXISTS subquery
--  used by every per-coach RLS policy in this database.
--
--  Stabilization Pass follow-up (companion to
--  20260531162107_sessions_rls_tighten.sql).
--
--  The EXISTS pattern
--      EXISTS (SELECT 1 FROM profiles p
--              WHERE p.id = <table>.client_id
--                AND p.assigned_coach = auth.uid())
--  is reused by sessions, client_programs, client_routines,
--  daily_routine_logs, workout_sessions, notifications, and
--  exercise_alternative_requests policies. Without this index,
--  Postgres seq-scans profiles per candidate row when the first
--  three OR-arms (admin, owning coach, own client) miss.
--
--  Partial index is correct because most profiles rows are coaches
--  themselves and have assigned_coach IS NULL — excluding them
--  keeps the index small.
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS profiles_assigned_coach_idx
  ON profiles (assigned_coach)
  WHERE assigned_coach IS NOT NULL;
