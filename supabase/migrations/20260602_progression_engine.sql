-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Progression Engine v1 (Feature 4)
-- LIVE-APPLIED VERSION — adapted for the actual daily_routine_logs
-- schema present in production (battery_pct + completed boolean,
-- NOT the percent/total_tasks shape from 20260521_daily_routine.sql).
--
-- routine_pct uses battery_pct when present, else 100 if completed
-- else 0. This keeps the routine signal working regardless of which
-- version of daily_routine_logs the project has.
--
-- Live verified: applied 2026-05-30 via MCP. View returns scores
-- for all clients; smoke-tested with a completed workout — overall
-- shifted from 45.0 → 52.8 exactly per formula.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._clamp_score(v numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT GREATEST(0::numeric, LEAST(100::numeric, COALESCE(v, 0)));
$$;

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
  alt AS (
    SELECT c.client_id,
      COUNT(a.*) FILTER (WHERE a.created_at::date >= w.w30_start) AS alt_requests_30d
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
  '1.0'::text AS formula_version,
  now()        AS generated_at
FROM clients c
LEFT JOIN w30        ON w30.client_id        = c.client_id
LEFT JOIN w7         ON w7.client_id         = c.client_id
LEFT JOIN ex_quality ON ex_quality.client_id = c.client_id
LEFT JOIN routine    ON routine.client_id    = c.client_id
LEFT JOIN alt        ON alt.client_id        = c.client_id
LEFT JOIN perf       ON perf.client_id       = c.client_id;

GRANT SELECT ON v_client_progression TO authenticated;
