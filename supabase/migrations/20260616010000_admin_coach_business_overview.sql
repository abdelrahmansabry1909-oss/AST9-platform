-- ═══════════════════════════════════════════════════════════════
-- Phase 9 — Admin business tracking
--
-- admin_coach_business_overview(): an admin-only SECURITY DEFINER read of
-- every coach's business facts — package, slots, signup, email-verification
-- (from auth.users, which the frontend cannot query directly), and the
-- assigned-client email list (for marketing/offers + CSV export).
--
-- Reuses existing foundation: profiles, coach_subscriptions, the package
-- keys/limits set by admin_set_coach_package(). NO pricing in the DB —
-- prices live in js/packages.js. NO passwords are read or returned.
--
-- Security: gated by is_admin(); EXECUTE revoked from anon, granted to
-- authenticated (the is_admin() check is the real boundary). Coaches and
-- clients calling this get "permission denied".
-- ═══════════════════════════════════════════════════════════════

create or replace function public.admin_coach_business_overview()
returns table (
  coach_id                uuid,
  coach_name              text,
  coach_email             text,
  phone                   text,
  email_verified          boolean,
  package_key             text,
  client_limit            integer,
  custom_qty              integer,
  package_status          text,
  client_count            integer,
  remaining_slots         integer,
  signup_date             timestamptz,
  onboarding_completed_at timestamptz,
  is_active               boolean,
  client_emails           text[]
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- Admin-only. Never expose coach/client business data to anyone else.
  if not public.is_admin() then
    raise exception 'permission denied: admin only';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.email,
    p.phone,
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
    select count(*)::int as cnt,
           array_agg(c.email order by c.email) as emails
    from public.profiles c
    where c.assigned_coach = p.id and c.role = 'client'
  ) cc on true
  where p.role = 'coach'
  order by p.created_at;
end;
$$;

revoke all     on function public.admin_coach_business_overview() from public, anon;
grant  execute on function public.admin_coach_business_overview() to authenticated;
