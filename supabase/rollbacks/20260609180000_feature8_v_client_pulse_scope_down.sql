-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK for 20260609180000_feature8_v_client_pulse_scope.sql
-- Restores v_client_pulse to its prior (un-scoped) definition — i.e.
-- removes the assigned-coach WHERE clause. Coach visibility reverts to
-- "all clients" via the global profiles policy (the pre-fix behavior).
-- Identical body otherwise; security_invoker preserved.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_client_pulse
WITH (security_invoker = true) AS
 WITH prog AS (
         SELECT v_client_progression.client_id,
            v_client_progression.recovery,
            v_client_progression.routine_adherence_pct_7d,
            v_client_progression.routine_adherence_pct_30d,
            v_client_progression.workouts_completed_7d,
            v_client_progression.delta_7d_routine
           FROM v_client_progression
        ), sub AS (
         SELECT v_client_subscription_state.client_id,
            v_client_subscription_state.effective_status,
            v_client_subscription_state.grace_days_left
           FROM v_client_subscription_state
        ), last_workout AS (
         SELECT workout_sessions.client_id,
            max(COALESCE(workout_sessions.ended_at, workout_sessions.started_at)) AS last_at
           FROM workout_sessions
          GROUP BY workout_sessions.client_id
        ), last_routine AS (
         SELECT daily_routine_logs.client_id,
            max(daily_routine_logs.log_date) AS last_date
           FROM daily_routine_logs
          GROUP BY daily_routine_logs.client_id
        ), snap AS (
         SELECT progress_snapshots.client_id,
            (array_agg(progress_snapshots.composite_score ORDER BY progress_snapshots.session_date DESC))[1] AS composite_latest,
            (array_agg(progress_snapshots.composite_score ORDER BY progress_snapshots.session_date DESC))[2] AS composite_prev,
            count(*) AS snap_count
           FROM progress_snapshots
          WHERE progress_snapshots.composite_score IS NOT NULL
          GROUP BY progress_snapshots.client_id
        ), pub AS (
         SELECT client_programs.client_id,
            client_programs.published,
            client_programs.published_at
           FROM client_programs
        ), base AS (
         SELECT prog.client_id,
            COALESCE(prog.routine_adherence_pct_7d, 0::numeric) AS adherence_7d,
            COALESCE(prog.routine_adherence_pct_30d, 0::numeric) AS adherence_30d,
            prog.recovery,
            COALESCE(prog.workouts_completed_7d, 0::bigint) AS workouts_completed_7d,
            COALESCE(prog.delta_7d_routine, 0::numeric) AS delta_7d_routine,
            snap.composite_latest,
            snap.composite_prev,
            COALESCE(snap.snap_count, 0::bigint) AS snap_count,
            sub.effective_status,
            sub.grace_days_left,
            pub.published,
            pub.published_at,
            GREATEST(lw.last_at, lr.last_date::timestamp with time zone) AS last_activity_at,
                CASE
                    WHEN GREATEST(lw.last_at, lr.last_date::timestamp with time zone) IS NULL THEN NULL::integer
                    ELSE CURRENT_DATE - GREATEST(lw.last_at, lr.last_date::timestamp with time zone)::date
                END AS days_since_activity
           FROM prog
             LEFT JOIN sub ON sub.client_id = prog.client_id
             LEFT JOIN last_workout lw ON lw.client_id = prog.client_id
             LEFT JOIN last_routine lr ON lr.client_id = prog.client_id
             LEFT JOIN snap ON snap.client_id = prog.client_id
             LEFT JOIN pub ON pub.client_id = prog.client_id
        ), flags AS (
         SELECT base.client_id,
            base.adherence_7d,
            base.adherence_30d,
            base.recovery,
            base.workouts_completed_7d,
            base.delta_7d_routine,
            base.composite_latest,
            base.composite_prev,
            base.snap_count,
            base.effective_status,
            base.grace_days_left,
            base.published,
            base.published_at,
            base.last_activity_at,
            base.days_since_activity,
            base.published IS NOT TRUE OR base.published_at IS NULL OR base.published_at > (now() - '7 days'::interval) OR base.last_activity_at IS NULL AND base.adherence_30d = 0::numeric AS f_new,
            base.snap_count >= 2 AND base.composite_latest IS NOT NULL AND base.composite_prev IS NOT NULL AND base.composite_latest <= (base.composite_prev - 5::numeric) AS f_regressing,
            base.adherence_7d < 40::numeric OR base.workouts_completed_7d = 0 OR base.days_since_activity IS NOT NULL AND base.days_since_activity >= 14 OR (base.effective_status = ANY (ARRAY['grace'::text, 'expired'::text])) AND base.adherence_7d < 50::numeric AS f_at_risk,
            base.adherence_7d >= 40::numeric AND base.adherence_7d < 70::numeric OR base.delta_7d_routine <= '-15'::integer::numeric AS f_slipping
           FROM base
        )
 SELECT client_id,
        CASE
            WHEN f_new THEN 'new'::text
            WHEN f_regressing THEN 'regressing'::text
            WHEN f_at_risk THEN 'at_risk'::text
            WHEN f_slipping THEN 'slipping'::text
            ELSE 'on_track'::text
        END AS pulse_status,
        CASE
            WHEN f_new THEN 0
            WHEN f_regressing THEN 4
            WHEN f_at_risk THEN 3
            WHEN f_slipping THEN 2
            ELSE 1
        END AS severity,
    array_remove(ARRAY[
        CASE
            WHEN NOT f_new AND f_regressing THEN ('Recovery composite down '::text || round(composite_prev - composite_latest)::text) || ' pts'::text
            ELSE NULL::text
        END,
        CASE
            WHEN NOT f_new AND workouts_completed_7d = 0 THEN 'No completed workout in 7 days'::text
            ELSE NULL::text
        END,
        CASE
            WHEN NOT f_new AND days_since_activity IS NOT NULL AND days_since_activity >= 14 THEN ('No activity in '::text || days_since_activity::text) || ' days'::text
            ELSE NULL::text
        END,
        CASE
            WHEN NOT f_new AND adherence_7d < 40::numeric THEN ('Adherence '::text || round(adherence_7d)::text) || '% this week'::text
            ELSE NULL::text
        END,
        CASE
            WHEN NOT f_new AND (effective_status = ANY (ARRAY['grace'::text, 'expired'::text])) THEN 'Subscription '::text || effective_status
            ELSE NULL::text
        END,
        CASE
            WHEN NOT f_new AND delta_7d_routine <= '-15'::integer::numeric THEN 'Adherence trending down'::text
            ELSE NULL::text
        END], NULL::text) AS reasons,
    adherence_7d,
    adherence_30d,
    recovery,
    workouts_completed_7d,
    delta_7d_routine,
        CASE
            WHEN delta_7d_routine >= 5::numeric THEN 'up'::text
            WHEN delta_7d_routine <= '-5'::integer::numeric THEN 'down'::text
            ELSE 'flat'::text
        END AS momentum,
    composite_latest,
    composite_prev,
        CASE
            WHEN composite_prev IS NOT NULL THEN round(composite_latest - composite_prev, 1)
            ELSE NULL::numeric
        END AS composite_trend,
    last_activity_at,
    days_since_activity,
    effective_status,
    grace_days_left,
    (effective_status = ANY (ARRAY['grace'::text, 'expired'::text])) AND adherence_7d < 50::numeric AS churn_risk,
    published_at AS program_published_at,
    now() AS generated_at
   FROM flags;

GRANT SELECT ON public.v_client_pulse TO authenticated;
