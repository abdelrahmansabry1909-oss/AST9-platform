-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK for: 20260624000000_client_program_versions.sql
-- Phase E1b-1 — Effective-date program versioning (FOUNDATION)
--
-- This file lives OUTSIDE supabase/migrations/ on purpose so it is
-- never auto-applied as a forward migration. Run it manually (SQL
-- editor or MCP execute_sql) to revert E1b-1.
--
-- Fully reversible · additive-only original · no mutation of existing
-- tables. client_programs / client_routines / workout_* are untouched
-- by the forward migration, so nothing there needs restoring.
--
-- NOTE: before dropping, the serving overlay in js/programPublish.js
-- (resolveClientProgram) must also be reverted, OR left as-is — it is
-- written to fall back to client_programs when the versions query
-- throws (table missing), so dropping this table is safe even with the
-- new JS deployed (clients transparently fall back to the pointer).
-- ═══════════════════════════════════════════════════════════════

-- Drop policies first (defensive — dropping the table drops them anyway).
drop policy if exists "cpv_select" on public.client_program_versions;
drop policy if exists "cpv_write"  on public.client_program_versions;

-- Drop the table (cascades its indexes + the trg_cpv_touch trigger).
drop table if exists public.client_program_versions cascade;

-- Drop the updated_at trigger function (no other dependents).
drop function if exists public.tg_cpv_touch();
