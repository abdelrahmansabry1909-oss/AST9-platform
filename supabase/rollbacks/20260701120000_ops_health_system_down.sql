-- ════════════════════════════════════════════════════════════════
--  Rollback — Phase P1B-SQL Service-role Ops Health system path
--  Reverses supabase/migrations/20260701120000_ops_health_system.sql
--
--  Drops ONLY the two functions this migration created:
--    • public.ops_health_snapshot_system()
--    • public.verify_ops_health_secret(text)
--
--  Touches NOTHING else:
--    • public.ops_health_snapshot() (the live admin function) — left intact.
--    • cron jobs, the net schema, and Vault data/secrets — untouched
--      (this migration created no cron job and no Vault secret).
--    • No app data, and no legal/auth/subscription/program/workout/athletic
--      objects are affected.
-- ════════════════════════════════════════════════════════════════

drop function if exists public.ops_health_snapshot_system();
drop function if exists public.verify_ops_health_secret(text);
