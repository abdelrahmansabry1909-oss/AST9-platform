-- Reassert subscription RPC execution boundaries after isolated staging
-- provisioning exposed anon EXECUTE inherited from default privileges.

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
