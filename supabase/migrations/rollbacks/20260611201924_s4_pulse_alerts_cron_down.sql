-- Rollback: S4 cron activation — stops all proactive alerting immediately.
-- (The foundation rollback drops the feed + memory tables separately.)
select cron.unschedule('pulse-alerts-daily');
