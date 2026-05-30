-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Tier 1 hardening: notification trigger guards + Phase
-- Upgrade publishing into the inbox.
--
-- Two changes:
--
-- 1. FK-safety guards on every notification trigger.
--    notifications.recipient_id FKs to profiles(id) NOT NULL. But the
--    legacy tables rpm_graphs.coach_id and case_shares.coach_id FK to
--    auth.users(id). If a coach exists in auth.users without a mirrored
--    profiles row, the trigger's notify() insert would FK-violate and
--    roll back the parent INSERT (the phase submission / case share).
--
--    Each trigger function is recreated to skip notify() when the
--    intended recipient has no profiles row. The parent INSERT then
--    succeeds; the notification is simply not created.
--
-- 2. Phase Upgrade publishes a notification.
--    Dashboard.submitPhaseUpgrade updates profiles.current_phase
--    directly. A new AFTER UPDATE trigger on profiles publishes a
--    'phase_upgrade' notification to the client. Existing celebration
--    email is unaffected.
--
-- Idempotent. Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Helper: profile exists? ────────────────────────────────
CREATE OR REPLACE FUNCTION public._profile_exists(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_id);
$$;

-- ── 2. Recreate triggers with guards ──────────────────────────

-- 2a. alt-exercise request created → notify coach (only if coach has profile)
CREATE OR REPLACE FUNCTION public.tg_aer_notify_coach()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_name text;
BEGIN
  IF NOT public._profile_exists(NEW.coach_id) THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, email) INTO v_client_name
    FROM profiles WHERE id = NEW.client_id;
  PERFORM public.notify(
    p_recipient_id => NEW.coach_id,
    p_type         => 'alt_exercise_request',
    p_title        => 'Alternative exercise requested',
    p_body         => COALESCE(v_client_name, 'A client') || ' is asking about: ' || NEW.exercise_name,
    p_link_section => 'notifications',
    p_link_params  => jsonb_build_object('request_id', NEW.id, 'client_id', NEW.client_id),
    p_severity     => 'warning',
    p_data         => jsonb_build_object(
                        'request_id',    NEW.id,
                        'workout_key',   NEW.workout_key,
                        'exercise_name', NEW.exercise_name,
                        'reason',        NEW.reason),
    p_actor_id     => NEW.client_id
  );
  RETURN NEW;
END;
$$;

-- 2b. alt-exercise request decided → notify client
CREATE OR REPLACE FUNCTION public.tg_aer_notify_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('addressed','declined') THEN RETURN NEW; END IF;
  IF NOT public._profile_exists(NEW.client_id) THEN RETURN NEW; END IF;
  PERFORM public.notify(
    p_recipient_id => NEW.client_id,
    p_type         => 'alt_exercise_decided',
    p_title        => CASE WHEN NEW.status = 'addressed'
                           THEN 'Your alternative exercise was addressed'
                           ELSE 'Your alternative request was declined' END,
    p_body         => COALESCE(NEW.coach_response, 'See details for next steps.'),
    p_link_section => 'my-program',
    p_link_params  => jsonb_build_object('request_id', NEW.id),
    p_severity     => CASE WHEN NEW.status = 'addressed' THEN 'info' ELSE 'warning' END,
    p_data         => jsonb_build_object('request_id', NEW.id, 'status', NEW.status),
    p_actor_id     => NEW.coach_id
  );
  RETURN NEW;
END;
$$;

-- 2c. phase_submissions INSERT → notify coach (only if coach has profile)
CREATE OR REPLACE FUNCTION public.tg_phase_subm_notify_coach()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coach uuid;
  v_client_name text;
BEGIN
  SELECT coach_id INTO v_coach FROM rpm_graphs WHERE id = NEW.graph_id;
  IF v_coach IS NULL THEN RETURN NEW; END IF;
  IF NOT public._profile_exists(v_coach) THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, email) INTO v_client_name
    FROM profiles WHERE id = NEW.client_id;
  PERFORM public.notify(
    p_recipient_id => v_coach,
    p_type         => 'rpm_approval_pending',
    p_title        => 'Phase submission awaiting review',
    p_body         => COALESCE(v_client_name, 'A client') || ' submitted a phase for your approval.',
    p_link_section => 'rpm-approvals',
    p_link_params  => jsonb_build_object('submission_id', NEW.id, 'client_id', NEW.client_id),
    p_severity     => 'warning',
    p_data         => jsonb_build_object('submission_id', NEW.id, 'graph_id', NEW.graph_id),
    p_actor_id     => NEW.client_id
  );
  RETURN NEW;
END;
$$;

-- 2d. phase_submissions UPDATE status → notify client
CREATE OR REPLACE FUNCTION public.tg_phase_subm_notify_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coach uuid;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected','modified') THEN RETURN NEW; END IF;
  IF NOT public._profile_exists(NEW.client_id) THEN RETURN NEW; END IF;
  SELECT coach_id INTO v_coach FROM rpm_graphs WHERE id = NEW.graph_id;
  PERFORM public.notify(
    p_recipient_id => NEW.client_id,
    p_type         => 'rpm_approval_decided',
    p_title        => CASE NEW.status
                        WHEN 'approved' THEN 'Phase approved — you can advance'
                        WHEN 'modified' THEN 'Phase needs modification'
                        ELSE 'Phase rejected — see notes' END,
    p_body         => NEW.coach_note,
    p_link_section => 'my-graph',
    p_link_params  => jsonb_build_object('submission_id', NEW.id, 'graph_id', NEW.graph_id),
    p_severity     => CASE NEW.status WHEN 'approved' THEN 'info' ELSE 'warning' END,
    p_data         => jsonb_build_object('submission_id', NEW.id, 'status', NEW.status),
    p_actor_id     => v_coach
  );
  RETURN NEW;
END;
$$;

-- 2e. case_shares INSERT (pending) → notify each admin (with profile)
CREATE OR REPLACE FUNCTION public.tg_case_share_notify_admins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin record;
  v_coach_name text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, email) INTO v_coach_name
    FROM profiles WHERE id = NEW.coach_id;
  FOR v_admin IN SELECT id FROM profiles WHERE role = 'admin' LOOP
    -- profile guaranteed; pulled from profiles directly.
    PERFORM public.notify(
      p_recipient_id => v_admin.id,
      p_type         => 'case_approval_pending',
      p_title        => 'Case study awaiting approval',
      p_body         => COALESCE(v_coach_name,'A coach') || ' submitted: ' || NEW.title,
      p_link_section => 'rpm-approvals',
      p_link_params  => jsonb_build_object('case_id', NEW.id),
      p_severity     => 'info',
      p_data         => jsonb_build_object('case_id', NEW.id),
      p_actor_id     => NEW.coach_id
    );
  END LOOP;
  RETURN NEW;
END;
$$;

-- 2f. case_shares UPDATE → notify submitting coach (only if coach has profile)
CREATE OR REPLACE FUNCTION public.tg_case_share_notify_coach()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;
  IF NOT public._profile_exists(NEW.coach_id) THEN RETURN NEW; END IF;
  PERFORM public.notify(
    p_recipient_id => NEW.coach_id,
    p_type         => 'case_approval_decided',
    p_title        => CASE NEW.status
                        WHEN 'approved' THEN 'Case study approved'
                        ELSE 'Case study rejected' END,
    p_body         => NEW.review_note,
    p_link_section => 'case-studies',
    p_link_params  => jsonb_build_object('case_id', NEW.id),
    p_severity     => CASE NEW.status WHEN 'approved' THEN 'info' ELSE 'warning' END,
    p_data         => jsonb_build_object('case_id', NEW.id, 'status', NEW.status),
    p_actor_id     => NEW.reviewed_by
  );
  RETURN NEW;
END;
$$;

-- ── 3. Phase Upgrade notification — trigger on profiles ───────
-- Fires when current_phase actually changes. Existing JS flow
-- (Dashboard.submitPhaseUpgrade) updates this column directly, so no
-- JS edit is needed.
CREATE OR REPLACE FUNCTION public.tg_profile_phase_upgrade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only fire on actual phase changes for clients.
  IF NEW.current_phase IS NULL OR NEW.current_phase = OLD.current_phase THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM 'client' THEN RETURN NEW; END IF;

  PERFORM public.notify(
    p_recipient_id => NEW.id,
    p_type         => 'phase_upgrade',
    p_title        => '🏆 Phase upgrade — ' || NEW.current_phase,
    p_body         => 'Your coach advanced you to ' || NEW.current_phase
                      || '. Open your dashboard to see what changes.',
    p_link_section => 'dashboard',
    p_link_params  => jsonb_build_object('new_phase', NEW.current_phase),
    p_severity     => 'info',
    p_data         => jsonb_build_object(
                        'from_phase', OLD.current_phase,
                        'to_phase',   NEW.current_phase),
    p_actor_id     => COALESCE(auth.uid(), NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_profile_phase_upgrade ON profiles;
CREATE TRIGGER tg_profile_phase_upgrade
  AFTER UPDATE OF current_phase ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profile_phase_upgrade();

-- ── 4. Smoke tests ───────────────────────────────────────────
--   SELECT public._profile_exists(auth.uid());
--   -- Phase upgrade self-test (will fail RLS unless you are the client
--   -- being upgraded OR are admin):
--   -- UPDATE profiles SET current_phase = 'Phase 2' WHERE id = '<client>';
--   -- SELECT * FROM notifications
--   --   WHERE type='phase_upgrade' ORDER BY created_at DESC LIMIT 1;
