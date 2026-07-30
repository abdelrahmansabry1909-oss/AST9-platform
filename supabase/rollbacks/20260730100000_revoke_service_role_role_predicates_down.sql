-- =============================================================================
--  DOWN - P3A-2H-R role-predicate service_role EXECUTE revocation
--  Reverses 20260730100000_revoke_service_role_role_predicates.sql.
--
--  WARNING: running this restores unnecessary service_role EXECUTE on five
--  SECURITY DEFINER role predicates. Only run this to recover from a defect in
--  the forward ACL decision, and record why.
--
--  Safe to run repeatedly. Grants only; no function is dropped or altered.
-- =============================================================================

BEGIN;

GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_coach() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_coach_or_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_or_coach() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO service_role;

COMMIT;
