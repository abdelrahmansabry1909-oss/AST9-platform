-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK for: 20260609120000_feature8_v_client_pulse.sql
-- Feature 8 · S1 — Recovery Pulse read-only view
--
-- This file lives OUTSIDE supabase/migrations/ on purpose so it is
-- never auto-applied as a forward migration. Run it manually (SQL
-- editor or MCP execute_sql) to revert S1.
--
-- Fully reversible · additive-only original · no data mutation.
-- v_client_pulse has no dependents until S2 (client UI), so dropping
-- it is inert while S1 stands alone.
-- ═══════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.v_client_pulse;

-- No indexes were created by S1 (existing indexes already cover every
-- access path: daily_routine_logs(client_id, log_date DESC),
-- workout_sessions(client_id, started_at DESC) + (client_id, status),
-- progress_snapshots(client_id) + (session_date)). If a covering index
-- is added later by S1 it must be dropped here, e.g.:
--   DROP INDEX IF EXISTS public.idx_progress_snapshots_client_date;
