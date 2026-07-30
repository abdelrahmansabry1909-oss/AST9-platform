-- Owner decision, 2026-07-30: revoke service_role EXECUTE on the five
-- SECURITY DEFINER role predicates. Unlike the 2026-07-28 RPC ACL hardening,
-- which deliberately preserved service_role for RPC consumers, service_role is
-- unnecessary here: it holds BYPASSRLS, has no call site for these predicates,
-- and nested calls inside SECURITY DEFINER functions use the definer's rights.
--
-- IMPORTANT: anon and authenticated EXECUTE are intentional and must not be
-- revoked. Baseline CREATE POLICY statements without a TO clause apply to
-- PUBLIC and evaluate these predicates as anon for signed-out requests; signed-in
-- policies and get_my_role()'s user-JWT RPC call require authenticated access.
-- PUBLIC itself remains revoked.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM service_role;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_coach() FROM service_role;
REVOKE ALL ON FUNCTION public.is_coach() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_coach() TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_coach_or_admin() FROM service_role;
REVOKE ALL ON FUNCTION public.is_coach_or_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_coach_or_admin() TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_admin_or_coach() FROM service_role;
REVOKE ALL ON FUNCTION public.is_admin_or_coach() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_or_coach() TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM service_role;
REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO anon, authenticated;

COMMIT;
