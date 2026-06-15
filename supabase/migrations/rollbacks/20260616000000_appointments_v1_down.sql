-- ════════════════════════════════════════════════════════════════
--  Rollback for 20260616000000_appointments_v1.sql
--  Removes the appointments table, its notify trigger/function, and
--  the profiles.calendly_url column. Nothing else is touched.
-- ════════════════════════════════════════════════════════════════

drop trigger  if exists trg_appt_notify on public.appointments;
drop function if exists public.tg_appt_notify_client();
drop table    if exists public.appointments;

alter table public.profiles drop constraint if exists profiles_calendly_url_chk;
alter table public.profiles drop column if exists calendly_url;
