-- 20260805000000_coach_package_expiry_enforcement_down.sql
--
-- Restores coach_slot_status() to its pre-expiry-enforcement body: byte-for-byte
-- the definition that was live before 20260805000000, with no period-end check
-- and without the 'expired' / 'current_period_end' keys.
--
-- Effect of running this: a coach whose paid period has elapsed regains their
-- full client allowance immediately. Only run it if expiry enforcement is
-- actively causing an incident.
--
-- Signature is unchanged, so CREATE OR REPLACE preserves the existing ACL.

create or replace function public.coach_slot_status(p_coach_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

comment on function public.coach_slot_status(uuid) is
  'Slot availability for a coach. { coach_id, package_key, client_limit, used, remaining, status, unlimited }';
