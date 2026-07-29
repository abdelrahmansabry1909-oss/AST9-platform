# Migration History Reconciliation

**Phase:** M1 mapping and M2 registry repair record

**Date:** 2026-07-29

**Status:** Completed and independently verified; ISSUE_LOG #18 closed

## Safety boundary

This document maps repository migration versions to production history and
records the separately approved M2 registry repair. M1 was read-only:

- no `supabase migration repair`;
- no `supabase db push` or `supabase migration up`;
- no migration application;
- no schema, data, RLS, function, grant, or registry mutation; and
- no change to the repository's isolated-staging CLI link.

During M1, the production migration registry contained **64 rows before and
after** the inspection. L12,
`20260728010000_workout_write_subscription_gate`, remained registered exactly
once and is not one of the 25 versions below.

M2 was separately owner-approved and completed on 2026-07-29. It changed only
`supabase_migrations.schema_migrations`: the approved 25 repository versions
were recorded as applied, one at a time, without applying migration SQL. The
registry moved from **64 to 89 rows**. The original 64 rows and all 25
differently versioned production rows were preserved.

## Method

Filename similarity was used only to find candidates. Classification required
content evidence from:

1. the repository migration body;
2. the production registry's recorded migration name and SQL statements; and
3. current production catalogs and aggregate data:
   - relations and RLS flags;
   - columns and defaults;
   - constraints and indexes;
   - policies and expressions;
   - functions, definitions, security attributes, configuration, and grants;
   - triggers, Realtime publication membership, and the scheduled cron job; and
   - aggregate/reference-data checks that expose no client identity.

The expected-object check covered **12 created relations, 31 added columns, 16
named constraints, 37 named indexes, 28 policies, 22 function signatures and ACL
contracts, and 12 triggers**. No expected item was missing. All three Realtime
tables and the stale-workout cron job were present. The 22 function ACL checks
had zero mismatches.

Twelve mapped repository bodies match the corresponding recorded production SQL
after removing comments, transaction wrappers, and formatting. The remaining
ten are explained in the table: harmless text encoding/literal differences,
intentional consolidation of multiple production entries, or repository
hardening that is present in the current production catalog.

No partially applied migration was found.

## Reconciliation mapping

| Repository version | Repository migration | Production version(s) | Bucket | Content-level evidence |
|---|---|---|---|---|
| `20260614000000` | `coach_packages_foundation` | `20260614080301` | Live / divergent | `coach_subscriptions` exists with package/status constraints, RLS, `coach_subscriptions_select`, touch trigger, and slot/package RPC lineage. Recorded SQL differs only in comment text and explicit column aliases; the later mapped business-profile migration intentionally supersedes the original package RPC signature. |
| `20260614010000` | `coach_packages_harden` | `20260614082508` | Live / divergent | Recorded SQL is normalized-equal. The touch function is present; slot/package RPC execution is unavailable to `anon` and available to the intended signed-in/service roles. |
| `20260614020000` | `coach_signup_onboarding` | `20260614114829` | Live / divergent | `profiles.onboarding_completed_at` and `complete_onboarding()` exist with `SECURITY DEFINER`, fixed `search_path`, signed-in execution, and no `anon` execution. Recorded difference is only the column-comment literal. |
| `20260614030000` | `coach_exercise_library` | `20260614122602` | Live / divergent | All eight library columns exist; RLS is enabled; select/insert/update/delete policies exist. The recorded select policy predates the repository's coach-only system-library hardening, but the **current** policy matches the repository rule: coaches/admins can browse system/global rows while clients see only exercises referenced by their own program. |
| `20260614040000` | `community_privacy_realtime` | `20260614170106` | Live / divergent | Recorded SQL is normalized-equal. Current client-post and client-comment select policies have owner/admin/assigned-coach scope, and `coach_messages`, `client_posts`, and `client_comments` are all members of `supabase_realtime`. |
| `20260615000000` | `program_modes` | `20260615115800`, `20260615121735`, `20260615123007` | Live / divergent, consolidated | Three production entries form the repository's final consolidated migration. `client_programs` has mode/revision/change columns and its mode check; `client_program_revisions`, both indexes, RLS/select policy, two triggers, and the final split trigger functions are present. Trigger functions have fixed search paths and no browser-role execution grants. |
| `20260616000000` | `appointments_v1` | `20260615125855` | Live / divergent | Table, calendly profile column/check, three indexes, four policies, two triggers, and both trigger functions are present. The recorded SQL differs only by text-encoding representation of punctuation. |
| `20260616010000` | `admin_coach_business_overview` | `20260616100034` | Live / divergent | Recorded SQL is normalized-equal. The stable `SECURITY DEFINER` overview RPC exists with fixed search path, signed-in/service execution, and no `anon` execution. |
| `20260616020000` | `coach_business_profile` | `20260616172246` | Live / divergent | Profile business columns, package billing interval/check, current slot-status RPC, five-argument package RPC, and expanded overview RPC are present. The repository adds explicit `anon` revokes omitted from the recorded body; current ACLs match those revokes. |
| `20260619000000` | `system_exercise_library` | `20260619132820`, `20260619133236` | Live / divergent, consolidated | Schema and data were recorded separately in production. Category constraint, four provenance columns, and unique source-key index exist. Production has exactly **152** distinct `dg:` source keys; the set equals the repository's 152 keys, all 152 are global/system rows, and none lacks required import metadata. |
| `20260624000000` | `client_program_versions` | `20260624140343` | Live / divergent | Version table, columns, indexes, RLS, select/write policies, touch trigger/function, and backfill structure are present. Recorded SQL differs only by text-encoding representation of punctuation. |
| `20260625000000` | `athletic_assessment_foundation` | `20260625132018` | Live / divergent | Recorded SQL is normalized-equal. All four foundation tables, their constraints/indexes, RLS/policies, touch triggers, trigger function, and default battery foundation are present. |
| `20260625010000` | `athletic_assessment_index_rls_fix` | `20260625140555` | Live / divergent | Recorded SQL is normalized-equal. Replacement client/coach assessment indexes and the coach/admin-scoped default-battery select policy are current. |
| `20260625020000` | `athletic_movement_observations` | `20260625170445` | Live / divergent | Recorded SQL is normalized-equal. Observation table, domain/tag constraints, six indexes, RLS policy, and touch trigger are present. |
| `20260625030000` | `athletic_client_write_rls_hardening` | `20260626030403` | Live / divergent | Recorded SQL is normalized-equal. Current write policies on all four athletic surfaces require admin or coach/assigned-coach scope; battery insert/update/delete policies retain the non-default restriction. |
| `20260627000000` | `legal_acceptance_foundation` | `20260627115136` | Live / divergent | Recorded SQL is normalized-equal. Both legal tables, constraints/indexes, RLS policies, touch trigger, acceptance RPCs, grants, and the six document types are present. |
| `20260629000000` | `program_versioning_publish_rpc` | `20260629095730` | Live / divergent | Recorded SQL is normalized-equal. Draft/active constraints, one-active partial unique index, client-safe select policy, and `publish_program_version(uuid,text)` with signed-in execution are current. |
| `20260629160000` | `workout_session_auto_expire` | `20260629164231` | Live / divergent | Recorded SQL is normalized-equal. `workout_sessions.end_reason`, self-expiry RPC, service-only global expiry RPC, expected grants, and the active hourly cron job are present. |
| `20260701000000` | `ops_health_snapshot` | `20260701160538` | Live / divergent | Recorded SQL is normalized-equal. The stable, admin-gated `ops_health_snapshot()` exists with fixed search path, signed-in execution, and no `anon` execution. |
| `20260701120000` | `ops_health_system` | `20260701170036` | Live / divergent | Recorded SQL is normalized-equal. Both system health RPCs exist as stable `SECURITY DEFINER` functions with fixed search paths and service-role-only execution. |
| `20260702000000` | `provider_neutral_payments_foundation` | `20260703031204` | Live / divergent | Payment-events table, constraints/indexes, admin-read policy, provider-period columns/checks, and service-only package-period RPC are present. Recorded SQL differs only by text-encoding representation of punctuation. |
| `20260710000000` | `client_subscription_management` | `20260710161851` | Live / divergent | Subscription plan-name/month/end-date constraints and both management RPCs are current. Production function definitions include the repository's later safety hardening: client-role target check, notes cap, cancelled rejection, admin-only expiry, and derived end date after range validation. Both RPCs deny `anon` and allow signed-in/service execution. |
| `20260727000000` | `auth_user_trigger` | None | Equivalent / no-op | The exact trigger predicate finds one enabled row-level AFTER INSERT trigger on `auth.users` calling `public.handle_new_user()`. Applying the guarded migration would skip creation. |
| `20260727000100` | `legal_documents_reference_data` | None | Equivalent / no-op | An exact six-row join on type, version, title, body reference, required flag, and current flag returned 6 matches and 0 missing rows. `ON CONFLICT` would add nothing. |
| `20260728000000` | `rpc_execute_acl_hardening` | None | Equivalent / no-op | All four functions exist. `anon` execution is false for all; signed-in execution is true only for the two subscription RPCs; service execution is true for all four. The migration would reproduce the current ACLs. |

**Accounting:** 22 live/divergent repository versions + 3 equivalent/no-op
repository versions = **25**. The 22 live mappings correspond to 25 production
history rows because `program_modes` consolidates three production entries and
`system_exercise_library` consolidates two.

## Specific no-op proof queries and results

### `20260727000000_auth_user_trigger`

The read-only query joined `pg_trigger`, `pg_class`, and `pg_namespace`, filtered
to `auth.users`, required `tgfoid = 'public.handle_new_user()'::regprocedure`,
excluded internal/disabled triggers, and checked row-level AFTER INSERT bits.

Result:

```text
matching_enabled_trigger_count = 1
all_matching_triggers_enabled = true
all_are_row_after_events = true
```

### `20260727000100_legal_documents_reference_data`

The read-only query defined the six repository tuples in a `VALUES` CTE and
left-joined production on `(doc_type, version)`, then compared title, body
reference, required flag, and current flag.

Result:

```text
exact_expected_rows = 6
missing_expected_rows = 0
```

### `20260728000000_rpc_execute_acl_hardening`

The read-only query resolved all four complete signatures with
`to_regprocedure()` and evaluated `has_function_privilege()` for `anon`,
`authenticated`, and `service_role`.

| Function | Exists | `anon` | `authenticated` | `service_role` |
|---|---:|---:|---:|---:|
| `create_client_subscription` | true | false | true | true |
| `update_client_subscription` | true | false | true | true |
| `apply_paid_coach_package_period_system` | true | false | false | true |
| `expire_stale_workout_sessions_all` | true | false | false | true |

## M2 execution record

M2 completed on 2026-07-29 with the audited Revision 7 executor, SHA-256
`0a2ecdc3df80e894ddd219a327d52d339591f3b4ddbf6709f3393edb8eb545fd`.
The executor used the pinned Supabase CLI `2.109.1`, an explicit database URL,
and one-version `migration repair --status applied` calls. It never used
`--linked`, `supabase link`, `db push`, `migration up`, handwritten registry
SQL, or migration SQL application.

Execution evidence:

- sanitized report SHA-256:
  `773354eb201f065c665e58424f97814be06a928f120c7dcb289b86b7672263b2`;
- registry count: **64 before / 89 after**;
- added set: exactly the approved **25 of 25** repository versions;
- original rows: the post-execution original-row snapshot remained
  byte-identical to the pre-change snapshot, SHA-256
  `7b9dae553d5a550f7746c0b7d6482618d3d43632980dbc2aa7aa5c2e03fe546b`;
- pre-change versions-only snapshot SHA-256:
  `2633ec6dc94153dc7f5dd9788e7ad8125fe2d7e97c61c582af091cfdafe20f20`;
- post-change versions-only snapshot SHA-256:
  `4de1275e54b775b6294353cdfc7b3ba66a910c955eca18f45250216fdbc154d7`;
- catalog fingerprint unchanged:
  `8352d0584b8f145060119c691636a53b`;
- application-row fingerprint unchanged:
  `956c3e7ef1d8664e1e3b8976f04ea5b8`; and
- L12 unchanged: 1 registry row, 6 RESTRICTIVE policies, 5 PERMISSIVE
  policies, and 0 RESTRICTIVE `SELECT`/`ALL` policies.

Independent read-only audit re-derived the registry sets, fingerprints, and L12
invariants and found no blocker, major, or minor issue. No rollback was required.
No schema, RLS, function, grant, trigger, Realtime, cron, or application-data
change occurred.

## Historical M2 pre-change plan

The following plan was approved before M2 and is retained as historical evidence.
Execution used the pinned, audited Revision 7 executor described above rather
than the single batch command shown below.

Before any repair:

1. Export the complete registry, outside the repository, from this read-only
   query:

   ```sql
   select version, name, statements, created_by, idempotency_key, rollback
   from supabase_migrations.schema_migrations
   order by version;
   ```

2. Record the file's SHA-256 and row count. Expected pre-change count: **64**.
3. Re-run the 25-version set-difference and stop unless it exactly matches this
   document.
4. Re-run the object/ACL/no-op evidence and stop on any drift or partial state.
5. Confirm L12 still has 6 RESTRICTIVE plus 5 pre-existing PERMISSIVE policies.

### Historical forward repair command - not used as a single batch

The connection variable below must contain a separately reviewed, percent-encoded
production database URL. It must never be printed or committed.

```powershell
# HISTORICAL M1 PLAN - M2 USED THE PINNED ONE-VERSION EXECUTOR
supabase migration repair `
  20260614000000 20260614010000 20260614020000 20260614030000 `
  20260614040000 20260615000000 20260616000000 20260616010000 `
  20260616020000 20260619000000 20260624000000 20260625000000 `
  20260625010000 20260625020000 20260625030000 20260627000000 `
  20260629000000 20260629160000 20260701000000 20260701120000 `
  20260702000000 20260710000000 20260727000000 20260727000100 `
  20260728000000 `
  --status applied `
  --db-url "$env:AST9_MIGRATION_REPAIR_DB_URL"
```

Expected registry count after a complete repair: **89**. The original 64 rows
must remain byte-for-byte unchanged; only the 25 repository-version rows may be
new. No application object or data count may change.

## Rollback plan

If the mapping is wrong, a command fails, the added set is not exactly the
approved 25, an original row changes, or any application object/data changes:

1. stop immediately;
2. compare the live registry with the full 64-row pre-change snapshot;
3. identify which of the approved 25 versions were actually added;
4. revert **only that added subset** with `migration repair --status reverted`;
5. verify the registry is exactly the original 64-row snapshot and SHA-256; and
6. re-run the L12 policy and application-object checks.

For the complete 25-version set, the prepared rollback command is:

```powershell
# M2 ROLLBACK ONLY - NOT EXECUTED IN M1
supabase migration repair `
  20260614000000 20260614010000 20260614020000 20260614030000 `
  20260614040000 20260615000000 20260616000000 20260616010000 `
  20260616020000 20260619000000 20260624000000 20260625000000 `
  20260625010000 20260625020000 20260625030000 20260627000000 `
  20260629000000 20260629160000 20260701000000 20260701120000 `
  20260702000000 20260710000000 20260727000000 20260727000100 `
  20260728000000 `
  --status reverted `
  --db-url "$env:AST9_MIGRATION_REPAIR_DB_URL"
```

Do not hand-write registry rows, delete divergent historical rows, use
`ON CONFLICT DO NOTHING`, or apply any of the three equivalent/no-op migrations.
The original differently versioned production rows are historical evidence and
must remain.

## M1 completion checks

- Production registry: **64 before / 64 after**.
- L12 policy contract: **6 RESTRICTIVE / 5 PERMISSIVE**, with no RESTRICTIVE
  `SELECT` or `ALL`.
- Mapping: **25 of 25 accounted for**.
- Partial applications: **none found**.
- Repair/apply/push commands executed: **none**.
- Production project identifiers, URLs, keys, connection strings, and client
  identities recorded in this artifact: **none**.

## M2 completion checks

- Production registry: **64 before / 89 after**.
- Repository migration versions represented: **64 of 64**, with **0 absent**.
- Added registry versions: exactly the approved **25 of 25**.
- Original registry rows: byte-for-byte unchanged.
- Differently versioned production rows removed or rewritten: **none**.
- Migration SQL applied: **none**.
- Schema, RLS, function, grant, trigger, Realtime, cron, and application-data
  changes: **none**.
- L12 policy contract: **1 registry row, 6 RESTRICTIVE / 5 PERMISSIVE**, with no
  RESTRICTIVE `SELECT` or `ALL`.
- Rollback required: **no**.
- Credentials, URLs, project references, SQL snapshots, and identities recorded
  in this artifact: **none**.
