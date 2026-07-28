-- Reassert security-critical RPC execution boundaries after isolated staging
-- provisioning exposed role grants inherited from default privileges.
--
-- This forward migration is authoritative for these ACLs. It intentionally
-- preserves service_role access that may have been inherited implicitly when
-- the original function migrations ran.

BEGIN;

REVOKE ALL ON FUNCTION public.create_client_subscription(
  uuid, text, integer, date, date, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_client_subscription(
  uuid, text, integer, date, date, text, text
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_client_subscription(
  uuid, text, integer, date, date, text, text, integer
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_client_subscription(
  uuid, text, integer, date, date, text, text, integer
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.apply_paid_coach_package_period_system(
  text, text, uuid, text, integer, timestamptz, timestamptz,
  integer, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_paid_coach_package_period_system(
  text, text, uuid, text, integer, timestamptz, timestamptz,
  integer, text, text, text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.expire_stale_workout_sessions_all()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.expire_stale_workout_sessions_all()
  TO service_role;

COMMIT;
