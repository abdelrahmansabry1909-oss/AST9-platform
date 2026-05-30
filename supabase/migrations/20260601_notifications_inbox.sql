-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Notifications Inbox + Alt-Exercise Requests
-- Run in Supabase SQL Editor (idempotent).
--
-- One generic notifications table + a SECURITY DEFINER `notify()` RPC
-- where the "who can notify whom" rules live in SQL once. Cross-module
-- retrofit is server-side: triggers on phase_submissions, case_shares,
-- and exercise_alternative_requests all call notify(...) on state
-- change, so existing modules never touch this code.
--
-- Subscription notifications use a separate idempotent function called
-- on demand from auth.init() — daily pg_cron is deferred.
--
-- Depends on:
--   public.is_admin()                       — 20260515_rpm_foundation.sql
--   profiles.assigned_coach                 — base schema
--   phase_submissions, rpm_graphs           — 20260515_rpm_foundation.sql
--   case_shares                             — AST9_Phase3_Migrations.sql +
--                                             20260523_case_study_approval.sql
--   v_client_subscription_state             — 20260530_subscription_grace.sql
--   client_programs, exercises              — earlier migrations
-- ═══════════════════════════════════════════════════════════════

-- ── 1. notifications table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  type          text NOT NULL,                  -- alt_exercise_request, rpm_approval_pending, …
  title         text NOT NULL,
  body          text,
  link_section  text,                           -- which app section to deep-link to
  link_params   jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity      text NOT NULL DEFAULT 'info'
                 CHECK (severity IN ('info','warning','critical')),
  read_at       timestamptz,
  archived      boolean NOT NULL DEFAULT false,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON notifications(recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON notifications(recipient_id)
  WHERE archived = false AND read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_type_idx
  ON notifications(type, created_at DESC);

COMMENT ON TABLE notifications IS
  'Polymorphic inbox. INSERT only via public.notify() so authorization '
  'lives in SQL once; SELECT/UPDATE controlled by recipient ownership.';

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Recipients read + update their own (mark read / archive).
DROP POLICY IF EXISTS "notifications_recipient_select" ON notifications;
CREATE POLICY "notifications_recipient_select" ON notifications
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "notifications_recipient_update" ON notifications;
CREATE POLICY "notifications_recipient_update" ON notifications
  FOR UPDATE TO authenticated
  USING      (recipient_id = auth.uid() OR public.is_admin())
  WITH CHECK (recipient_id = auth.uid() OR public.is_admin());

-- Direct INSERT blocked — must go through public.notify().
DROP POLICY IF EXISTS "notifications_no_direct_insert" ON notifications;
CREATE POLICY "notifications_no_direct_insert" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- Recipients can delete their own (hard delete vs archive).
DROP POLICY IF EXISTS "notifications_recipient_delete" ON notifications;
CREATE POLICY "notifications_recipient_delete" ON notifications
  FOR DELETE TO authenticated
  USING (recipient_id = auth.uid() OR public.is_admin());

-- ── 2. notify() RPC — single insert path ──────────────────────
-- Authorization rules (locked):
--   • Admin may notify anyone.
--   • Coach may notify clients they own (profiles.assigned_coach = coach).
--   • Client may notify their assigned coach.
--   • Triggers run as the row's actor; the security-definer path bypasses
--     the WITH CHECK above so server-side flows always succeed.
CREATE OR REPLACE FUNCTION public.notify(
  p_recipient_id  uuid,
  p_type          text,
  p_title         text,
  p_body          text  DEFAULT NULL,
  p_link_section  text  DEFAULT NULL,
  p_link_params   jsonb DEFAULT '{}'::jsonb,
  p_severity      text  DEFAULT 'info',
  p_data          jsonb DEFAULT '{}'::jsonb,
  p_actor_id      uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := COALESCE(p_actor_id, auth.uid());
  v_allowed  boolean := false;
  v_id       uuid;
BEGIN
  IF p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'recipient_id required';
  END IF;

  -- Self-notify always allowed (system flows that pass actor=recipient).
  IF v_actor IS NULL OR v_actor = p_recipient_id THEN
    v_allowed := true;
  ELSIF public.is_admin() THEN
    v_allowed := true;
  ELSIF EXISTS (
    -- Coach notifying their own client
    SELECT 1 FROM profiles p
    WHERE p.id = p_recipient_id
      AND p.assigned_coach = v_actor
  ) THEN
    v_allowed := true;
  ELSIF EXISTS (
    -- Client notifying their own coach
    SELECT 1 FROM profiles me
    WHERE me.id = v_actor AND me.assigned_coach = p_recipient_id
  ) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'notify: actor % not permitted to notify %', v_actor, p_recipient_id;
  END IF;

  INSERT INTO notifications
    (recipient_id, actor_id, type, title, body,
     link_section, link_params, severity, data)
  VALUES
    (p_recipient_id, v_actor, p_type, p_title, p_body,
     p_link_section, COALESCE(p_link_params, '{}'::jsonb),
     COALESCE(p_severity, 'info'), COALESCE(p_data, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify(
  uuid, text, text, text, text, jsonb, text, jsonb, uuid
) TO authenticated;

-- ── 3. exercise_alternative_requests ──────────────────────────
CREATE TABLE IF NOT EXISTS exercise_alternative_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  coach_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  program_id      uuid REFERENCES client_programs(id) ON DELETE SET NULL,
  workout_key     text NOT NULL,
  exercise_index  int  NOT NULL,
  exercise_name   text NOT NULL,
  exercise_id     uuid REFERENCES exercises(id) ON DELETE SET NULL,

  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','addressed','declined')),
  coach_response  text,
  responded_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aer_coach_status_idx
  ON exercise_alternative_requests(coach_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS aer_client_idx
  ON exercise_alternative_requests(client_id, created_at DESC);

ALTER TABLE exercise_alternative_requests ENABLE ROW LEVEL SECURITY;

-- Client owns own (insert + read own).
DROP POLICY IF EXISTS "aer_client_insert" ON exercise_alternative_requests;
CREATE POLICY "aer_client_insert" ON exercise_alternative_requests
  FOR INSERT TO authenticated
  WITH CHECK (client_id = auth.uid());

DROP POLICY IF EXISTS "aer_client_select" ON exercise_alternative_requests;
CREATE POLICY "aer_client_select" ON exercise_alternative_requests
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR coach_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "aer_client_update_pending" ON exercise_alternative_requests;
CREATE POLICY "aer_client_update_pending" ON exercise_alternative_requests
  FOR UPDATE TO authenticated
  USING      (client_id = auth.uid() AND status = 'pending')
  WITH CHECK (client_id = auth.uid() AND status = 'pending');

-- Coach updates assigned client's requests (status + response).
DROP POLICY IF EXISTS "aer_coach_update" ON exercise_alternative_requests;
CREATE POLICY "aer_coach_update" ON exercise_alternative_requests
  FOR UPDATE TO authenticated
  USING (
    coach_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (SELECT 1 FROM profiles p
               WHERE p.id = exercise_alternative_requests.client_id
                 AND p.assigned_coach = auth.uid())
  );

-- ── 4. Triggers — server-side cross-module retrofit ───────────

-- 4a. alt-exercise request created → notify coach
CREATE OR REPLACE FUNCTION public.tg_aer_notify_coach()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_name text;
BEGIN
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
DROP TRIGGER IF EXISTS tg_aer_insert ON exercise_alternative_requests;
CREATE TRIGGER tg_aer_insert
  AFTER INSERT ON exercise_alternative_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_aer_notify_coach();

-- 4b. alt-exercise request decided → notify client
CREATE OR REPLACE FUNCTION public.tg_aer_notify_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('addressed','declined') THEN RETURN NEW; END IF;

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
DROP TRIGGER IF EXISTS tg_aer_update ON exercise_alternative_requests;
CREATE TRIGGER tg_aer_update
  AFTER UPDATE OF status ON exercise_alternative_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_aer_notify_client();

-- 4c. phase_submissions INSERT → notify coach
CREATE OR REPLACE FUNCTION public.tg_phase_subm_notify_coach()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coach uuid;
  v_client_name text;
BEGIN
  SELECT coach_id INTO v_coach FROM rpm_graphs WHERE id = NEW.graph_id;
  IF v_coach IS NULL THEN RETURN NEW; END IF;
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
DROP TRIGGER IF EXISTS tg_phase_subm_insert ON phase_submissions;
CREATE TRIGGER tg_phase_subm_insert
  AFTER INSERT ON phase_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_phase_subm_notify_coach();

-- 4d. phase_submissions UPDATE status → notify client
CREATE OR REPLACE FUNCTION public.tg_phase_subm_notify_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coach uuid;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected','modified') THEN RETURN NEW; END IF;
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
DROP TRIGGER IF EXISTS tg_phase_subm_update ON phase_submissions;
CREATE TRIGGER tg_phase_subm_update
  AFTER UPDATE OF status ON phase_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_phase_subm_notify_client();

-- 4e. case_shares INSERT (pending) → notify every admin
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
DROP TRIGGER IF EXISTS tg_case_share_insert ON case_shares;
CREATE TRIGGER tg_case_share_insert
  AFTER INSERT ON case_shares
  FOR EACH ROW EXECUTE FUNCTION public.tg_case_share_notify_admins();

-- 4f. case_shares UPDATE status → notify submitting coach
CREATE OR REPLACE FUNCTION public.tg_case_share_notify_coach()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;

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
DROP TRIGGER IF EXISTS tg_case_share_update ON case_shares;
CREATE TRIGGER tg_case_share_update
  AFTER UPDATE OF status ON case_shares
  FOR EACH ROW EXECUTE FUNCTION public.tg_case_share_notify_coach();

-- ── 5. Subscription notifications (idempotent on-demand) ──────
-- Inserts at most one notification per (recipient, type, billing window)
-- where window is keyed by the current subscription row id. Safe to call
-- from auth.init() on every page load.
CREATE OR REPLACE FUNCTION public.ensure_subscription_notifications(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state    record;
  v_coach    uuid;
  v_window   text;
BEGIN
  SELECT * INTO v_state FROM v_client_subscription_state
    WHERE client_id = p_client_id LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT assigned_coach INTO v_coach FROM profiles WHERE id = p_client_id;

  -- Window key prevents duplicates per billing period.
  v_window := COALESCE(v_state.sub_id::text, 'none');

  -- Expiring soon (≤ 7 days, still active)
  IF v_state.effective_status = 'active'
     AND v_state.days_remaining IS NOT NULL
     AND v_state.days_remaining BETWEEN 0 AND 7 THEN

    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE recipient_id = p_client_id
        AND type = 'subscription_expiring'
        AND data->>'window' = v_window
    ) THEN
      PERFORM public.notify(
        p_recipient_id => p_client_id,
        p_type         => 'subscription_expiring',
        p_title        => 'Subscription ending in ' || v_state.days_remaining || ' day(s)',
        p_body         => 'Contact your coach to renew before access becomes read-only.',
        p_link_section => 'dashboard',
        p_link_params  => '{}'::jsonb,
        p_severity     => 'warning',
        p_data         => jsonb_build_object('window', v_window, 'days_remaining', v_state.days_remaining),
        p_actor_id     => p_client_id
      );
    END IF;

    IF v_coach IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE recipient_id = v_coach
        AND type = 'subscription_expiring'
        AND data->>'window' = v_window
        AND data->>'client_id' = p_client_id::text
    ) THEN
      PERFORM public.notify(
        p_recipient_id => v_coach,
        p_type         => 'subscription_expiring',
        p_title        => 'A client''s subscription ends soon',
        p_body         => 'Ending in ' || v_state.days_remaining || ' day(s) — consider reaching out.',
        p_link_section => 'subscriptions',
        p_link_params  => jsonb_build_object('client_id', p_client_id),
        p_severity     => 'info',
        p_data         => jsonb_build_object('window', v_window, 'client_id', p_client_id),
        p_actor_id     => p_client_id
      );
    END IF;
  END IF;

  -- Grace started
  IF v_state.effective_status = 'grace' THEN
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE recipient_id = p_client_id
        AND type = 'subscription_grace'
        AND data->>'window' = v_window
    ) THEN
      PERFORM public.notify(
        p_recipient_id => p_client_id,
        p_type         => 'subscription_grace',
        p_title        => 'You''re in your grace period',
        p_body         => v_state.grace_days_left || ' day(s) left to renew before access ends.',
        p_link_section => 'dashboard',
        p_link_params  => '{}'::jsonb,
        p_severity     => 'critical',
        p_data         => jsonb_build_object('window', v_window, 'grace_days_left', v_state.grace_days_left),
        p_actor_id     => p_client_id
      );
    END IF;

    IF v_coach IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE recipient_id = v_coach
        AND type = 'subscription_grace'
        AND data->>'window' = v_window
        AND data->>'client_id' = p_client_id::text
    ) THEN
      PERFORM public.notify(
        p_recipient_id => v_coach,
        p_type         => 'subscription_grace',
        p_title        => 'Client is in grace',
        p_body         => v_state.grace_days_left || ' day(s) before they lose access.',
        p_link_section => 'subscriptions',
        p_link_params  => jsonb_build_object('client_id', p_client_id),
        p_severity     => 'warning',
        p_data         => jsonb_build_object('window', v_window, 'client_id', p_client_id),
        p_actor_id     => p_client_id
      );
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_subscription_notifications(uuid)
  TO authenticated;

-- ── 6. Smoke tests (each should succeed) ──────────────────────
--   SELECT * FROM notifications LIMIT 1;
--   SELECT * FROM exercise_alternative_requests LIMIT 1;
--   SELECT public.ensure_subscription_notifications(auth.uid());
