-- ═══════════════════════════════════════════════════════════════
-- Phase 10 — Coach business profile completion
--
-- Additive only. Adds coach business fields to profiles (country,
-- business_name, professional_title) and a stored billing_interval on
-- coach_subscriptions (default 'monthly' → backfills existing coaches).
-- Surfaces the new fields through the admin business overview, lets
-- admin_set_coach_package persist the interval, and exposes the stored
-- interval via coach_slot_status. No destructive change; no payment logic;
-- protected-columns trigger and slot enforcement are untouched.
--
-- Rollback: supabase/migrations/rollbacks/20260616020000_coach_business_profile_down.sql
-- ═══════════════════════════════════════════════════════════════

-- ── profiles: coach business fields (nullable, safe) ──────────────────────
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists business_name text;
alter table public.profiles add column if not exists professional_title text;

-- ── coach_subscriptions: stored billing interval (default backfills) ───────
alter table public.coach_subscriptions
  add column if not exists billing_interval text not null default 'monthly';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'coach_subscriptions_billing_interval_chk') then
    alter table public.coach_subscriptions
      add constraint coach_subscriptions_billing_interval_chk
      check (billing_interval in ('monthly','annual'));
  end if;
end $$;

-- ── coach_slot_status: expose the stored billing interval (sig unchanged) ──
create or replace function public.coach_slot_status(p_coach_id uuid default auth.uid())
  returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_caller uuid := auth.uid(); v_role text; v_pkg text; v_limit int; v_status text; v_used int; v_interval text;
begin
  if not ( public.is_admin() or p_coach_id = v_caller ) then raise exception 'permission denied'; end if;
  select role into v_role from profiles where id = p_coach_id;
  if v_role is null then raise exception 'no such profile'; end if;
  select count(*) into v_used from profiles p where p.assigned_coach = p_coach_id and p.role = 'client';
  if v_role = 'admin' then
    return jsonb_build_object('coach_id', p_coach_id, 'package_key','admin','client_limit',null,
      'used',v_used,'remaining',null,'status','active','unlimited',true,'billing_interval','monthly');
  end if;
  select package_key, client_limit, status, billing_interval into v_pkg, v_limit, v_status, v_interval
    from coach_subscriptions where coach_id = p_coach_id;
  if v_pkg is null then v_pkg := 'free'; v_limit := 1; v_status := 'active'; end if;
  return jsonb_build_object('coach_id', p_coach_id, 'package_key', v_pkg, 'client_limit', v_limit, 'used', v_used,
    'remaining', case when v_limit is null then null else greatest(0, v_limit - v_used) end,
    'status', v_status, 'unlimited', (v_limit is null), 'billing_interval', coalesce(v_interval, 'monthly'));
end; $function$;

-- ── admin_coach_business_overview: return new columns (return type → drop) ─
drop function if exists public.admin_coach_business_overview();
create function public.admin_coach_business_overview()
  returns table(coach_id uuid, coach_name text, coach_email text, phone text,
    country text, business_name text, professional_title text,
    email_verified boolean, package_key text, billing_interval text,
    client_limit integer, custom_qty integer, package_status text,
    client_count integer, remaining_slots integer, signup_date timestamptz,
    onboarding_completed_at timestamptz, is_active boolean, client_emails text[])
  language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.is_admin() then raise exception 'permission denied: admin only'; end if;
  return query
  select p.id, p.full_name, p.email, p.phone,
    p.country, p.business_name, p.professional_title,
    (u.email_confirmed_at is not null)             as email_verified,
    coalesce(cs.package_key, 'free')               as package_key,
    coalesce(cs.billing_interval, 'monthly')       as billing_interval,
    coalesce(cs.client_limit, 1)                   as client_limit,
    cs.custom_qty,
    coalesce(cs.status, 'active')                  as package_status,
    coalesce(cc.cnt, 0)                            as client_count,
    greatest(0, coalesce(cs.client_limit, 1) - coalesce(cc.cnt, 0)) as remaining_slots,
    p.created_at                                   as signup_date,
    p.onboarding_completed_at,
    p.is_active,
    coalesce(cc.emails, array[]::text[])           as client_emails
  from public.profiles p
  left join public.coach_subscriptions cs on cs.coach_id = p.id
  left join auth.users u on u.id = p.id
  left join lateral (
    select count(*)::int as cnt, array_agg(c.email order by c.email) as emails
    from public.profiles c
    where c.assigned_coach = p.id and c.role = 'client'
  ) cc on true
  where p.role = 'coach'
  order by p.created_at;
end; $function$;
revoke all on function public.admin_coach_business_overview() from public;
-- Supabase default privileges auto-grant EXECUTE to anon on new functions;
-- revoke it explicitly so only signed-in users hit the is_admin() gate (Phase 9 parity).
revoke execute on function public.admin_coach_business_overview() from anon;
grant execute on function public.admin_coach_business_overview() to authenticated, service_role;

-- ── admin_set_coach_package: persist interval (new param → drop old 4-arg) ─
drop function if exists public.admin_set_coach_package(uuid, text, integer, text);
create function public.admin_set_coach_package(p_coach_id uuid, p_package_key text,
    p_custom_qty integer default null, p_notes text default null,
    p_billing_interval text default 'monthly')
  returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_actor uuid := auth.uid(); v_role text; v_limit int; v_id uuid;
begin
  if not public.is_admin() then raise exception 'permission denied: admin only'; end if;
  if p_billing_interval not in ('monthly','annual') then
    raise exception 'billing_interval must be monthly or annual'; end if;
  select role into v_role from profiles where id = p_coach_id;
  if v_role is null or v_role not in ('coach','admin') then
    raise exception 'target must be a coach or admin'; end if;
  if p_package_key = 'custom' then
    if p_custom_qty is null or p_custom_qty < 60 then
      raise exception 'custom package requires custom_qty >= 60'; end if;
    v_limit := p_custom_qty;
  else
    v_limit := case p_package_key
      when 'free' then 1 when 'starter' then 5 when 'growth' then 10
      when 'pro' then 20 when 'scale' then 50 else null end;
    if v_limit is null then raise exception 'unknown package_key: %', p_package_key; end if;
  end if;
  insert into coach_subscriptions
    (coach_id, package_key, client_limit, custom_qty, status, notes, created_by, billing_interval)
  values (p_coach_id, p_package_key, v_limit,
     case when p_package_key = 'custom' then p_custom_qty else null end,
     'active', p_notes, v_actor, p_billing_interval)
  on conflict (coach_id) do update
    set package_key = excluded.package_key, client_limit = excluded.client_limit,
        custom_qty = excluded.custom_qty, status = 'active',
        notes = excluded.notes, created_by = excluded.created_by,
        billing_interval = excluded.billing_interval, updated_at = now()
  returning id into v_id;
  return v_id;
end; $function$;
revoke all on function public.admin_set_coach_package(uuid, text, integer, text, text) from public;
revoke execute on function public.admin_set_coach_package(uuid, text, integer, text, text) from anon;
grant execute on function public.admin_set_coach_package(uuid, text, integer, text, text) to authenticated, service_role;
