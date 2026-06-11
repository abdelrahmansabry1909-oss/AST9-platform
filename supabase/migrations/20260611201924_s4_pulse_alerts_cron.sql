-- S4 gate 4 — schedule the daily pulse-alerts run (05:00 UTC, after the
-- 00:00 subscription checker). Identical invocation pattern to
-- subscription-checker-daily: secret read from Vault at fire time, never
-- plaintext in cron.job. Rollback:
--   rollbacks/20260611201924_s4_pulse_alerts_cron_down.sql
select cron.schedule(
  'pulse-alerts-daily',
  '0 5 * * *',
  $$
    select net.http_post(
      url     := 'https://byquokhcbagofshsclfy.functions.supabase.co/pulse-alerts',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body    := '{"name":"cron"}'::jsonb
    );
  $$
);
