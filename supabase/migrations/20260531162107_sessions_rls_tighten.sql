-- ═══════════════════════════════════════════════════════════════
-- NeuCore — System Stabilization Pass: tighten sessions RLS
-- ═══════════════════════════════════════════════════════════════
-- Bug fix flagged during the Reliability + Defect Sweep §9 and
-- elevated to a scope item in the Stabilization Pass.
--
-- Pre-existing policies were too permissive in two ways:
--
--   1. SELECT  "Coaches read all sessions"
--      qual = is_admin_or_coach() OR client_id = auth.uid()
--      → every coach could read every other coach's sessions.
--
--   2. INSERT  "Coaches insert sessions"
--      with_check = is_admin_or_coach()
--      → any coach could insert a row attributing it to a
--        different coach (coach_id was unchecked).
--
-- Replacement policies scope by row ownership:
--   SELECT  admin · owning coach · assigned coach · own client
--   INSERT  admin · coach attributing to themselves
--   UPDATE  admin · owning coach (defensive — was previously absent,
--           which means UPDATE was denied entirely; this preserves
--           that strictness for non-owning coaches but allows the
--           legitimate owning coach to update notes/output later)
--   DELETE  admin only (defensive — historical sessions should not be
--           freely deleted by coaches)
--
-- All existing rows continue to behave correctly because the schema
-- already populates both coach_id (writer) and client_id (subject)
-- on every insert path in js/dashboard.js _saveToSupabase().
--
-- Idempotent — DROP IF EXISTS before each CREATE so re-apply is safe.
-- ═══════════════════════════════════════════════════════════════

-- Just in case it isn't already.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- ── SELECT — per-coach scope ─────────────────────────────────────
DROP POLICY IF EXISTS "Coaches read all sessions"     ON sessions;
DROP POLICY IF EXISTS "sessions_select_scoped"        ON sessions;
CREATE POLICY "sessions_select_scoped" ON sessions
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR coach_id  = auth.uid()
    OR client_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = sessions.client_id
        AND p.assigned_coach = auth.uid()
    )
  );

-- ── INSERT — coach must attribute to themselves ──────────────────
DROP POLICY IF EXISTS "Coaches insert sessions" ON sessions;
DROP POLICY IF EXISTS "sessions_insert_scoped"  ON sessions;
CREATE POLICY "sessions_insert_scoped" ON sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (coach_id = auth.uid() AND public.is_coach_or_admin())
  );

-- ── UPDATE — admin + owning coach only ───────────────────────────
DROP POLICY IF EXISTS "sessions_update_owner" ON sessions;
CREATE POLICY "sessions_update_owner" ON sessions
  FOR UPDATE TO authenticated
  USING      (public.is_admin() OR coach_id = auth.uid())
  WITH CHECK (public.is_admin() OR coach_id = auth.uid());

-- ── DELETE — admin only ──────────────────────────────────────────
DROP POLICY IF EXISTS "sessions_delete_admin" ON sessions;
CREATE POLICY "sessions_delete_admin" ON sessions
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ── Supporting index for the assigned_coach EXISTS subquery ──────
-- The new SELECT policy (and the same pattern used in client_programs,
-- client_routines, daily_routine_logs, workout_sessions, notifications,
-- and the F6 alt-exercise requests) does
--   EXISTS (SELECT 1 FROM profiles p
--           WHERE p.id = <table>.client_id AND p.assigned_coach = auth.uid())
-- profiles.id is the PK so the first half is fine, but
-- profiles.assigned_coach had no index — Postgres would seq-scan
-- profiles per candidate row. Add a partial index covering the
-- "assigned coach" case so every RLS policy reusing this pattern
-- becomes O(log n) instead of O(n) per row.
CREATE INDEX IF NOT EXISTS profiles_assigned_coach_idx
  ON profiles (assigned_coach)
  WHERE assigned_coach IS NOT NULL;

-- ── Smoke (run after apply) ──────────────────────────────────────
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE schemaname='public' AND tablename='sessions' ORDER BY cmd;
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND indexname='profiles_assigned_coach_idx';
