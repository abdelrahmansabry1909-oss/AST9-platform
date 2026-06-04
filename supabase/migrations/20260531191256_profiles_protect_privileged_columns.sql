-- ═══════════════════════════════════════════════════════════════
--  SECURITY STABILIZATION · Fix 1 (Audit finding C2)
--
--  Closes the privilege-escalation hole on public.profiles.
--
--  Root cause: the "Users update own profile" RLS policy is
--  USING (id = auth.uid()) with NO WITH CHECK, authenticated holds
--  table-level UPDATE, there is no column ACL, and no guard trigger.
--  A logged-in client could therefore run
--      UPDATE profiles SET role='admin' WHERE id = <self>
--  and take over the tenant. (Also lets a client self-reassign coach
--  or self-upgrade phase.)
--
--  A column-level REVOKE is NOT viable: in Supabase, admins are the
--  SAME `authenticated` Postgres role as clients (they differ only by
--  profiles.role), so revoking UPDATE on the column would also block
--  legitimate admin edits. The correct mechanism is a BEFORE UPDATE
--  trigger that distinguishes the caller via public.is_admin().
--
--  Protected columns (non-admin callers may NOT change them):
--    • role            — anti-escalation; admin-only.
--    • assigned_coach  — coach reassignment is an admin action.
--    • current_phase   — only via set_client_phase() (Fix 2), which
--                        sets a transaction-local bypass token.
--
--  Trusted bypass paths that legitimately set these columns:
--    • Admins              → public.is_admin() = true.
--    • Service role / backend (e.g. create-user edge fn) → auth.uid()
--      IS NULL. (Anon cannot reach a row anyway: RLS USING clauses are
--      all keyed on auth.uid(), so an unauthenticated UPDATE matches
--      zero rows before the trigger ever fires.)
--    • set_client_phase() → sets neucore.allow_phase_change='on' for
--      the transaction, scoped strictly to the current_phase column.
--
--  Verified live (impersonating a real client via request.jwt.claims,
--  rolled back): role→admin BLOCKED, assigned_coach BLOCKED,
--  current_phase-without-token BLOCKED, full_name ALLOWED,
--  current_phase-with-token ALLOWED.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_profile_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Admins and trusted backend (service role, no JWT) may change anything.
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'profiles.role may only be changed by an admin';
  END IF;

  IF NEW.assigned_coach IS DISTINCT FROM OLD.assigned_coach THEN
    RAISE EXCEPTION 'profiles.assigned_coach may only be changed by an admin';
  END IF;

  IF NEW.current_phase IS DISTINCT FROM OLD.current_phase
     AND current_setting('neucore.allow_phase_change', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'profiles.current_phase may only be changed via set_client_phase()';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_profiles_protect_columns ON public.profiles;
CREATE TRIGGER tg_profiles_protect_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_protected_columns();
