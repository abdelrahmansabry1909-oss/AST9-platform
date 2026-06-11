-- ════════════════════════════════════════════════════════════════════
-- Option A — profiles SELECT hardening (global-for-staff → scoped)
-- ════════════════════════════════════════════════════════════════════
-- Before: SELECT policy "Coaches and admins read all profiles"
--           is_admin_or_coach() OR id = auth.uid()
--         → ANY coach could read EVERY profile row (all clients' PII:
--           emails, phones, injury history, goals), platform-wide.
--
-- After:  SELECT policy "profiles_select_scoped"
--           · everyone        → own row
--           · admin           → all rows
--           · coach           → own assigned clients (assigned_coach = uid)
--                               + staff directory (role coach/admin — required
--                                 by peer messaging, referral dropdowns, and
--                                 coach-name resolution maps)
--         Clients keep exactly today's visibility (own row only; the
--         assigned coach is resolved from the client's OWN row via the
--         denormalized assigned_coach/coach_name columns — see clientCoach.js).
--
-- Recursion safety: is_admin()/is_coach() are SECURITY DEFINER with pinned
-- search_path (they bypass profiles RLS); every other reference is a direct
-- column on the row under evaluation. No profiles self-query → no recursion.
--
-- Dependent-policy safety (verified against live pg_policies): every policy
-- on other tables that references profiles uses either
--   (a) EXISTS(... p.assigned_coach = auth.uid())  → rows still visible to
--       that coach under the new policy, or
--   (b) own-row role checks / SECURITY DEFINER helpers → unaffected.
-- security_invoker views (v_client_pulse, v_client_progression) auto-narrow
-- to assigned clients for coaches — the intended Option B semantics extended.
--
-- UPDATE / INSERT policies and the protected-columns trigger are untouched.
-- Rollback: rollbacks/20260611063848_option_a_profiles_select_scoped_down.sql

drop policy if exists "Coaches and admins read all profiles" on public.profiles;

create policy "profiles_select_scoped" on public.profiles
  for select
  using (
    id = (select auth.uid())
    or (select public.is_admin())
    or (
      (select public.is_coach())
      and (
        assigned_coach = (select auth.uid())
        or role in ('coach', 'admin')
      )
    )
  );
