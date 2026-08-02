-- ═══════════════════════════════════════════════════════════════
--  Rollback for 20260806000000_user_delete_fk_rules.sql
--
--  Restores all twenty foreign keys to their original declaration: no ON DELETE
--  clause, which Postgres reads as NO ACTION.
--
--  ⚠ Running this re-breaks account deletion. Every client with a program, a
--  workout log, an assessment, a comment, a phase submission, or a referral
--  becomes undeletable again, and both the coach and admin delete paths return
--  a raw Postgres foreign-key error. Roll back only if the new rules are
--  actively causing harm, not as routine hygiene.
--
--  This rollback cannot restore rows. If a delete ran while the forward
--  migration was in force, CASCADE has already removed the dependent rows and
--  SET NULL has already blanked the attribution columns. Neither is recoverable
--  from here — only from a backup (docs/DATABASE_BACKUP.md).
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.client_referrals drop constraint if exists client_referrals_client_id_fkey;
alter table public.client_referrals
  add constraint client_referrals_client_id_fkey
  foreign key (client_id) references public.profiles(id);

alter table public.phase_submissions drop constraint if exists phase_submissions_client_id_fkey;
alter table public.phase_submissions
  add constraint phase_submissions_client_id_fkey
  foreign key (client_id) references public.profiles(id);

alter table public.case_shares drop constraint if exists case_shares_coach_id_fkey;
alter table public.case_shares
  add constraint case_shares_coach_id_fkey
  foreign key (coach_id) references public.profiles(id);

alter table public.ai_feedback_log drop constraint if exists ai_feedback_log_coach_id_fkey;
alter table public.ai_feedback_log
  add constraint ai_feedback_log_coach_id_fkey
  foreign key (coach_id) references auth.users(id);

alter table public.case_shares drop constraint if exists case_shares_reviewed_by_fkey;
alter table public.case_shares
  add constraint case_shares_reviewed_by_fkey
  foreign key (reviewed_by) references auth.users(id);

alter table public.client_comments drop constraint if exists client_comments_author_id_fkey;
alter table public.client_comments
  add constraint client_comments_author_id_fkey
  foreign key (author_id) references public.profiles(id);

alter table public.client_referrals drop constraint if exists client_referrals_from_coach_id_fkey;
alter table public.client_referrals
  add constraint client_referrals_from_coach_id_fkey
  foreign key (from_coach_id) references public.profiles(id);

alter table public.client_referrals drop constraint if exists client_referrals_to_coach_id_fkey;
alter table public.client_referrals
  add constraint client_referrals_to_coach_id_fkey
  foreign key (to_coach_id) references public.profiles(id);

alter table public.coach_groups drop constraint if exists coach_groups_created_by_fkey;
alter table public.coach_groups
  add constraint coach_groups_created_by_fkey
  foreign key (created_by) references public.profiles(id);

alter table public.exercises drop constraint if exists exercises_created_by_fkey;
alter table public.exercises
  add constraint exercises_created_by_fkey
  foreign key (created_by) references public.profiles(id);

alter table public.programs drop constraint if exists programs_coach_id_fkey;
alter table public.programs
  add constraint programs_coach_id_fkey
  foreign key (coach_id) references public.profiles(id);

alter table public.rpm_graphs drop constraint if exists rpm_graphs_coach_id_fkey;
alter table public.rpm_graphs
  add constraint rpm_graphs_coach_id_fkey
  foreign key (coach_id) references auth.users(id);

alter table public.rpm_phase_messages drop constraint if exists rpm_phase_messages_author_id_fkey;
alter table public.rpm_phase_messages
  add constraint rpm_phase_messages_author_id_fkey
  foreign key (author_id) references auth.users(id);

alter table public.subjective_assessments drop constraint if exists subjective_assessments_coach_id_fkey;
alter table public.subjective_assessments
  add constraint subjective_assessments_coach_id_fkey
  foreign key (coach_id) references auth.users(id);

alter table public.subscriptions drop constraint if exists subscriptions_created_by_fkey;
alter table public.subscriptions
  add constraint subscriptions_created_by_fkey
  foreign key (created_by) references public.profiles(id);

alter table public.progress_snapshots drop constraint if exists progress_snapshots_assessment_id_fkey;
alter table public.progress_snapshots
  add constraint progress_snapshots_assessment_id_fkey
  foreign key (assessment_id) references public.assessments(id);

alter table public.rpm_graphs drop constraint if exists rpm_graphs_objective_id_fkey;
alter table public.rpm_graphs
  add constraint rpm_graphs_objective_id_fkey
  foreign key (objective_id) references public.rehab_objective_assessments(id);

alter table public.rpm_graphs drop constraint if exists rpm_graphs_subjective_id_fkey;
alter table public.rpm_graphs
  add constraint rpm_graphs_subjective_id_fkey
  foreign key (subjective_id) references public.subjective_assessments(id);

alter table public.workout_logs drop constraint if exists workout_logs_program_id_fkey;
alter table public.workout_logs
  add constraint workout_logs_program_id_fkey
  foreign key (program_id) references public.programs(id);

alter table public.workout_logs drop constraint if exists workout_logs_program_exercise_id_fkey;
alter table public.workout_logs
  add constraint workout_logs_program_exercise_id_fkey
  foreign key (program_exercise_id) references public.program_exercises(id);

commit;
