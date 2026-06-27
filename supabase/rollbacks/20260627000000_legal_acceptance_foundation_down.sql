-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK for: 20260627000000_legal_acceptance_foundation.sql
-- Phase R1C-Backend-1 — Legal Acceptance Foundation
--
-- Lives OUTSIDE supabase/migrations/ on purpose so it is never auto-applied
-- as a forward migration. Run it manually (SQL editor or MCP execute_sql) to
-- revert R1C-Backend-1.
--
-- Drops ONLY the objects this migration created:
--   • function record_legal_acceptance(jsonb, text)
--   • function has_accepted_current_legal(uuid)
--   • trigger  trg_legal_documents_touch + function tg_legal_touch()
--   • table    legal_acceptances   (cascade clears its own policies/indexes)
--   • table    legal_documents     (cascade clears its own policies/indexes)
--
-- Touches NOTHING else: public.profiles, the auth schema, role helpers
-- (is_admin / is_coach_or_admin), subscription tables, rehab tables, and
-- athletic tables are all left exactly as they are.
--
-- NOTE: dropping legal_acceptances deletes the acceptance AUDIT history. Only
-- run this as a deliberate, approved rollback.
-- ═══════════════════════════════════════════════════════════════

-- 1. Drop the RPCs first (they depend on the tables).
drop function if exists public.record_legal_acceptance(jsonb, text);
drop function if exists public.has_accepted_current_legal(uuid);

-- 2. Drop the touch trigger, then its function (function cannot drop while the
--    trigger still references it).
drop trigger if exists trg_legal_documents_touch on public.legal_documents;
drop function if exists public.tg_legal_touch();

-- 3. Drop the tables (cascade removes their policies + indexes + FKs).
drop table if exists public.legal_acceptances cascade;
drop table if exists public.legal_documents cascade;
