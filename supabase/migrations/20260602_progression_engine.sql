-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Progression Engine v1
-- Run in Supabase SQL Editor (idempotent).
--
-- Aggregates signals from:
--   workout_sessions          — Feature 2
--   workout_exercise_logs     — Feature 2
--   daily_routine_logs        — existing
--   exercise_alternative_requests — Feature 3 (friction signal)
--
-- Produces four scores per client (0–100):
--   compliance, recovery, performance, overall
-- Plus 7-day deltas and raw signal counts (for coach drill-down).
--
-- Window is a rolling 30 days. Reweighting the formula is a deliberate
-- migration step (next version: 20260xxx_progression_v2.sql) — client-
-- visible numbers must not drift silently.
--
-- View uses security_invoker=true so existing RLS on the source tables
-- governs who sees which rows.
--
-- Depends on:
--   public.is_admin()             — 20260515_rpm_foundation.sql
--   workout_sessions/logs         — 20260531_workout_tracking.sql
--   daily_routine_logs            — 20260521_daily_routine.sql
--   exercise_alternative_requests — 20260601_notifications_inbox.sql
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Helper: clamp 0..100 ──────────────────────────────────
CREATE OR REPLACE FUNCTION public._clamp_score(v numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(0::numeric, LEAST(100::numeric, COALESCE(v, 0)));
$$;

-- ── 2. View: v_client_progression ────────────────────────────
-- Window constants kept inline (SQL CTEs) for clarity. If formulas
-- change, ship a v2 view alongside this one and migrate UI by hand.
DROP VIEW IF EXISTS v_client_progression CASCADE;
CREATE VIEW v_client_progression
WITH (security_invoker = true)
AS
WITH
  -- ── Window edges
  win AS (
    SELECT (current_date - 29)::date AS w30_start,
           (current_date -  6)::date AS w7_start,
           current_date              AS today
  ),

  -- ── All clients
  clients AS (
    SELECT id AS client_id FROM profiles WHERE role = 'client'
  ),

  -- ── 30-day workout signals per client
  w30 AS (
    SELECT
      c.client_id,
      COUNT(s.*) FILTER (WHERE s.started_at::date >= w.w30_start)                              AS started_30d,
      COUNT(s.*) FILTER (WHERE s.status = 'completed' AND s.ended_at::date >= w.w30_start)     AS completed_30d,
      COUNT(s.*) FILTER (WHERE s.status = 'abandoned' AND s.started_at::date >= w.w30_start)   AS abandoned_30d,
      AVG(s.intensity_rating) FILTER (WHERE s.status='completed' AND s.ended_at::date >= w.w30_start)  AS avg_intensity_30d,
      COUNT(s.*) FILTER (WHERE s.status='completed' AND s.intensity_rating >= 9
                          AND s.ended_at::date >= w.w30_start)                                  AS overreach_30d
    FROM clients c
    CROSS JOIN win w
    LEFT JOIN workout_sessions s ON s.client_id = c.client_id
    GROUP BY c.client_id, w.w30_start
  ),

  -- ── 7-day workout signals (for delta)
  w7 AS (
    SELECT
      c.client_id,
      COUNT(s.*) FILTER (WHERE s.status='completed' AND s.ended_at::date >= w.w7_start) AS completed_7d
    FROM clients c
    CROSS JOIN win w
    LEFT JOIN workout_sessions s ON s.client_id = c.client_id
    GROUP BY c.client_id, w.w7_start
  ),

  -- ── Session exercise completion quality (30d)
  ex_quality AS (
    SELECT
      s.client_id,
      AVG(CASE WHEN cnt.total > 0 THEN cnt.done::numeric / cnt.total * 100 ELSE NULL END) AS pct_completed_30d
    FROM workout_sessions s
    CROSS JOIN win w
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)                                  AS total,
        COUNT(*) FILTER (WHERE completed = true)  AS done
      FROM workout_exercise_logs l WHERE l.session_id = s.id
    ) cnt ON true
    WHERE s.status = 'completed' AND s.ended_at::date >= w.w30_start
    GROUP BY s.client_id
  ),

  -- ── Daily routine adherence (30d + 7d)
  routine AS (
    SELECT
      c.client_id,
      AVG(dr.percent) FILTER (WHERE dr.log_date >= w.w30_start) AS routine_pct_30d,
      AVG(dr.percent) FILTER (WHERE dr.log_date >= w.w7_start)  AS routine_pct_7d,
      COUNT(*)        FILTER (WHERE dr.log_date >= w.w30_start) AS routine_days_30d
    FROM clients c
    CROSS JOIN win w
    LEFT JOIN daily_routine_logs dr ON dr.client_id = c.client_id
    GROUP BY c.client_id, w.w30_start, w.w7_start
  ),

  -- ── Alt-request frequency (friction signal, 30d)
  alt AS (
    SELECT
      c.client_id,
      COUNT(a.*) FILTER (WHERE a.created_at::date >= w.w30_start) AS alt_requests_30d
    FROM clients c
    CROSS JOIN win w
    LEFT JOIN exercise_alternative_requests a ON a.client_id = c.client_id
    GROUP BY c.client_id, w.w30_start
  ),

  -- ── Performance: per-exercise top-set volume in window
  -- For each (client, exercise_name) compute first vs latest top-set
  -- volume (max set's reps*weight). Only consider exercises with ≥3
  -- logged sessions in the window so noise is bounded.
  ex_top AS (
    SELECT
      s.client_id,
      l.exercise_name,
      s.ended_at,
      MAX(COALESCE((set_elem->>'reps')::numeric, 0)
        * COALESCE((set_elem->>'weight')::numeric, 0)) AS top_vol
    FROM workout_sessions s
    JOIN workout_exercise_logs l ON l.session_id = s.id
    CROSS JOIN win w
    LEFT JOIN LATERAL jsonb_array_elements(l.sets) set_elem ON true
    WHERE s.status = 'completed'
      AND s.ended_at::date >= w.w30_start
      AND l.sets IS NOT NULL
      AND jsonb_array_length(l.sets) > 0
    GROUP BY s.client_id, l.exercise_name, s.ended_at
  ),
  ex_progress AS (
    SELECT
      client_id,
      exercise_name,
      MIN(top_vol) FILTER (WHERE top_vol > 0)                                            AS first_vol,
      (array_agg(top_vol ORDER BY ended_at DESC))[1]                                     AS last_vol,
      COUNT(*)                                                                            AS sessions_logged
    FROM ex_top
    GROUP BY client_id, exercise_name
    HAVING COUNT(*) >= 3
  ),
  perf AS (
    SELECT
      client_id,
      -- Per-exercise: % change vs first; clamp -20%↔+50% then map to 40↔100
      AVG(
        public._clamp_score(
          40 + 60 * (
            (LEAST(0.50, GREATEST(-0.20,
                CASE WHEN first_vol > 0
                     THEN (last_vol - first_vol) / first_vol
                     ELSE 0 END)) + 0.20
            ) / 0.70
          )
        )
      ) AS performance_30d,
      COUNT(*) AS exercises_tracked
    FROM ex_progress
    GROUP BY client_id
  )

SELECT
  c.client_id,

  -- ── Raw signals (for coach drill-down)
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

  -- ── Compliance: 0.4·completion + 0.4·routine + 0.2·session quality
  --     completion rate caps at "5 workouts/week → 22 in 30d = 100%".
  --     We use min(completed/12, 1)*100 as a forgiving baseline target
  --     of ~3 workouts/week, raise later if needed.
  ROUND(public._clamp_score(
    0.40 * LEAST(100, COALESCE(w30.completed_30d, 0) * (100.0 / 12))
  + 0.40 * COALESCE(routine.routine_pct_30d, 0)
  + 0.20 * COALESCE(ex_quality.pct_completed_30d, 0)
  ), 1) AS compliance,

  -- ── Recovery: 100 baseline, deductions for overreach + abandonment + friction
  --     abandonment rate = abandoned / (started or 1)
  ROUND(public._clamp_score(
    100
    - 10 * COALESCE(w30.overreach_30d, 0)
    - 30 * CASE WHEN COALESCE(w30.started_30d, 0) > 0
                THEN COALESCE(w30.abandoned_30d, 0)::numeric / w30.started_30d
                ELSE 0 END
    -  5 * COALESCE(alt.alt_requests_30d, 0)
  ), 1) AS recovery,

  -- ── Performance: 50 neutral when no qualifying data
  ROUND(COALESCE(perf.performance_30d, 50)::numeric, 1) AS performance,

  -- ── Overall: 0.4·compliance + 0.3·recovery + 0.3·performance
  ROUND(public._clamp_score(
    0.40 * public._clamp_score(
        0.40 * LEAST(100, COALESCE(w30.completed_30d, 0) * (100.0 / 12))
      + 0.40 * COALESCE(routine.routine_pct_30d, 0)
      + 0.20 * COALESCE(ex_quality.pct_completed_30d, 0))
  + 0.30 * public._clamp_score(
        100
        - 10 * COALESCE(w30.overreach_30d, 0)
        - 30 * CASE WHEN COALESCE(w30.started_30d, 0) > 0
                    THEN COALESCE(w30.abandoned_30d, 0)::numeric / w30.started_30d
                    ELSE 0 END
        -  5 * COALESCE(alt.alt_requests_30d, 0))
  + 0.30 * COALESCE(perf.performance_30d, 50)
  ), 1) AS overall,

  -- ── 7-day delta on routine (the cleanest weekly trend signal)
  ROUND(
    (COALESCE(routine.routine_pct_7d, 0) - COALESCE(routine.routine_pct_30d, 0))::numeric,
    1
  ) AS delta_7d_routine,

  -- ── Bookkeeping
  '1.0'::text AS formula_version,
  now()        AS generated_at

FROM clients c
LEFT JOIN w30        ON w30.client_id        = c.client_id
LEFT JOIN w7         ON w7.client_id         = c.client_id
LEFT JOIN ex_quality ON ex_quality.client_id = c.client_id
LEFT JOIN routine    ON routine.client_id    = c.client_id
LEFT JOIN alt        ON alt.client_id        = c.client_id
LEFT JOIN perf       ON perf.client_id       = c.client_id;

COMMENT ON VIEW v_client_progression IS
  'NeuCore Progression Engine v1.0. Four scores (compliance, recovery, '
  'performance, overall) over a rolling 30-day window. Reweighting must '
  'be a new view + migration — never edit this one in place.';

GRANT SELECT ON v_client_progression TO authenticated;

-- ── 3. Smoke tests ───────────────────────────────────────────
--   SELECT * FROM v_client_progression LIMIT 5;
--   SELECT overall, compliance, recovery, performance
--     FROM v_client_progression WHERE client_id = auth.uid();
