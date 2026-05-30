-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Advisor hardening
-- Closes three function_search_path_mutable warnings + nine
-- anon_security_definer / authenticated_security_definer warnings
-- introduced by Features 1-4 + Tier 1.
--
-- After this migration, of the 15 remaining security advisor warnings,
-- only THREE come from this body of work and all three are by design:
--   * notify(authenticated)                       — gated internally
--   * reactivate_subscription(authenticated)      — gated internally
--   * ensure_subscription_notifications(authntcd) — called by auth.init
--
-- Pre-existing warnings (is_admin/is_coach/get_my_role/etc) are
-- intentionally NOT addressed here — that's outside this work's scope.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. SET search_path on three of our functions ──────────────
CREATE OR REPLACE FUNCTION public._clamp_score(v numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT GREATEST(0::numeric, LEAST(100::numeric, COALESCE(v, 0)));
$$;

CREATE OR REPLACE FUNCTION public._profile_exists(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_id);
$$;

CREATE OR REPLACE FUNCTION public.touch_workout_log_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ── 2. Revoke anon EXECUTE on the three public RPCs ───────────
REVOKE EXECUTE ON FUNCTION public.notify(uuid, text, text, text, text, jsonb, text, jsonb, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reactivate_subscription(uuid, int, date, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ensure_subscription_notifications(uuid) FROM anon, public;

-- ── 3. Trigger functions are never RPC-callable. Revoke broadly.
REVOKE EXECUTE ON FUNCTION public.tg_aer_notify_coach()         FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.tg_aer_notify_client()        FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.tg_phase_subm_notify_coach()  FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.tg_phase_subm_notify_client() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.tg_case_share_notify_admins() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.tg_case_share_notify_coach()  FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.tg_profile_phase_upgrade()    FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.touch_workout_log_updated_at() FROM anon, authenticated, public;

REVOKE EXECUTE ON FUNCTION public._clamp_score(numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public._profile_exists(uuid) FROM anon, public;
