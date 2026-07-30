# Migration Rollback Inventory

## Summary

The repository contains **66** forward migrations. By the
`<version>_<name>.sql` / `<version>_<name>_down.sql` naming convention,
**31 are paired** and **35 lack a paired down-file**.

Rollback files are split across two directories:
`supabase/rollbacks/` contains **17** files, and
`supabase/migrations/rollbacks/` contains **14** files. There are **0 orphan**
rollback files and **0 duplicate** rollback files across the two directories.

> **Keeping this current is manual.** Nothing enforces it, and it drifted within
> hours of being written: `20260730000000` shipped in PR #141 without an entry
> here. If you add a migration, add its row below in the same commit.
The directory ranges interleave, so the split follows no rule; the inventory
must be consulted for the location of a specific rollback.

**How to use this:** Before assuming a rollback exists, find the forward
migration below. `irreversible-by-design` means an incident must use
restore-from-backup or a forward fix, not a down migration.

The three unpaired migrations
`20260727000000_auth_user_trigger`,
`20260727000100_legal_documents_reference_data`, and
`20260728000000_rpc_execute_acl_hardening` are the same three that
[ISSUE_LOG.md](ISSUE_LOG.md) issue #18 records as verified no-ops against
current production. This is a cross-reference to that finding, not a new
verification.

## Inventory

| Forward migration | Status | Rollback location | Notes |
|---|---|---|---|
| `20260505124526_add_departments_and_admins.sql` | irreversible-by-design | — | Registry marker whose executable body is only `SELECT 1`; there is no repository-defined change to reverse. |
| `20260505124551_add_assessments_tables.sql` | irreversible-by-design | — | Registry marker whose executable body is only `SELECT 1`; there is no repository-defined change to reverse. |
| `20260505124620_add_body_map_gait_program_tables.sql` | irreversible-by-design | — | Registry marker whose executable body is only `SELECT 1`; there is no repository-defined change to reverse. |
| `20260505124642_add_coach_community_tables.sql` | irreversible-by-design | — | Registry marker whose executable body is only `SELECT 1`; there is no repository-defined change to reverse. |
| `20260505124706_add_client_community_tables.sql` | irreversible-by-design | — | Registry marker whose executable body is only `SELECT 1`; there is no repository-defined change to reverse. |
| `20260505124722_alter_programs_add_missing_columns.sql` | irreversible-by-design | — | Registry marker whose executable body is only `SELECT 1`; there is no repository-defined change to reverse. |
| `20260506064504_fix_rls_coach_progress_and_feed.sql` | irreversible-by-design | — | Registry marker whose executable body is only `SELECT 1`; there is no repository-defined change to reverse. |
| `20260506065524_security_and_performance_hardening.sql` | irreversible-by-design | — | Registry marker whose executable body is only `SELECT 1`; there is no repository-defined change to reverse. |
| `20260506065726_revoke_public_execute_on_internal_functions.sql` | irreversible-by-design | — | Registry marker whose executable body is only `SELECT 1`; there is no repository-defined change to reverse. |
| `20260506071204_fix_client_groups_write_policy.sql` | irreversible-by-design | — | Registry marker whose executable body is only `SELECT 1`; there is no repository-defined change to reverse. |
| `20260515000000_rpm_foundation.sql` | unpaired | — | A down migration would remove the RPM triggers/functions/indexes, the `programs.rpm_graph_id` column, and seven new tables in dependency order. |
| `20260516000000_rpm_phase5.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260521000000_daily_routine.sql` | unpaired | — | A down migration would remove the daily-routine policies, index, and `daily_routine_logs` table. |
| `20260521142823_case_study_approval.sql` | irreversible-by-design | — | It grandfathered all pre-existing case shares to `approved`; their prior per-row state cannot be reconstructed. |
| `20260521144757_case_study_approval_grants.sql` | unpaired | — | A down migration would revoke the added `anon`/`authenticated` helper-function grants. |
| `20260522000000_client_program_publish.sql` | unpaired | — | A down migration would remove the policies, indexes, and new `client_programs` and `client_routines` tables. |
| `20260530202156_drop_legacy_notifications.sql` | irreversible-by-design | — | Drops the legacy `notifications` table with `CASCADE`; DDL cannot restore the dropped object or any data. |
| `20260530202308_subscription_grace.sql` | unpaired | — | A down migration would drop the reactivation RPC and grace column and restore the prior subscription-state view. |
| `20260530202413_workout_tracking.sql` | unpaired | — | A down migration would remove the workout trigger/function, policies, indexes, and two tracking tables. |
| `20260530202555_notifications_inbox.sql` | unpaired | — | A down migration would remove notification triggers/functions, policies, indexes, and the two new inbox/request tables. |
| `20260530203052_progression_engine.sql` | unpaired | — | A down migration would revoke access and remove or restore the progression view and clamp helper. |
| `20260530203157_notification_guards_and_phase_upgrade.sql` | irreversible-by-design | — | Reversing the guarded trigger bodies would restore known FK failures that can roll back parent writes. |
| `20260530204349_advisor_hardening.sql` | irreversible-by-design | — | Reversal would remove fixed search paths and restore broad API-role execution on internal/trigger functions. |
| `20260531123907_alt_exercise_substitute.sql` | unpaired | — | A down migration would restore the prior trigger/view definitions and remove the substitute index and column. |
| `20260531162107_sessions_rls_tighten.sql` | irreversible-by-design | — | Reversing the RLS replacements would restore cross-coach reads and unchecked coach attribution. |
| `20260531173330_profiles_assigned_coach_index.sql` | irreversible-by-design | — | This idempotently repeats the index already created by the preceding migration; dropping it would undo that earlier migration, not this no-op. |
| `20260531191256_profiles_protect_privileged_columns.sql` | irreversible-by-design | — | Reversal would reopen self-escalation of role and unauthorized coach/phase changes. |
| `20260531192053_set_client_phase_rpc.sql` | unpaired | — | A down migration would revoke and drop the guarded `set_client_phase` RPC. |
| `20260531192602_rls_unify_legacy_tables_assigned_coach.sql` | irreversible-by-design | — | Reversal would restore role-only cross-coach clinical-data access and direct coach subscription writes. |
| `20260601020316_harden_revoke_execute_profile_guard_trigger_fn.sql` | irreversible-by-design | — | Reversal would expose an internal trigger function through API execution grants. |
| `20260603152638_handle_new_user_force_client_role.sql` | irreversible-by-design | — | Reversal would again trust signup metadata for role assignment and reopen self-registration as admin. |
| `20260604063902_cron_subscription_checker_vault_secret_header.sql` | irreversible-by-design | — | Reversal would remove the Vault-backed authentication header and return the scheduled call to its known failing/unauthenticated form. |
| `20260604064909_verify_cron_secret_rpc_vault.sql` | irreversible-by-design | — | Reversal would remove the service-role-only Vault comparison and restore dual-secret drift in cron authentication. |
| `20260609125012_feature8_v_client_pulse.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260609180000_feature8_v_client_pulse_scope.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260611063848_option_a_profiles_select_scoped.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260611195947_s4_pulse_alerts_foundation.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260611201924_s4_pulse_alerts_cron.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260614000000_coach_packages_foundation.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260614010000_coach_packages_harden.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260614020000_coach_signup_onboarding.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260614030000_coach_exercise_library.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260614040000_community_privacy_realtime.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260615000000_program_modes.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260616000000_appointments_v1.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260616010000_admin_coach_business_overview.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260616020000_coach_business_profile.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260619000000_system_exercise_library.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260624000000_client_program_versions.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260625000000_athletic_assessment_foundation.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260625010000_athletic_assessment_index_rls_fix.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260625020000_athletic_movement_observations.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260625030000_athletic_client_write_rls_hardening.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260627000000_legal_acceptance_foundation.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260629000000_program_versioning_publish_rpc.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260629160000_workout_session_auto_expire.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260701000000_ops_health_snapshot.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260701120000_ops_health_system.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260702000000_provider_neutral_payments_foundation.sql` | paired | `supabase/migrations/rollbacks/` | Paired down migration is present. |
| `20260710000000_client_subscription_management.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260727000000_auth_user_trigger.sql` | irreversible-by-design | — | Conditional repair cannot distinguish a trigger it created from one that pre-existed; removing either would break profile provisioning. |
| `20260727000100_legal_documents_reference_data.sql` | irreversible-by-design | — | Reference-row backfill; deleting by key could remove rows that predated this idempotent insert. |
| `20260728000000_rpc_execute_acl_hardening.sql` | irreversible-by-design | — | Reversal would restore security-critical RPC execution grants to untrusted roles. |
| `20260728010000_workout_write_subscription_gate.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. |
| `20260730000000_client_write_subscription_gate.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. Policy-only; it deliberately does **not** drop `client_has_write_access(uuid)`, which the live L12 workout policies still depend on. |
| `20260730100000_revoke_service_role_role_predicates.sql` | paired | `supabase/rollbacks/` | Paired down migration is present. Grants only; the rollback restores `service_role` EXECUTE and touches no function. |
