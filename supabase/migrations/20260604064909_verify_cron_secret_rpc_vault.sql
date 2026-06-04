-- ═══════════════════════════════════════════════════════════════
--  SECURITY · Edge Finalization S7 — Vault single-source for cron auth
--
--  Lets the subscription-checker edge function (service role) validate a
--  candidate x-cron-secret against the Vault secret 'cron_secret' WITHOUT
--  the secret ever leaving the database: the function passes the header
--  value, the RPC compares it in-DB and returns only a boolean.
--
--  This removes the dependency on the CRON_SECRET edge env var, making
--  Vault the single source of truth and eliminating dual-store drift.
--
--  Locked down: callable only by service_role (the edge function's key).
--  Not reachable by anon/authenticated, so it cannot be used as a
--  brute-force oracle by clients.
--
--  Verified live: verify_cron_secret('wrong') = false;
--  verify_cron_secret(<vault value>) = true; and the deployed function
--  returns 200 for the Vault-sourced cron call, 401 for missing/invalid.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.verify_cron_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'cron_secret'
      AND decrypted_secret = p_secret
  );
$$;

REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;
