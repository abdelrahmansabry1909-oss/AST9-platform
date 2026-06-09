-- ═══════════════════════════════════════════════════════════════
-- NeuCore — Feature 8 · S1: Recovery Pulse (read-only classifier view)
--
-- v_client_pulse classifies each client's trajectory by REUSING the
-- existing scoring views — it adds NO new scoring math, NO new tables,
-- NO new RLS policy, NO writes, NO cron.
--
--   • Adherence / recovery / momentum  ← v_client_progression  (F4)
--   • Churn fusion                      ← v_client_subscription_state (F1)
--   • Regression trend                  ← progress_snapshots (top-2 by date)
--   • Last-activity recency             ← workout_sessions + daily_routine_logs
--   • Cold-start guard                  ← client_programs.published_at
--
-- security_invoker = true → inherits the caller's RLS on every source
-- (client → own row; coach → assigned clients; admin → all). Same
-- pattern as v_client_progression / v_client_subscription_state.
--
-- Indexes: NONE created. Existing indexes already cover all access
-- paths (verified live before writing): daily_routine_logs(client_id,
-- log_date DESC), workout_sessions(client_id, started_at DESC) +
-- (client_id, status), progress_snapshots(client_id) + (session_date).
--
-- Classifier is deterministic; thresholds are constants below.
-- "new" clients are protected from every alert (severity 0).
--
-- Rollback: supabase/rollbacks/20260609120000_feature8_v_client_pulse_down.sql
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_client_pulse
WITH (security_invoker = true)
AS
WITH
  prog AS (
    SELECT client_id, recovery,
           routine_adherence_pct_7d, routine_adherence_pct_30d,
           workouts_completed_7d, delta_7d_routine
    FROM public.v_client_progression
  ),
  sub AS (
    SELECT client_id, effective_status, grace_days_left
    FROM public.v_client_subscription_state
  ),
  last_workout AS (
    SELECT client_id, MAX(COALESCE(ended_at, started_at)) AS last_at
    FROM public.workout_sessions
    GROUP BY client_id
  ),
  last_routine AS (
    SELECT client_id, MAX(log_date) AS last_date
    FROM public.daily_routine_logs
    GROUP BY client_id
  ),
  snap AS (
    SELECT client_id,
           (array_agg(composite_score ORDER BY session_date DESC))[1] AS composite_latest,
           (array_agg(composite_score ORDER BY session_date DESC))[2] AS composite_prev,
           COUNT(*) AS snap_count
    FROM public.progress_snapshots
    WHERE composite_score IS NOT NULL
    GROUP BY client_id
  ),
  pub AS (
    SELECT client_id, published, published_at
    FROM public.client_programs
  ),
  base AS (
    SELECT
      prog.client_id,
      COALESCE(prog.routine_adherence_pct_7d, 0)  AS adherence_7d,
      COALESCE(prog.routine_adherence_pct_30d, 0) AS adherence_30d,
      prog.recovery,
      COALESCE(prog.workouts_completed_7d, 0)     AS workouts_completed_7d,
      COALESCE(prog.delta_7d_routine, 0)          AS delta_7d_routine,
      snap.composite_latest,
      snap.composite_prev,
      COALESCE(snap.snap_count, 0)                AS snap_count,
      sub.effective_status,
      sub.grace_days_left,
      pub.published,
      pub.published_at,
      GREATEST(lw.last_at, lr.last_date::timestamptz) AS last_activity_at,
      CASE
        WHEN GREATEST(lw.last_at, lr.last_date::timestamptz) IS NULL THEN NULL
        ELSE (CURRENT_DATE - GREATEST(lw.last_at, lr.last_date::timestamptz)::date)
      END AS days_since_activity
    FROM prog
    LEFT JOIN sub          ON sub.client_id          = prog.client_id
    LEFT JOIN last_workout lw ON lw.client_id        = prog.client_id
    LEFT JOIN last_routine lr ON lr.client_id        = prog.client_id
    LEFT JOIN snap         ON snap.client_id         = prog.client_id
    LEFT JOIN pub          ON pub.client_id          = prog.client_id
  ),
  flags AS (
    SELECT base.*,
      -- f_new: protect brand-new / no-history clients from any alarm
      (    published IS NOT TRUE
        OR published_at IS NULL
        OR published_at > (now() - interval '7 days')
        OR (last_activity_at IS NULL AND adherence_30d = 0)
      ) AS f_new,
      -- f_regressing: needs >=2 snapshots; latest composite down >= 5 pts
      (    snap_count >= 2
        AND composite_latest IS NOT NULL
        AND composite_prev   IS NOT NULL
        AND composite_latest <= composite_prev - 5
      ) AS f_regressing,
      -- f_at_risk: low adherence / silent / churn fusion
      (    adherence_7d < 40
        OR workouts_completed_7d = 0
        OR (days_since_activity IS NOT NULL AND days_since_activity >= 14)
        OR (effective_status IN ('grace','expired') AND adherence_7d < 50)
      ) AS f_at_risk,
      -- f_slipping: middling adherence or sharp weekly drop
      (    (adherence_7d >= 40 AND adherence_7d < 70)
        OR delta_7d_routine <= -15
      ) AS f_slipping
    FROM base
  )
SELECT
  client_id,
  CASE
    WHEN f_new        THEN 'new'
    WHEN f_regressing THEN 'regressing'
    WHEN f_at_risk    THEN 'at_risk'
    WHEN f_slipping   THEN 'slipping'
    ELSE 'on_track'
  END AS pulse_status,
  CASE
    WHEN f_new        THEN 0
    WHEN f_regressing THEN 4
    WHEN f_at_risk    THEN 3
    WHEN f_slipping   THEN 2
    ELSE 1
  END AS severity,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT f_new AND f_regressing
         THEN 'Recovery composite down ' || ROUND((composite_prev - composite_latest))::text || ' pts' END,
    CASE WHEN NOT f_new AND workouts_completed_7d = 0
         THEN 'No completed workout in 7 days' END,
    CASE WHEN NOT f_new AND days_since_activity IS NOT NULL AND days_since_activity >= 14
         THEN 'No activity in ' || days_since_activity::text || ' days' END,
    CASE WHEN NOT f_new AND adherence_7d < 40
         THEN 'Adherence ' || ROUND(adherence_7d)::text || '% this week' END,
    CASE WHEN NOT f_new AND effective_status IN ('grace','expired')
         THEN 'Subscription ' || effective_status END,
    CASE WHEN NOT f_new AND delta_7d_routine <= -15
         THEN 'Adherence trending down' END
  ], NULL) AS reasons,
  adherence_7d,
  adherence_30d,
  recovery,
  workouts_completed_7d,
  delta_7d_routine,
  CASE WHEN delta_7d_routine >=  5 THEN 'up'
       WHEN delta_7d_routine <= -5 THEN 'down'
       ELSE 'flat' END AS momentum,
  composite_latest,
  composite_prev,
  CASE WHEN composite_prev IS NOT NULL
       THEN ROUND((composite_latest - composite_prev), 1)
       ELSE NULL END AS composite_trend,
  last_activity_at,
  days_since_activity,
  effective_status,
  grace_days_left,
  (effective_status IN ('grace','expired') AND adherence_7d < 50) AS churn_risk,
  published_at AS program_published_at,
  now() AS generated_at
FROM flags;

COMMENT ON VIEW public.v_client_pulse IS
  'Feature 8 S1. Read-only trajectory classifier per client. Reuses '
  'v_client_progression + v_client_subscription_state + progress_snapshots '
  '(+ recency from workout_sessions/daily_routine_logs). security_invoker '
  'so RLS auto-scopes (client=self, coach=assigned, admin=all). No writes, '
  'no new scoring math, no cron. pulse_status: new|on_track|slipping|'
  'at_risk|regressing (severity 0..4). "new" clients never alert.';

GRANT SELECT ON public.v_client_pulse TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (run manually; also kept as a paired file under
-- supabase/rollbacks/):
--   DROP VIEW IF EXISTS public.v_client_pulse;
-- ═══════════════════════════════════════════════════════════════
