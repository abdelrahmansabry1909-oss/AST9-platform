-- ═══════════════════════════════════════════════════════════════
--  SECURITY · Edge Finalization S2 (Audit H-1)
--
--  Open self-signup (GoTrue disable_signup=false, confirmed in Phase 0)
--  combined with this trigger trusting raw_user_meta_data->>'role' let a
--  user self-register as admin via POST /auth/v1/signup {data:{role:'admin'}}.
--
--  Fix: NEVER trust client-supplied role. New profiles are always 'client'.
--  Role elevation happens ONLY through the authorized create-user edge
--  function (S1), whose own profiles.upsert runs AFTER this trigger and
--  sets the validated role — so admin-created coaches still become 'coach'.
--
--  Verified live (rolled back): an auth.users insert carrying
--  raw_user_meta_data.role='admin' produced profiles.role='client'.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'client'   -- SECURITY: ignore any client-supplied role; elevation only via create-user
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
