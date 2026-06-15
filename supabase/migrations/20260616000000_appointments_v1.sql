-- ════════════════════════════════════════════════════════════════
--  Phase 7 — Appointments V1 (internal scheduling)
--
--  Adds, additively and reversibly:
--   • appointments         — one row per coach↔client session. Manual
--       meeting links only (no Calendly/Google/Meet API, no auto-gen).
--   • profiles.calendly_url — a coach may store their own Calendly link
--       (coach/admin facing; clients do not read coach profile rows).
--
--  Authorization (RLS, enforced server-side — never frontend-only):
--   • Admin            → read/manage ALL appointments.
--   • Coach            → read/manage only WHERE coach_id = auth.uid().
--   • Client           → read only their OWN; cannot create or edit.
--   • Every write      → the (coach_id, client_id) pair must be a real
--       assignment (profiles.assigned_coach = coach_id). A client has one
--       coach, so an appointment is always between a client and that coach;
--       this also guarantees the notify() actor→recipient check passes.
--
--  Meeting links are constrained to http(s) at the DB level as a backstop
--  to the client-side sanitizer (defence in depth — no javascript:/data:).
--
--  Client notification reuses the existing public.notify() RPC via an
--  AFTER trigger (same pattern as alt-exercise / phase / case triggers) —
--  no new notification system. Calm copy; fires on schedule, reschedule
--  (time/link change), and cancellation.
--
--  Reversible — see rollbacks/20260616000000_appointments_v1_down.sql
-- ════════════════════════════════════════════════════════════════

-- ── 1. Coach Calendly link (own profile; not a protected column) ──
alter table public.profiles
  add column if not exists calendly_url text;
alter table public.profiles drop constraint if exists profiles_calendly_url_chk;
alter table public.profiles
  add constraint profiles_calendly_url_chk
  check (calendly_url is null or calendly_url ~* '^https?://');

-- ── 2. appointments table ────────────────────────────────────────
create table if not exists public.appointments (
  id                  uuid primary key default gen_random_uuid(),
  coach_id            uuid not null references public.profiles(id) on delete cascade,
  client_id           uuid not null references public.profiles(id) on delete cascade,
  title               text,
  type                text not null default 'check_in'
                        check (type in ('assessment','check_in','follow_up','program_review','other')),
  starts_at           timestamptz not null,
  ends_at             timestamptz,
  meeting_url         text check (meeting_url is null or meeting_url ~* '^https?://'),
  status              text not null default 'scheduled'
                        check (status in ('scheduled','completed','cancelled')),
  notes               text,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  cancelled_at        timestamptz,
  cancellation_reason text
);

create index if not exists idx_appt_coach  on public.appointments(coach_id, starts_at desc);
create index if not exists idx_appt_client on public.appointments(client_id, starts_at desc);
create index if not exists idx_appt_status on public.appointments(status, starts_at desc);

alter table public.appointments enable row level security;

-- Read: admin / owning coach / the client themselves.
drop policy if exists "appt_select" on public.appointments;
create policy "appt_select" on public.appointments
  for select to authenticated
  using (
    public.is_admin()
    or coach_id  = (select auth.uid())
    or client_id = (select auth.uid())
  );

-- Insert: admin, or the coach acting for one of their OWN assigned clients.
-- The assignment check applies to everyone so the pair is always valid.
drop policy if exists "appt_insert" on public.appointments;
create policy "appt_insert" on public.appointments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = appointments.client_id
        and p.assigned_coach = appointments.coach_id
    )
    and (
      public.is_admin()
      or (coach_id = (select auth.uid()) and created_by = (select auth.uid()))
    )
  );

-- Update: admin or owning coach; the pair must stay a valid assignment.
-- (No client path — clients cannot edit appointments.)
drop policy if exists "appt_update" on public.appointments;
create policy "appt_update" on public.appointments
  for update to authenticated
  using (public.is_admin() or coach_id = (select auth.uid()))
  with check (
    (public.is_admin() or coach_id = (select auth.uid()))
    and exists (
      select 1 from public.profiles p
      where p.id = appointments.client_id
        and p.assigned_coach = appointments.coach_id
    )
  );

-- Delete: admin only. Coaches "remove" by cancelling (status change), which
-- preserves the audit trail (cancelled_at + reason) and notifies the client.
drop policy if exists "appt_delete" on public.appointments;
create policy "appt_delete" on public.appointments
  for delete to authenticated
  using (public.is_admin());

-- ── 3. updated_at touch (BEFORE) ─────────────────────────────────
create or replace function public.tg_appt_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_appt_touch on public.appointments;
create trigger trg_appt_touch before update on public.appointments
  for each row execute function public.tg_appt_touch();

-- ── 4. Client notification (AFTER) — reuses public.notify() ──────
-- Fires on create, reschedule (time/link change while scheduled), and
-- cancellation. The actor is the coach; the recipient is their assigned
-- client, so notify()'s coach→client authorization always passes.
create or replace function public.tg_appt_notify_client()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type_label text := case new.type
                         when 'assessment'     then 'Assessment'
                         when 'check_in'       then 'Check-in'
                         when 'follow_up'      then 'Follow-up'
                         when 'program_review' then 'Program review'
                         else 'session' end;
  v_when text := to_char(new.starts_at, 'FMDay FMDD Mon at FMHH12:MI AM');
  v_title text;
  v_body  text;
  v_ntype text;
  v_sev   text := 'info';
begin
  if tg_op = 'INSERT' then
    v_ntype := 'appointment_scheduled';
    v_title := 'New ' || v_type_label || ' session scheduled';
    v_body  := 'Your coach scheduled a ' || lower(v_type_label) || ' session for ' || v_when || '.';
  elsif tg_op = 'UPDATE' then
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      v_ntype := 'appointment_cancelled';
      v_sev   := 'warning';
      v_title := v_type_label || ' session cancelled';
      v_body  := 'Your ' || lower(v_type_label) || ' session for ' || v_when || ' has been cancelled.'
                 || case when new.cancellation_reason is not null and length(trim(new.cancellation_reason)) > 0
                         then ' ' || new.cancellation_reason else '' end;
    elsif new.status = 'scheduled'
          and (new.starts_at is distinct from old.starts_at
               or new.meeting_url is distinct from old.meeting_url) then
      v_ntype := 'appointment_updated';
      v_title := v_type_label || ' session updated';
      v_body  := 'Your ' || lower(v_type_label) || ' session has been updated — now ' || v_when || '.';
    else
      return null;  -- no client-visible change (e.g. notes edit, mark complete)
    end if;
  else
    return null;
  end if;

  if new.meeting_url is not null and new.status = 'scheduled' then
    v_body := v_body || ' Join link: ' || new.meeting_url;
  end if;

  perform public.notify(
    p_recipient_id => new.client_id,
    p_type         => v_ntype,
    p_title        => v_title,
    p_body         => v_body,
    p_link_section => 'client-coach',
    p_link_params  => jsonb_build_object('appointment_id', new.id),
    p_severity     => v_sev,
    p_data         => jsonb_build_object('appointment_id', new.id, 'type', new.type, 'status', new.status),
    p_actor_id     => new.coach_id
  );
  return null;
end;
$$;

drop trigger if exists trg_appt_notify on public.appointments;
create trigger trg_appt_notify
  after insert or update on public.appointments
  for each row execute function public.tg_appt_notify_client();

-- Trigger functions are invoked by the trigger system, never by API callers.
revoke all on function public.tg_appt_touch()         from public, anon, authenticated;
revoke all on function public.tg_appt_notify_client()  from public, anon, authenticated;
