-- ═══════════════════════════════════════════════════════════════
--  SECURITY STABILIZATION · Fix 2 (Audit finding C1)
--
--  Coach phase upgrades were a direct `UPDATE profiles SET current_phase`
--  from the client. profiles UPDATE policies only allow admin + self, so
--  a non-admin coach updated 0 rows yet PostgREST returned error=null —
--  the UI showed success + confetti + sent a phase-upgrade email while
--  nothing changed and no notification fired.
--
--  This RPC is the single authoritative phase-change path:
--    • authorization: admin OR the client's assigned coach
--    • validation:    valid 'Phase N' label, no same-phase, no downgrade
--    • performs the protected UPDATE under the Fix-1 bypass token, so the
--      enforce_profile_protected_columns() guard permits it
--    • returns the updated row so the UI can confirm the real DB result
--    • the existing AFTER UPDATE trigger (tg_profile_phase_upgrade) still
--      fires the client notification
--
--  Verified live (impersonating coach/client via request.jwt.claims,
--  rolled back): assigned-coach upgrade OK, same-phase BLOCKED,
--  non-assigned actor DENIED.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_client_phase(p_client_id uuid, p_new_phase text)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_role    text;
  v_old     text;
  v_cur_ord int;
  v_new_ord int;
  v_row     public.profiles;
BEGIN
  SELECT role, current_phase INTO v_role, v_old FROM profiles WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client not found';
  END IF;
  IF v_role IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'target is not a client';
  END IF;

  IF NOT (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = p_client_id AND p.assigned_coach = v_actor)
  ) THEN
    RAISE EXCEPTION 'permission denied: not the assigned coach or admin';
  END IF;

  IF p_new_phase IS NULL OR p_new_phase !~ '^Phase [1-9][0-9]*$' THEN
    RAISE EXCEPTION 'invalid phase: %', p_new_phase;
  END IF;

  v_cur_ord := COALESCE(NULLIF(regexp_replace(COALESCE(v_old, ''), '\D', '', 'g'), '')::int, 0);
  v_new_ord := regexp_replace(p_new_phase, '\D', '', 'g')::int;

  IF v_new_ord = v_cur_ord THEN
    RAISE EXCEPTION 'client is already on %', COALESCE(v_old, 'that phase');
  END IF;
  IF v_new_ord < v_cur_ord THEN
    RAISE EXCEPTION 'downgrade not supported (% -> %)', v_old, p_new_phase;
  END IF;

  PERFORM set_config('neucore.allow_phase_change', 'on', true);
  UPDATE profiles SET current_phase = p_new_phase WHERE id = p_client_id
    RETURNING * INTO v_row;
  PERFORM set_config('neucore.allow_phase_change', 'off', true);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_client_phase(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_client_phase(uuid, text) TO authenticated;
