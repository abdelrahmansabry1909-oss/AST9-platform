-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK for 20260516000000_rpm_phase5.sql (drift repair, applied 2026-06-10)
-- Context: the phase5 migration was REGISTERED in supabase_migrations but its
-- DDL was never applied to the live DB (found during A3 Graph-Generate fix).
-- The contents were applied 2026-06-10. This file reverses exactly that.
-- Reversal is destructive for any rpm_phase_messages rows created after the
-- repair — acceptable only immediately after application.
-- ═══════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS rpm_phase_messages;        -- drops its policy + indexes with it
ALTER TABLE rpm_phases DROP COLUMN IF EXISTS target_regions;
