-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Feature 6: Alternative Exercise Replacement Workflow
-- ═══════════════════════════════════════════════════════════════
-- Closes the half-finished F3 promise: coach can now actually swap a
-- client's exercise, not just reply with text. The published program
-- JSON is NEVER mutated — substitutions live on the request row and
-- are applied as an override layer by the client renderer.
--
-- This migration ships THREE changes:
--   1. ALTER TABLE — add substitute_exercise_id + partial index
--   2. tg_aer_notify_client refresh — body text mentions substitute
--   3. v_client_progression v1.1 — successfully-substituted requests
--      no longer cost the client 5 Recovery points (per user direction
--      Q1 in FEATURE_6_ARCHITECTURE.md §10).
--
-- Formula change (locked rule): v1.0 → v1.1.
--   The locked architectural rule (PROJECT_STATUS.md §1.2) forbids
--   silent in-place edits to the progression formula. This migration
--   is the audited, version-stamped path: formula_version bumps to
--   '1.1' and the CHANGELOG below names exactly what changed.
--
-- CHANGELOG v1.0 → v1.1:
--   • alt CTE now filters out requests where status='addressed' AND
--     substitute_exercise_id IS NOT NULL. Rationale: a client should
--     not be penalized for communicating a legitimate limitation that
--     the coach successfully resolved. Only unresolved (`pending`),
--     declined, or never-substituted-addressed requests count.
--   • All other signals (Compliance, Performance, Overall weighting)
--     unchanged. Same clamp helper. Same window.
--   • Visible effect: any client whose `addressed` requests have a
--     non-null substitute_exercise_id will see Recovery rise by
--     5 × those_requests on next render.
--
-- Idempotent — safe to re-apply.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. substitute_exercise_id column + partial index ─────────────
ALTER TABLE exercise_alternative_requests
  ADD COLUMN IF NOT EXISTS substitute_exercise_id uuid
    REFERENCES exercises(id) ON DELETE SET NULL;

COMMENT ON COLUMN exercise_alternative_requests.substitute_exercise_id IS
  'When set, the client''s program view (My Program + Workout Tracker) '
  'swaps the original exercise at (workout_key, exercise_index) for this '
  'library exercise. NULL = no substitute (free-text response only). '
  'ON DELETE SET NULL means deleting a library exercise auto-clears the '
  'substitution and the client falls back to the original. Persists until '
  'the coach clears it or the program is republished (programPublish.publish '
  'closes all active substitutions for the client in one UPDATE).';

CREATE INDEX IF NOT EXISTS aer_active_substitutes_idx
  ON exercise_alternative_requests(client_id, status)
  WHERE status = 'addressed' AND substitute_exercise_id IS NOT NULL;

-- ── 2. tg_aer_notify_client refresh — substitute-aware body ──────
-- Same trigger, same event (AFTER UPDATE OF status), same RPC call.
-- Only the body text is enriched when a substitute is present so the
-- client notification reads "Your coach replaced X with Y — <text>"
-- instead of the generic "addressed" body.
CREATE OR REPLACE FUNCTION public.tg_aer_notify_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub_name text;
  v_body     text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('addressed','declined') THEN RETURN NEW; END IF;
  -- FK guard (Tier-1 contract — preserved).
  IF NOT public._profile_exists(NEW.client_id) THEN RETURN NEW; END IF;

  IF NEW.status = 'addressed' AND NEW.substitute_exercise_id IS NOT NULL THEN
    SELECT name INTO v_sub_name FROM exercises WHERE id = NEW.substitute_exercise_id;
    v_body := 'Your coach replaced ' || NEW.exercise_name
              || ' with ' || COALESCE(v_sub_name, 'a new exercise')
              || CASE WHEN NEW.coach_response IS NOT NULL
                       AND length(NEW.coach_response) > 0
                      THEN ' — ' || NEW.coach_response
                      ELSE '.' END;
  ELSE
    v_body := COALESCE(NEW.coach_response, 'See details for next steps.');
  END IF;

  PERFORM public.notify(
    p_recipient_id => NEW.client_id,
    p_type         => 'alt_exercise_decided',
    p_title        => CASE WHEN NEW.status = 'addressed'
                           THEN 'Your alternative exercise was addressed'
                           ELSE 'Your alternative request was declined' END,
    p_body         => v_body,
    p_link_section => 'my-program',
    p_link_params  => jsonb_build_object(
                        'request_id',             NEW.id,
                        'substitute_exercise_id', NEW.substitute_exercise_id),
    p_severity     => CASE WHEN NEW.status = 'addressed' THEN 'info' ELSE 'warning' END,
    p_data         => jsonb_build_object(
                        'request_id',             NEW.id,
                        'status',                 NEW.status,
                        'substitute_exercise_id', NEW.substitute_exercise_id),
    p_actor_id     => NEW.coach_id
  );
  RETURN NEW;
END;
$$;

-- Trigger itself unchanged (same name, same event) — CREATE OR REPLACE
-- FUNCTION above just swapped the body.
-- Tier-2 hygiene mirrors 20260604_advisor_hardening.sql:
REVOKE EXECUTE ON FUNCTION public.tg_aer_notify_client() FROM anon, authenticated, public;

-- ── 3. v_client_progression v1.1 — alt CTE substitute-aware ──────
-- Only the `alt` CTE changes vs v1.0. Everything else is identical.
-- formula_version literal flips from '1.0' to '1.1'.
DROP VIEW IF EXISTS v_client_progression CASCADE;
CREATE VIEW v_client_progression
WITH (security_invoker = true)
AS
WITH
  win AS (
    SELECT (current_date - 29)::date AS w30_start,
           (current_date -  6)::date AS w7_start,
           current_date              AS today
  ),
  clients AS (SELECT id AS client_id FROM profiles WHERE role = 'client'),
  w30 AS (
    SELECT c.client_id,
      COUNT(s.*) FILTER (WHERE s.started_at::date >= w.w30_start) AS started_30d,
      COUNT(s.*) FILTER (WHERE s.status='completed' AND s.ended_at::date >= w.w30_start) AS completed_30d,
      COUNT(s.*) FILTER (WHERE s.status='abandoned' AND s.started_at::date >= w.w30_start) AS abandoned_30d,
      AVG(s.intensity_rating) FILTER (WHERE s.status='completed' AND s.ended_at::date >= w.w30_start) AS avg_intensity_30d,
      COUNT(s.*) FILTER (WHERE s.status='completed' AND s.intensity_rating >= 9
                          AND s.ended_at::date >= w.w30_start) AS overreach_30d
    FROM clients c CROSS JOIN win w
    LEFT JOIN workout_sessions s ON s.client_id = c.client_id
    GROUP BY c.client_id, w.w30_start
  ),
  w7 AS (
    SELECT c.client_id,
      COUNT(s.*) FILTER (WHERE s.status='completed' AND s.ended_at::date >= w.w7_start) AS completed_7d
    FROM clients c CROSS JOIN win w
    LEFT JOIN workout_sessions s ON s.client_id = c.client_id
    GROUP BY c.client_id, w.w7_start
  ),
  ex_quality AS (
    SELECT s.client_id,
      AVG(CASE WHEN cnt.total > 0 THEN cnt.done::numeric / cnt.total * 100 ELSE NULL END) AS pct_completed_30d
    FROM workout_sessions s CROSS JOIN win w
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE completed=true) AS done
      FROM workout_exercise_logs l WHERE l.session_id = s.id
    ) cnt ON true
    WHERE s.status='completed' AND s.ended_at::date >= w.w30_start
    GROUP BY s.client_id
  ),
  routine_norm AS (
    SELECT dr.client_id, dr.log_date,
      COALESCE(dr.battery_pct,
               CASE WHEN dr.completed THEN 100 ELSE 0 END)::numeric AS routine_pct
    FROM daily_routine_logs dr
  ),
  routine AS (
    SELECT c.client_id,
      AVG(rn.routine_pct) FILTER (WHERE rn.log_date >= w.w30_start) AS routine_pct_30d,
      AVG(rn.routine_pct) FILTER (WHERE rn.log_date >= w.w7_start)  AS routine_pct_7d,
      COUNT(*)            FILTER (WHERE rn.log_date >= w.w30_start) AS routine_days_30d
    FROM clients c CROSS JOIN win w
    LEFT JOIN routine_norm rn ON rn.client_id = c.client_id
    GROUP BY c.client_id, w.w30_start, w.w7_start
  ),
  -- v1.1 CHANGE: a successfully-substituted request no longer counts as
  -- friction. Filter requires (NOT(status='addressed' AND substitute IS NOT NULL)).
  -- Pending and declined and addressed-without-substitute still count.
  alt AS (
    SELECT c.client_id,
      COUNT(a.*) FILTER (
        WHERE a.created_at::date >= w.w30_start
          AND NOT (a.status = 'addressed' AND a.substitute_exercise_id IS NOT NULL)
      ) AS alt_requests_30d
    FROM clients c CROSS JOIN win w
    LEFT JOIN exercise_alternative_requests a ON a.client_id = c.client_id
    GROUP BY c.client_id, w.w30_start
  ),
  ex_top AS (
    SELECT s.client_id, l.exercise_name, s.ended_at,
      MAX(COALESCE((set_elem->>'reps')::numeric, 0)
        * COALESCE((set_elem->>'weight')::numeric, 0)) AS top_vol
    FROM workout_sessions s
    JOIN workout_exercise_logs l ON l.session_id = s.id
    CROSS JOIN win w
    LEFT JOIN LATERAL jsonb_array_elements(l.sets) set_elem ON true
    WHERE s.status='completed' AND s.ended_at::date >= w.w30_start
      AND l.sets IS NOT NULL AND jsonb_array_length(l.sets) > 0
    GROUP BY s.client_id, l.exercise_name, s.ended_at
  ),
  ex_progress AS (
    SELECT client_id, exercise_name,
      MIN(top_vol) FILTER (WHERE top_vol > 0) AS first_vol,
      (array_agg(top_vol ORDER BY ended_at DESC))[1] AS last_vol,
      COUNT(*) AS sessions_logged
    FROM ex_top GROUP BY client_id, exercise_name HAVING COUNT(*) >= 3
  ),
  perf AS (
    SELECT client_id,
      AVG(public._clamp_score(
        40 + 60 * (
          (LEAST(0.50, GREATEST(-0.20,
              CASE WHEN first_vol > 0 THEN (last_vol - first_vol)/first_vol ELSE 0 END)) + 0.20
          ) / 0.70
        )
      )) AS performance_30d,
      COUNT(*) AS exercises_tracked
    FROM ex_progress GROUP BY client_id
  )
SELECT
  c.client_id,
  COALESCE(w30.started_30d, 0)            AS workouts_started_30d,
  COALESCE(w30.completed_30d, 0)          AS workouts_completed_30d,
  COALESCE(w30.abandoned_30d, 0)          AS workouts_abandoned_30d,
  COALESCE(w30.overreach_30d, 0)          AS overreach_sessions_30d,
  ROUND(COALESCE(w30.avg_intensity_30d, 0)::numeric, 1) AS avg_intensity_30d,
  COALESCE(w7.completed_7d, 0)            AS workouts_completed_7d,
  ROUND(COALESCE(ex_quality.pct_completed_30d, 0)::numeric, 1) AS exercise_completion_pct_30d,
  ROUND(COALESCE(routine.routine_pct_30d, 0)::numeric, 1)      AS routine_adherence_pct_30d,
  ROUND(COALESCE(routine.routine_pct_7d, 0)::numeric, 1)       AS routine_adherence_pct_7d,
  COALESCE(routine.routine_days_30d, 0)                         AS routine_days_logged_30d,
  COALESCE(alt.alt_requests_30d, 0)                             AS alt_requests_30d,
  COALESCE(perf.exercises_tracked, 0)                           AS exercises_tracked_30d,
  ROUND(public._clamp_score(
    0.40 * LEAST(100, COALESCE(w30.completed_30d, 0) * (100.0 / 12))
  + 0.40 * COALESCE(routine.routine_pct_30d, 0)
  + 0.20 * COALESCE(ex_quality.pct_completed_30d, 0)
  ), 1) AS compliance,
  ROUND(public._clamp_score(
    100
    - 10 * COALESCE(w30.overreach_30d, 0)
    - 30 * CASE WHEN COALESCE(w30.started_30d, 0) > 0
                THEN COALESCE(w30.abandoned_30d, 0)::numeric / w30.started_30d ELSE 0 END
    -  5 * COALESCE(alt.alt_requests_30d, 0)
  ), 1) AS recovery,
  ROUND(COALESCE(perf.performance_30d, 50)::numeric, 1) AS performance,
  ROUND(public._clamp_score(
    0.40 * public._clamp_score(
        0.40 * LEAST(100, COALESCE(w30.completed_30d, 0) * (100.0 / 12))
      + 0.40 * COALESCE(routine.routine_pct_30d, 0)
      + 0.20 * COALESCE(ex_quality.pct_completed_30d, 0))
  + 0.30 * public._clamp_score(
        100
        - 10 * COALESCE(w30.overreach_30d, 0)
        - 30 * CASE WHEN COALESCE(w30.started_30d, 0) > 0
                    THEN COALESCE(w30.abandoned_30d, 0)::numeric / w30.started_30d ELSE 0 END
        -  5 * COALESCE(alt.alt_requests_30d, 0))
  + 0.30 * COALESCE(perf.performance_30d, 50)
  ), 1) AS overall,
  ROUND((COALESCE(routine.routine_pct_7d, 0) - COALESCE(routine.routine_pct_30d, 0))::numeric, 1) AS delta_7d_routine,
  '1.1'::text AS formula_version,
  now()        AS generated_at
FROM clients c
LEFT JOIN w30        ON w30.client_id        = c.client_id
LEFT JOIN w7         ON w7.client_id         = c.client_id
LEFT JOIN ex_quality ON ex_quality.client_id = c.client_id
LEFT JOIN routine    ON routine.client_id    = c.client_id
LEFT JOIN alt        ON alt.client_id        = c.client_id
LEFT JOIN perf       ON perf.client_id       = c.client_id;

GRANT SELECT ON v_client_progression TO authenticated;

-- ── Smoke (run after apply) ──────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='exercise_alternative_requests'
--       AND column_name='substitute_exercise_id';
--   SELECT formula_version FROM v_client_progression LIMIT 1;  -- expect '1.1'
