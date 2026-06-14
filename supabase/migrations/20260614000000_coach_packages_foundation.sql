-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Coach Packages + Billing Foundation (Phase 2)
-- Run in Supabase SQL Editor / via apply_migration. Idempotent.
-- Rollback: migrations/rollbacks/20260614000000_coach_packages_foundation_down.sql
--
-- SCOPE: this is the per-COACH package that caps how many CLIENTS a coach
-- may have. It is SEPARATE from public.subscriptions, which is the per-
-- CLIENT access gate (login window + grace). The two never mix.
--
-- Enforcement at client-creation time lands in Phase 3 (create-user edge).
-- This phase establishes only the model + slot-status read + admin
-- assignment + a safe backfill.
--
-- Catalog (PRICES are presentation-only, in js/packages.js; the DB stores
-- ONLY the enforced integer client_limit):
--   free 1 · starter 5 · growth 10 · pro 20 · scale 50 · custom = qty(>=60)
--   client_limit NULL = unlimited (admin).
--
-- Depends on: public.is_admin() (20260515_rpm_foundation.sql),
--             profiles.assigned_coach (base schema).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. coach_subscriptions ─────────────────────────────────────
create table if not exists public.coach_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  coach_id     uuid not null unique references public.profiles(id) on delete cascade,
  package_key  text not null default 'free'
                 check (package_key in ('free','starter','growth','pro','scale','custom')),
  client_limit int check (client_limit is null or client_limit >= 1),  -- NULL = unlimited
  custom_qty   int check (custom_qty is null or custom_qty >= 60),
  status       text not null default 'active'
                 check (status in ('active','past_due','canceled')),
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  notes        text,
  created_by   uuid references public.profiles(id) on delete set null
);

comment on table public.coach_subscriptions is
  'Per-coach package + client-slot cap (NOT client access — that is '
  'public.subscriptions). client_limit NULL = unlimited. Writes only via '
  'admin_set_coach_package() RPC; no direct write policy exists.';

-- updated_at touch
create or replace function public.touch_coach_subscriptions_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists coach_subscriptions_touch on public.coach_subscriptions;
create trigger coach_subscriptions_touch
  before update on public.coach_subscriptions
  for each row execute function public.touch_coach_subscriptions_updated_at();

-- ── 2. RLS — read-own (coach) / read-all (admin); NO direct writes ──
alter table public.coach_subscriptions enable row level security;

drop policy if exists "coach_subscriptions_select" on public.coach_subscriptions;
create policy "coach_subscriptions_select" on public.coach_subscriptions
  for select to authenticated
  using ( coach_id = (select auth.uid()) or (select public.is_admin()) );

-- Intentionally NO insert/update/delete policy. With RLS enabled and no
-- write policy, every non-service role (incl. coaches AND admins acting
-- directly) is denied direct writes — a coach can never self-grant slots.
-- All mutations flow through admin_set_coach_package() (SECURITY DEFINER,
-- admin-only), which bypasses RLS by definition.

-- ── 3. coach_slot_status(coach) → jsonb ────────────────────────
-- { coach_id, package_key, client_limit, used, remaining, status, unlimited }
-- Single source of truth read by both the Billing UI and (Phase 3) the
-- create-user slot gate, so display and enforcement can never diverge.
create or replace function public.coach_slot_status(p_coach_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role   text;
  v_pkg    text;
  v_limit  int;
  v_status text;
  v_used   int;
begin
  -- AuthZ: admin, or asking about self only.
  if not ( public.is_admin() or p_coach_id = v_caller ) then
    raise exception 'permission denied';
  end if;

  select role into v_role from profiles where id = p_coach_id;
  if v_role is null then
    raise exception 'no such profile';
  end if;

  select count(*) into v_used
    from profiles p
    where p.assigned_coach = p_coach_id and p.role = 'client';

  -- Admin = unlimited; client creation is never slot-gated for admin.
  if v_role = 'admin' then
    return jsonb_build_object(
      'coach_id', p_coach_id, 'package_key', 'admin',
      'client_limit', null, 'used', v_used, 'remaining', null,
      'status', 'active', 'unlimited', true );
  end if;

  select package_key, client_limit, status
    into v_pkg, v_limit, v_status
    from coach_subscriptions where coach_id = p_coach_id;

  if v_pkg is null then          -- no row → lazy Free default (1 slot)
    v_pkg := 'free'; v_limit := 1; v_status := 'active';
  end if;

  return jsonb_build_object(
    'coach_id',     p_coach_id,
    'package_key',  v_pkg,
    'client_limit', v_limit,
    'used',         v_used,
    'remaining',    case when v_limit is null then null
                         else greatest(0, v_limit - v_used) end,
    'status',       v_status,
    'unlimited',    (v_limit is null) );
end;
$$;

grant execute on function public.coach_slot_status(uuid) to authenticated;

-- ── 4. admin_set_coach_package(...) → coach_subscriptions.id ────
-- The ONLY write path. Admin-only. Resolves client_limit from the package
-- key (custom → custom_qty, which must be >= 60). No payment is collected
-- or implied — this is the manual/admin assignment used until a payment
-- provider is wired in a later, separately-approved phase.
create or replace function public.admin_set_coach_package(
  p_coach_id    uuid,
  p_package_key text,
  p_custom_qty  int  default null,
  p_notes       text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role  text;
  v_limit int;
  v_id    uuid;
begin
  if not public.is_admin() then
    raise exception 'permission denied: admin only';
  end if;

  select role into v_role from profiles where id = p_coach_id;
  if v_role is null or v_role not in ('coach','admin') then
    raise exception 'target must be a coach or admin';
  end if;

  if p_package_key = 'custom' then
    if p_custom_qty is null or p_custom_qty < 60 then
      raise exception 'custom package requires custom_qty >= 60';
    end if;
    v_limit := p_custom_qty;
  else
    v_limit := case p_package_key
      when 'free'    then 1
      when 'starter' then 5
      when 'growth'  then 10
      when 'pro'     then 20
      when 'scale'   then 50
      else null end;
    if v_limit is null then
      raise exception 'unknown package_key: %', p_package_key;
    end if;
  end if;

  insert into coach_subscriptions
    (coach_id, package_key, client_limit, custom_qty, status, notes, created_by)
  values
    (p_coach_id, p_package_key, v_limit,
     case when p_package_key = 'custom' then p_custom_qty else null end,
     'active', p_notes, v_actor)
  on conflict (coach_id) do update
    set package_key  = excluded.package_key,
        client_limit = excluded.client_limit,
        custom_qty   = excluded.custom_qty,
        status       = 'active',
        notes        = excluded.notes,
        created_by   = excluded.created_by,
        updated_at   = now()
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.admin_set_coach_package(uuid, text, int, text) to authenticated;

-- ── 5. Safe backfill — grandfather existing coaches ────────────
-- Each existing coach receives the SMALLEST catalog tier whose limit
-- covers their CURRENT client count, so nobody is retroactively over
-- limit. Admin is excluded (coach_slot_status treats admin as unlimited).
-- Idempotent: inserts only where no row exists yet.
insert into public.coach_subscriptions
  (coach_id, package_key, client_limit, custom_qty, status, notes)
select
  c.id,
  case
    when n.cnt <= 1  then 'free'
    when n.cnt <= 5  then 'starter'
    when n.cnt <= 10 then 'growth'
    when n.cnt <= 20 then 'pro'
    when n.cnt <= 50 then 'scale'
    else 'custom' end                                  as package_key,
  case
    when n.cnt <= 1  then 1
    when n.cnt <= 5  then 5
    when n.cnt <= 10 then 10
    when n.cnt <= 20 then 20
    when n.cnt <= 50 then 50
    else greatest(n.cnt, 60) end                       as client_limit,
  case when n.cnt > 50 then greatest(n.cnt, 60) else null end as custom_qty,
  'active',
  'backfill: grandfathered at Phase 2 launch'
from public.profiles c
join lateral (
  select count(*) as cnt
  from public.profiles p
  where p.assigned_coach = c.id and p.role = 'client'
) n on true
where c.role = 'coach'
  and not exists (
    select 1 from public.coach_subscriptions s where s.coach_id = c.id
  );

-- ── 6. Smoke (each should succeed) ─────────────────────────────
--   select public.coach_slot_status();                       -- self
--   select * from public.coach_subscriptions;                -- admin sees all
