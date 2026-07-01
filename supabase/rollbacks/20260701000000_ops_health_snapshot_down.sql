-- ════════════════════════════════════════════════════════════════
--  Rollback — Phase P1A Ops Health Snapshot
--  Reverses supabase/migrations/20260701000000_ops_health_snapshot.sql
--
--  Drops ONLY the object this migration created:
--    • function public.ops_health_snapshot()
--
--  Touches NOTHING else. The migration created no tables, no columns, no
--  policies, no cron jobs, and wrote no data — so there is nothing else to
--  revert. cron.*, net.*, public.is_admin(), and all app/auth/legal/business
--  objects are left exactly as they are.
-- ════════════════════════════════════════════════════════════════

drop function if exists public.ops_health_snapshot();
