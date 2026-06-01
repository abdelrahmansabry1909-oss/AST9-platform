-- ═══════════════════════════════════════════════════════════════
--  SECURITY STABILIZATION · Fix 1 hardening (C2 follow-up)
--
--  enforce_profile_protected_columns() is a TRIGGER function and must
--  never be invoked as a PostgREST RPC. By default new functions are
--  granted EXECUTE to PUBLIC, which exposed /rest/v1/rpc/
--  enforce_profile_protected_columns to anon + authenticated (flagged
--  by the linter). Revoking EXECUTE from the API roles does NOT affect
--  trigger invocation — the trigger system runs the function as the
--  table owner regardless. Matches the existing repo convention from
--  20260506065726_revoke_public_execute_on_internal_functions.sql.
--
--  Verified live (rolled back): with EXECUTE revoked, an impersonated
--  client's role->admin UPDATE is still BLOCKED — the trigger fires.
-- ═══════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.enforce_profile_protected_columns()
  FROM PUBLIC, anon, authenticated;
