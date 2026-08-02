-- 20260805000000_coach_package_expiry_enforcement.sql
--
-- Coach package periods were recorded but never enforced. current_period_end is
-- written by apply_paid_coach_package_period_system and read by NOTHING: no
-- function, no policy, no cron. subscription-checker expires *client*
-- subscriptions only. A coach whose paid month elapsed therefore kept their full
-- client allowance forever, for free.
--
-- coach_slot_status() is the single source of truth for slot availability -- the
-- create-user edge function gates on it before any write, and the billing UI
-- renders from it -- so enforcing expiry here closes the gap everywhere at once
-- without adding a call site that a future path could forget.
--
-- Behaviour once the period has elapsed: the coach falls back to the FREE
-- allowance of 1 slot. Existing clients and every row of their data are
-- untouched; only NEW client creation is blocked, and renewal restores the full
-- allowance immediately with no repair step.
--
-- package_key keeps reporting what was purchased (with status 'expired') rather
-- than reverting to 'free', so the UI can say "Growth - expired" instead of
-- pretending the coach was never a customer.
--
-- current_period_end IS NULL means "no paid period": free coaches, and packages
-- granted directly by the owner through admin_set_coach_package, which does not
-- set a period and must never expire.
--
-- Signature is unchanged, so CREATE OR REPLACE preserves the existing ACL and no
-- new grant is introduced.

create or replace function public.coach_slot_status(p_coach_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller     uuid := auth.uid();
  v_role       text;
  v_pkg        text;
  v_limit      int;
  v_status     text;
  v_used       int;
  v_interval   text;
  v_period_end timestamptz;
  v_expired    boolean := false;
begin
  if not ( public.is_admin() or p_coach_id = v_caller ) then
    raise exception 'permission denied';
  end if;

  select role into v_role from profiles where id = p_coach_id;
  if v_role is null then raise exception 'no such profile'; end if;

  select count(*) into v_used
    from profiles p
   where p.assigned_coach = p_coach_id and p.role = 'client';

  -- Admin is unlimited and never slot-gated.
  if v_role = 'admin' then
    return jsonb_build_object(
      'coach_id', p_coach_id, 'package_key', 'admin', 'client_limit', null,
      'used', v_used, 'remaining', null, 'status', 'active', 'unlimited', true,
      'billing_interval', 'monthly', 'expired', false, 'current_period_end', null);
  end if;

  select package_key, client_limit, status, billing_interval, current_period_end
    into v_pkg, v_limit, v_status, v_interval, v_period_end
    from coach_subscriptions
   where coach_id = p_coach_id;

  if v_pkg is null then
    v_pkg := 'free'; v_limit := 1; v_status := 'active';
  end if;

  -- The enforcement this migration adds.
  if v_period_end is not null and v_period_end < now() then
    v_expired := true;
    v_limit   := 1;          -- free allowance
    v_status  := 'expired';
  end if;

  return jsonb_build_object(
    'coach_id',           p_coach_id,
    'package_key',        v_pkg,
    'client_limit',       v_limit,
    'used',               v_used,
    'remaining',          case when v_limit is null then null
                               else greatest(0, v_limit - v_used) end,
    'status',             v_status,
    'unlimited',          (v_limit is null),
    'billing_interval',   coalesce(v_interval, 'monthly'),
    'expired',            v_expired,
    'current_period_end', v_period_end);
end;
$function$;

comment on function public.coach_slot_status(uuid) is
  'Slot availability for a coach. Authoritative for the create-user gate. A '
  'current_period_end in the past falls the coach back to the free allowance of '
  '1 slot (status "expired"); existing clients are never touched.';
