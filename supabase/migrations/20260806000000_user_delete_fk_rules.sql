-- ═══════════════════════════════════════════════════════════════
--  20260806000000_user_delete_fk_rules.sql
--
--  Make account deletion possible at all.
--
--  `profiles.id` references `auth.users(id) ON DELETE CASCADE`, so
--  `auth.admin.deleteUser()` cascades into `profiles` and outward from there.
--  Twenty foreign keys in this database were declared with no ON DELETE clause,
--  which Postgres defaults to NO ACTION — a hard block, not a no-op.
--
--  Consequence before this migration: deleting a client raised a foreign-key
--  violation for anyone who had a program, a workout log, an assessment, a
--  community comment, a phase submission, or a referral. In other words, every
--  client who had actually used the application. The edge function surfaced the
--  raw Postgres error to the coach as a 400. Deleting a coach failed the same
--  way. This affected the admin delete path that has been shipped for weeks, not
--  only the coach delete added on 2026-08-02.
--
--  Five of the twenty are transitive: they do not reference a user at all, but
--  sit one level down a cascade chain that a user delete triggers
--  (assessments → progress_snapshots, programs → workout_logs, and so on).
--  Fixing only the user-facing constraints would have moved the failure rather
--  than removing it.
--
--  Rule chosen per constraint from what the row means, not mechanically:
--
--    CASCADE  — the row is *about* the deleted account and is meaningless
--               without it, or is that account's own private content.
--    SET NULL — the row is a historical record owned by someone else and this
--               column is only attribution. Losing the name must not lose the
--               record. Every column set to NULL here is already nullable, so
--               no NOT NULL constraint is weakened and no data is invented.
--
--  Deliberately preserved by the SET NULL choices:
--    · Workout history survives deletion of its program (the snapshot-safe
--      design in client_program_versions depends on this).
--    · A client's programs and assessments survive deletion of their coach.
--    · Community threads stay readable after an author is deleted; the
--      `author_role` text column still shows who was speaking.
--    · Progress score time-series survive deletion of a single assessment.
--
--  Not changed: `workout_logs.client_id` (NOT NULL, already CASCADE) and every
--  other constraint that already declared a rule. This migration only fills in
--  the twenty that declared none.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── CASCADE: the row cannot outlive the account it describes ──────────────

alter table public.client_referrals drop constraint if exists client_referrals_client_id_fkey;
alter table public.client_referrals
  add constraint client_referrals_client_id_fkey
  foreign key (client_id) references public.profiles(id) on delete cascade;

alter table public.phase_submissions drop constraint if exists phase_submissions_client_id_fkey;
alter table public.phase_submissions
  add constraint phase_submissions_client_id_fkey
  foreign key (client_id) references public.profiles(id) on delete cascade;

-- A shared case is the coach's own submission, including its anonymized_data
-- payload. Retaining it after the account is deleted is a privacy liability.
alter table public.case_shares drop constraint if exists case_shares_coach_id_fkey;
alter table public.case_shares
  add constraint case_shares_coach_id_fkey
  foreign key (coach_id) references public.profiles(id) on delete cascade;

-- Holds original_text / modified_text of the coach's own edits — personal
-- clinical authoring history, purged with the account.
alter table public.ai_feedback_log drop constraint if exists ai_feedback_log_coach_id_fkey;
alter table public.ai_feedback_log
  add constraint ai_feedback_log_coach_id_fkey
  foreign key (coach_id) references auth.users(id) on delete cascade;

-- ── SET NULL: keep the record, drop the attribution ───────────────────────

alter table public.case_shares drop constraint if exists case_shares_reviewed_by_fkey;
alter table public.case_shares
  add constraint case_shares_reviewed_by_fkey
  foreign key (reviewed_by) references auth.users(id) on delete set null;

alter table public.client_comments drop constraint if exists client_comments_author_id_fkey;
alter table public.client_comments
  add constraint client_comments_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;

-- The referral is still meaningful to the other coach and to the client.
alter table public.client_referrals drop constraint if exists client_referrals_from_coach_id_fkey;
alter table public.client_referrals
  add constraint client_referrals_from_coach_id_fkey
  foreign key (from_coach_id) references public.profiles(id) on delete set null;

alter table public.client_referrals drop constraint if exists client_referrals_to_coach_id_fkey;
alter table public.client_referrals
  add constraint client_referrals_to_coach_id_fkey
  foreign key (to_coach_id) references public.profiles(id) on delete set null;

alter table public.coach_groups drop constraint if exists coach_groups_created_by_fkey;
alter table public.coach_groups
  add constraint coach_groups_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- NOT cascade. Exercises are referenced by workout_exercise_logs and program
-- rows; deleting a coach must not erase the exercise a client's history points
-- at. `is_global` remains NOT NULL and false on these rows, so a coach-authored
-- orphan is still distinguishable from a system-library exercise.
alter table public.exercises drop constraint if exists exercises_created_by_fkey;
alter table public.exercises
  add constraint exercises_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- NOT cascade. programs.client_id is already ON DELETE CASCADE, so a program
-- dies with its client — but it must survive its coach, or reassigning a client
-- to a new coach would destroy their plan.
alter table public.programs drop constraint if exists programs_coach_id_fkey;
alter table public.programs
  add constraint programs_coach_id_fkey
  foreign key (coach_id) references public.profiles(id) on delete set null;

-- rpm_graphs.client_id is already ON DELETE CASCADE; the graph belongs to the
-- client, not to whichever coach authored it.
alter table public.rpm_graphs drop constraint if exists rpm_graphs_coach_id_fkey;
alter table public.rpm_graphs
  add constraint rpm_graphs_coach_id_fkey
  foreign key (coach_id) references auth.users(id) on delete set null;

alter table public.rpm_phase_messages drop constraint if exists rpm_phase_messages_author_id_fkey;
alter table public.rpm_phase_messages
  add constraint rpm_phase_messages_author_id_fkey
  foreign key (author_id) references auth.users(id) on delete set null;

-- The assessment is the client's clinical record; the coach is attribution.
alter table public.subjective_assessments drop constraint if exists subjective_assessments_coach_id_fkey;
alter table public.subjective_assessments
  add constraint subjective_assessments_coach_id_fkey
  foreign key (coach_id) references auth.users(id) on delete set null;

-- Billing history must outlive whoever entered it.
alter table public.subscriptions drop constraint if exists subscriptions_created_by_fkey;
alter table public.subscriptions
  add constraint subscriptions_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- ── SET NULL: transitive blockers on the cascade path ─────────────────────
--  These reference no user. They blocked the delete one level down, when the
--  cascade from profiles reached assessments, programs, or program_exercises.

-- Keeps the client's score time-series when a single assessment is removed.
alter table public.progress_snapshots drop constraint if exists progress_snapshots_assessment_id_fkey;
alter table public.progress_snapshots
  add constraint progress_snapshots_assessment_id_fkey
  foreign key (assessment_id) references public.assessments(id) on delete set null;

alter table public.rpm_graphs drop constraint if exists rpm_graphs_objective_id_fkey;
alter table public.rpm_graphs
  add constraint rpm_graphs_objective_id_fkey
  foreign key (objective_id) references public.rehab_objective_assessments(id) on delete set null;

alter table public.rpm_graphs drop constraint if exists rpm_graphs_subjective_id_fkey;
alter table public.rpm_graphs
  add constraint rpm_graphs_subjective_id_fkey
  foreign key (subjective_id) references public.subjective_assessments(id) on delete set null;

-- What the client actually did survives the plan that prescribed it.
alter table public.workout_logs drop constraint if exists workout_logs_program_id_fkey;
alter table public.workout_logs
  add constraint workout_logs_program_id_fkey
  foreign key (program_id) references public.programs(id) on delete set null;

alter table public.workout_logs drop constraint if exists workout_logs_program_exercise_id_fkey;
alter table public.workout_logs
  add constraint workout_logs_program_exercise_id_fkey
  foreign key (program_exercise_id) references public.program_exercises(id) on delete set null;

commit;
