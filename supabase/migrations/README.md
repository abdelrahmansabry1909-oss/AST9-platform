# supabase/migrations — registry alignment notes

## TL;DR

Every remote `supabase_migrations.schema_migrations` row has a matching local file with the same 14-digit `<version>_<name>.sql` filename. The Supabase CLI / Branching preview no longer errors with **"Remote migration versions not found in local migrations directory."**

## What was wrong

Earlier in the project, migrations were applied via three different paths:

1. **Supabase SQL Editor (dashboard)** — used for the first ~12 migrations (2026-05-05 → 2026-05-06). Source SQL was NOT preserved in the repo.
2. **`apply_migration` via MCP** — used for F1–F6 + the Reliability Sweep + the Stabilization Pass. Source SQL preserved in the repo but with **8-digit date-only filenames** (e.g. `20260530_subscription_grace.sql`) that didn't match the **14-digit timestamps** the registry stamps.
3. **Local-disk-only** — `rpm_foundation`, `rpm_phase5`, `daily_routine`, `client_program_publish` were applied via SQL Editor BUT were ALSO committed to the repo with 8-digit names. They were never registered in `supabase_migrations.schema_migrations`.

The CLI matches local files to remote registry rows by **exact filename match on the 14-digit version prefix**. With three different naming conventions in play and 12 dashboard-only migrations that had no local file at all, the CLI couldn't reconcile anything.

## What the realignment commit did

### A. Renamed 8 MCP-applied files to match their registered timestamps

| Old name | New name |
|---|---|
| `20260530_subscription_grace.sql` | `20260530202308_subscription_grace.sql` |
| `20260531_workout_tracking.sql` | `20260530202413_workout_tracking.sql` |
| `20260601_notifications_inbox.sql` | `20260530202555_notifications_inbox.sql` |
| `20260602_progression_engine.sql` | `20260530203052_progression_engine.sql` |
| `20260603_notification_guards_and_phase_upgrade.sql` | `20260530203157_notification_guards_and_phase_upgrade.sql` |
| `20260604_advisor_hardening.sql` | `20260530204349_advisor_hardening.sql` |
| `20260606_alt_exercise_substitute.sql` | `20260531123907_alt_exercise_substitute.sql` |
| `20260601_sessions_rls_tighten.sql` | `20260531162107_sessions_rls_tighten.sql` |

### B. Split `20260523_case_study_approval.sql` into the two registered versions

The remote registry had `case_study_approval` and `case_study_approval_grants` as two separate entries. The single local file mixed both. Now:
- `20260521142823_case_study_approval.sql` — main migration (tables, RLS, policies)
- `20260521144757_case_study_approval_grants.sql` — the four `GRANT EXECUTE` statements

### C. Created 3 reconstructed-content files for MCP-applied migrations that never had a local file

- `20260530202156_drop_legacy_notifications.sql` — `DROP TABLE IF EXISTS public.notifications CASCADE;` (idempotent)
- `20260531173330_profiles_assigned_coach_index.sql` — partial index on `profiles(assigned_coach) WHERE NOT NULL` (idempotent — `CREATE INDEX IF NOT EXISTS`)
- (the case_study_approval split above covered the 2 registered case-study versions)

### D. Renamed the 4 legacy disk-only files to 14-digit timestamps + registered them in remote

| Old name | New name | Remote registration |
|---|---|---|
| `20260515_rpm_foundation.sql` | `20260515000000_rpm_foundation.sql` | INSERTed via MCP |
| `20260516_rpm_phase5.sql` | `20260516000000_rpm_phase5.sql` | INSERTed via MCP |
| `20260521_daily_routine.sql` | `20260521000000_daily_routine.sql` | INSERTed via MCP |
| `20260522_client_program_publish.sql` | `20260522000000_client_program_publish.sql` | INSERTed via MCP |

Their `statements` column in the registry is a pointer comment referencing the on-disk file (the migrations have already executed on production; the file is the canonical source).

### E. Created 10 marker stub files for the dashboard-applied historic migrations

Files `20260505124526_…sql` through `20260506071204_…sql` exist now as **no-op stubs**. They contain a documentation header explaining their origin + `SELECT 1;` as the body.

- **On production**: the CLI sees the version as already-registered → skips → no impact.
- **On a fresh preview / branch database**: the CLI runs the stub → no-op → **the preview will be missing the schema these migrations originally created** (`profiles`, `subjective_assessments`, `case_shares`, the early RLS pass, etc.).

Do **not** delete these markers. Production records all ten versions, and removing
their matching local files would create production migration-history drift.

P3A-2B adds a reviewed schema-only artifact at
`supabase/baseline/production_public_schema.sql`. It deliberately sits outside
`supabase/migrations/`: the dump represents the current schema and is not
idempotent, so it must never be treated as a forward migration or pushed to
production.

For a brand-new staging project, use the guarded command emitter documented in
`supabase/baseline/README.md`. The safe order is:

1. Apply the baseline once to an empty `public` schema.
2. Mark all 60 retained historical versions as applied using
   `supabase/baseline/repair-versions.txt`.
3. Run `supabase db push` to apply only later forward migrations.

Never replay the 60 historical files over the current-schema baseline.

## Current state

- **60 retained historical versions:** 10 registry-alignment markers and 50
  migrations with real SQL.
- The marker files remain load-bearing for production history reconciliation.
- The baseline artifact is single-use, staging-only, and structurally unreachable
  by `supabase db push`.
- New forward migrations continue to use normal 14-digit filenames and are
  applied incrementally after baseline provisioning.

## How to add new migrations going forward

Use the Supabase CLI:
```
supabase migration new <descriptive_name>
```

That generates a properly-stamped 14-digit filename under `supabase/migrations/`. Write your DDL into it. Apply with `supabase db push` (or via MCP `apply_migration`, but make sure the version stamp the MCP tool generates matches the on-disk file).

**Don't** apply migrations via the Supabase SQL Editor anymore — that's what created this divergence in the first place.
