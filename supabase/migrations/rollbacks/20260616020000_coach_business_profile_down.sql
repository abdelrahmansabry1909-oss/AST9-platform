-- ═══════════════════════════════════════════════════════════════
-- Rollback for 20260616020000_coach_business_profile
-- Restores the pre-Phase-10 RPC signatures/bodies and drops the added
-- columns. Safe to run; reverts to the exact prior state.
-- ═══════════════════════════════════════════════════════════════

-- ── admin_set_coach_package: restore original 4-arg version ───────────────
drop function if exists public.admin_set_coach_package(uuid, text, integer, text, text);
create function public.admin_set_coach_package(p_coach_id uuid, p_package_key text,
    p_custom_qty integer default null, p_notes text default null)
  returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_actor uuid := auth.uid(); v_role text; v_limit int; v_id uuid;
begin
  if not public.is_admin() then raise exception 'permission denied: admin only'; end if;
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
    (coach_id, package_key, client_limit, custom_qty, status, notes, created_by)
  values (p_coach_id, p_package_key, v_limit,
     case when p_package_key = 'custom' then p_custom_qty else null end,
     'active', p_notes, v_actor)
  on conflict (coach_id) do update
    set package_key = excluded.package_key, client_limit = excluded.client_limit,
        custom_qty = excluded.custom_qty, status = 'active',
        notes = excluded.notes, created_by = excluded.created_by, updated_at = now()
  returning id into v_id;
  return v_id;
end; $function$;
revoke all on function public.admin_set_coach_package(uuid, text, integer, text) from public;
revoke execute on function public.admin_set_coach_package(uuid, text, integer, text) from anon;
grant execute on function public.admin_set_coach_package(uuid, text, integer, text) to authenticated, service_role;

-- ── admin_coach_business_overview: restore original 15-column version ──────
drop function if exists public.admin_coach_business_overview();
create function public.admin_coach_business_overview()
  returns table(coach_id uuid, coach_name text, coach_email text, phone text,
    email_verified boolean, package_key text, client_limit integer, custom_qty integer,
    package_status text, client_count integer, remaining_slots integer,
    signup_date timestamptz, onboarding_completed_at timestamptz, is_active boolean, client_emails text[])
  language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.is_admin() then raise exception 'permission denied: admin only'; end if;
  return query
  select p.id, p.full_name, p.email, p.phone,
    (u.email_confirmed_at is not null)             as email_verified,
    coalesce(cs.package_key, 'free')               as package_key,
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
revoke execute on function public.admin_coach_business_overview() from anon;
grant execute on function public.admin_coach_business_overview() to authenticated, service_role;

-- ── coach_slot_status: restore original (no billing_interval key) ─────────
create or replace function public.coach_slot_status(p_coach_id uuid default auth.uid())
  returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_caller uuid := auth.uid(); v_role text; v_pkg text; v_limit int; v_status text; v_used int;
begin
  if not ( public.is_admin() or p_coach_id = v_caller ) then raise exception 'permission denied'; end if;
  select role into v_role from profiles where id = p_coach_id;
  if v_role is null then raise exception 'no such profile'; end if;
  select count(*) into v_used from profiles p where p.assigned_coach = p_coach_id and p.role = 'client';
  if v_role = 'admin' then
    return jsonb_build_object('coach_id', p_coach_id, 'package_key','admin','client_limit',null,
      'used',v_used,'remaining',null,'status','active','unlimited',true);
  end if;
  select package_key, client_limit, status into v_pkg, v_limit, v_status
    from coach_subscriptions where coach_id = p_coach_id;
  if v_pkg is null then v_pkg := 'free'; v_limit := 1; v_status := 'active'; end if;
  return jsonb_build_object('coach_id', p_coach_id, 'package_key', v_pkg, 'client_limit', v_limit, 'used', v_used,
    'remaining', case when v_limit is null then null else greatest(0, v_limit - v_used) end,
    'status', v_status, 'unlimited', (v_limit is null));
end; $function$;

-- ── drop the added columns ────────────────────────────────────────────────
alter table public.coach_subscriptions drop constraint if exists coach_subscriptions_billing_interval_chk;
alter table public.coach_subscriptions drop column if exists billing_interval;
alter table public.profiles drop column if exists professional_title;
alter table public.profiles drop column if exists business_name;
alter table public.profiles drop column if exists country;
