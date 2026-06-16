-- Rollback for 20260616010000_admin_coach_business_overview.sql
-- Phase 9 added one admin-only function and nothing else (no tables, no
-- columns, no RLS, no data). Dropping it fully reverses the migration.

drop function if exists public.admin_coach_business_overview();
