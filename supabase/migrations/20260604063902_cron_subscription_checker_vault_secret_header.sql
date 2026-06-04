-- ═══════════════════════════════════════════════════════════════
--  SECURITY · Edge Finalization S7 — secure the daily cron trigger
--
--  The pg_cron job "subscription-checker-daily" (jobid 1) previously
--  POSTed to the function with only a Content-Type header. Combined with
--  the function's verify_jwt=true, every nightly call was rejected 401
--  (net._http_response evidence) — the expiry/email job was dead.
--
--  The function is now verify_jwt=false + gated by requireCron(), which
--  checks the `x-cron-secret` header against the CRON_SECRET edge secret.
--  This rewrites the cron command to send that header, reading the value
--  from Supabase Vault (vault.decrypted_secrets, name='cron_secret') —
--  NEVER stored as plaintext in cron.job.
--
--  NOTE: the CRON_SECRET edge-function secret and the Vault 'cron_secret'
--  value MUST be byte-identical for the gate to pass (HTTP 200).
--
--  Idempotent: cron.alter_job overwrites the command for jobid 1.
-- ═══════════════════════════════════════════════════════════════

SELECT cron.alter_job(
  job_id  := 1,
  command := $cmd$
    select net.http_post(
      url     := 'https://byquokhcbagofshsclfy.functions.supabase.co/subscription-checker',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body    := '{"name":"cron"}'::jsonb
    );
  $cmd$
);
