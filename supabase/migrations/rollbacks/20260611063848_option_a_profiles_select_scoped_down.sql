-- Rollback: Option A profiles SELECT hardening
-- Restores the pre-Option-A global-staff SELECT policy exactly as it existed
-- ("Coaches and admins read all profiles": is_admin_or_coach() OR own row).
-- Run this if any coach/client/admin profile-read surface regresses.

drop policy if exists "profiles_select_scoped" on public.profiles;

create policy "Coaches and admins read all profiles" on public.profiles
  for select
  using (is_admin_or_coach() or (id = (select auth.uid())));
