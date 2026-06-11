-- Rollback: S4 pulse-alerts foundation.
-- Removes the alert memory tables and the service-role pulse feed.
-- Pair with: unschedule the cron job and delete the edge function —
--   select cron.unschedule('pulse-alerts-daily');
-- No other surface reads these objects (additive automation layer only).

drop function if exists public.fn_pulse_for_alerts();
drop table if exists public.pulse_alert_log;
drop table if exists public.pulse_alert_state;
