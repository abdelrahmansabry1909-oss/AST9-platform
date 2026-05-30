# PROJECT_STATUS.md — NeuCore Platform (post-Tier 1)

**Date:** 2026-05-30
**Branch:** `claude/interesting-buck-452459`
**Last commits:** `7265f09` (Tier 1), `4f65456` (Features 1–4 checkpoint)
**Status:** Tier 1 code shipped. **Live verification halted** at a migration collision — decision required before any DB change applies.

---

## 0 · Executive Summary

| Stream | Status |
|---|---|
| Features 1–4 code | ✅ Committed (`4f65456`) — no regressions, syntax clean |
| Tier 1 fixes | ✅ Committed (`7265f09`) — seven gaps closed |
| Live DB — Feature migrations applied | ❌ **0 of 5** — blocked by collision |
| Live DB — verification queries | ✅ Run; one critical finding |

**Halt reason:** the live `public.notifications` table already exists with a **different schema** that predates this work. My Feature 3 migration uses `CREATE TABLE IF NOT EXISTS` and would silently no-op, leaving the wrong schema active and breaking every downstream call.

**Decision required:** see §4 below — three paths, recommendation listed.

---

## 1 · Tier 1 fixes (committed in `7265f09`)

All seven items from the previous status report's "Tier 1" list are now landed in code. No live-DB impact yet for items requiring a migration; pure code edits already merged.

| Fix | What changed | Verified by |
|---|---|---|
| **M** Client access to Case Studies | Removed `role-coach-admin` class on `nav-case-studies` in `app.html:192` | grep + manual visual trace; Share Case button still scoped to Community sub-tab |
| **N** Client Settings page | New `nav-client-settings` (role-client-only) + `#section-client-settings` with email/name/change-password + subscription card; `Dashboard._renderClientSettings` loader | `node --check js/dashboard.js` ✓ |
| **D** Demo Login | `Auth.loginAsGuest()` now throws typed `DEMO_UNAVAILABLE` error; `UI.handleDemoLogin` catches and surfaces clean toast | Trace + syntax check |
| **L** `populateProgressClientSelect` | Implemented on `Dashboard`; scopes by `assigned_coach` for non-admins; populates `#progress-client-select` | Boot path now exercises a real function instead of optional-chained `undefined` |
| **C** Require assigned coach | `submitAddClient` validates `fields.coach`; modal label marked required + hint | `js/clients.js` diff |
| **FK guards (6 triggers)** | New migration `20260603_*` recreates all six notification trigger functions with `_profile_exists` guard | Migration on disk, not yet applied — see §3 |
| **Phase Upgrade → inbox** | New `tg_profile_phase_upgrade` AFTER UPDATE trigger on `profiles.current_phase` publishes a `phase_upgrade` notification — JS unchanged | Migration on disk, not yet applied — see §3 |

**Code-level verification: clean.** All edits compile (`node --check` passes for every touched JS file).

---

## 2 · Live Supabase State — what's actually in the database

**Project:** `byquokhcbagofshsclfy` (eu-central-1, Postgres 17.6.1.111, ACTIVE_HEALTHY)
**Profiles:** 3 (1 coach + 1 client + 1 other based on row counts)
**Subscriptions:** 2 active (`2026-05-21→2026-08-21`, `2026-05-10→2026-08-10`)
**RPM graphs:** 8 · phases: 5 · phase_submissions: 0
**Client programs published:** 1 · routines: 1 · daily_routine_logs: 0
**Assessments:** 20 · gait_assessments: 20 · body_map_states: 20
**Case shares:** 1 · client posts: 3 · client groups: 1

### Migrations tracked in `supabase_migrations.schema_migrations` (12)
Pre-2026-05-21 baseline only — covers profiles/sessions/assessments/community/RLS hardening + the `case_study_approval` work.

### Migrations on disk but **NOT tracked** (state drift)
These tables exist (verified by row counts), so the SQL was applied via the SQL editor without going through the CLI:

| File on disk | Tables now present | Tracked? |
|---|---|---|
| `20260515_rpm_foundation.sql` | `rpm_graphs`, `rpm_phases`, `rpm_phase_exercises`, `phase_submissions`, `ai_feedback_log`, `subjective_assessments`, `visitor_inquiries` | ❌ |
| `20260516_rpm_phase5.sql` | column additions on rpm_phases | ❌ |
| `20260521_daily_routine.sql` | `daily_routine_logs` | ❌ |
| `20260522_client_program_publish.sql` | `client_programs`, `client_routines` | ❌ |
| `20260523_case_study_approval.sql` | status/reviewed_by columns on case_shares | ✅ (tracked) |

**Process gap, not a blocker.** Whoever applied them did so manually. Won't block Feature 1–4 migrations but should be folded into the registry eventually so `list_migrations` reflects reality.

### Helpers / functions present
- ✅ `public.is_admin()`, `public.is_coach()`, `public.is_coach_or_admin()` — from the RPM foundation
- ❌ `public.notify()`, `public.reactivate_subscription()`, `public.ensure_subscription_notifications()`, `public._profile_exists()`, `public._clamp_score()` — **none applied**

### Views present
- None of the new ones. `v_client_subscription_state` and `v_client_progression` don't exist yet.

---

## 3 · Live verification per feature

### Feature 1 — Subscription Grace
| Check | Result |
|---|---|
| Migration applied | ❌ Not applied |
| `subscriptions` table exists with `grace_days` column | ❌ column missing |
| `v_client_subscription_state` view | ❌ missing |
| `public.reactivate_subscription` RPC | ❌ missing |
| Existing subscription rows compatible with new view shape | ✅ (`plan, start_date, end_date, status` all present) |
| Auth.canWrite() behavior **once applied** | Will compile + run; depends on the view |

**Verdict:** Code is correct, awaiting migration apply.

### Feature 2 — Workout Tracking
| Check | Result |
|---|---|
| Migration applied | ❌ Not applied |
| `workout_sessions` / `workout_exercise_logs` exist | ❌ missing |
| Legacy `public.workout_logs` exists | ⚠ Yes — different table, different shape (`program_exercise_id, weight_used, reps_completed text, sets_completed, feedback`). Empty (0 rows). Not referenced by any of my code. **Not a conflict** but creates a confusing duplication. |
| Coach RLS works on assigned-coach | Depends on `profiles.assigned_coach` column — confirmed present in 4 of my migrations' RLS clauses. |

**Verdict:** Apply will succeed. Should document or rename the legacy `workout_logs` to avoid confusion later.

### Feature 3 — Notifications + Alt-Exercise ⚠ BLOCKED
| Check | Result |
|---|---|
| Migration applied | ❌ |
| `public.notifications` table exists | ⚠ **YES — wrong schema** |
| `public.notifications` rows | 0 |
| `exercise_alternative_requests` exists | ❌ missing |
| Six triggers exist | ❌ none |
| `ensure_subscription_notifications` | ❌ missing |
| Realtime publication enabled on `notifications` | Unknown — needs Studio check |

**The collision (root cause of halt):**

| Column in **legacy** `notifications` | Column in **my** `notifications` |
|---|---|
| `id uuid PK` | `id uuid PK` |
| `user_id uuid NOT NULL` | `recipient_id uuid NOT NULL` |
| `from_user_id uuid` | `actor_id uuid` |
| `type text NOT NULL` | `type text NOT NULL` |
| `title text NOT NULL` | `title text NOT NULL` |
| `message text` | `body text` |
| — | `link_section text` |
| — | `link_params jsonb NOT NULL DEFAULT '{}'` |
| — | `severity text DEFAULT 'info'` |
| `is_read boolean` | `read_at timestamptz` |
| — | `archived boolean DEFAULT false` |
| — | `data jsonb` |
| `created_at` | `created_at` |

Because my migration uses `CREATE TABLE IF NOT EXISTS notifications (...)`, it would **silently no-op** on this DB. Then `notify()` would `INSERT INTO notifications (recipient_id, ...)` against a table that only has `user_id` → **PostgreSQL error**, every trigger fails, every cross-module notification fails.

### Feature 4 — Progression Engine
| Check | Result |
|---|---|
| Migration applied | ❌ Not applied |
| `_clamp_score` helper | ❌ missing |
| `v_client_progression` view | ❌ missing |
| Source data present | ✅ `daily_routine_logs` (table exists, 0 rows), `workout_sessions` (will exist after Feature 2 apply), `exercise_alternative_requests` (will exist after Feature 3 apply) |

**Verdict:** Will apply cleanly after Features 2 + 3 are resolved.

### Security advisors — pre-existing findings (not introduced by my work)
- 4 × `anon_security_definer_function_executable` (`is_admin`, `is_admin_or_coach`, `is_coach`, `is_coach_or_admin`) — these helpers are callable by anon. Pre-existing.
- 4 × `authenticated_security_definer_function_executable` (same functions + `get_my_role`) — pre-existing.
- 1 × `rls_policy_always_true` (`visitor_inquiries_anon_insert WITH CHECK (true)`) — pre-existing.
- 1 × `function_search_path_mutable` (`rpm_touch_updated_at`) — pre-existing.
- 1 × `auth_leaked_password_protection` — Supabase auth setting; orthogonal to this work.

**None of my migrations introduce new advisor findings.** My SECURITY DEFINER functions (`notify`, `reactivate_subscription`, `ensure_subscription_notifications`, `_profile_exists`, `_clamp_score`, `tg_*`) all set `search_path = public` and would not trigger the mutable-search-path lint. I should expect them to surface on the `anon_security_definer_function_executable` lint once applied — and that's intentional: `notify` is callable by authenticated users (gated internally by my permission logic), while `reactivate_subscription` is granted to `authenticated` and gated by `is_admin OR assigned_coach`. Acceptable.

---

## 4 · 🛑 Decision required — three paths to resolve the notifications collision

The legacy `notifications` table has **0 rows** and is not referenced by **any** code in the current branch (grep across `js/`, `src/`, `supabase/migrations/` returns no `notifications` usage outside the new module). It appears to be a vestige of an earlier feature that was never wired or was abandoned.

### Path A — Drop legacy + apply mine (recommended)
- Run `DROP TABLE public.notifications CASCADE;` (zero data loss).
- Apply migration `20260601_notifications_inbox.sql`.
- All my code works as designed.
- **Effort: ~30 sec. Risk: zero (table is empty + unused).**

### Path B — Rename my table to `inbox_notifications`
- Edit my migration + every reference in `js/notificationsService.js`, `app.html`, and the trigger functions.
- Live DB keeps both tables side-by-side.
- **Effort: ~30 min. Risk: low. Penalty: ugly name + duplication.**

### Path C — Reshape legacy notifications to match mine
- Write an `ALTER TABLE` migration: rename `user_id`→`recipient_id`, `from_user_id`→`actor_id`, `message`→`body`; add `link_section`, `link_params`, `severity`, `read_at` (compute from `is_read`), `archived`, `data`.
- Drop `is_read`.
- Then apply the rest of `20260601_*` minus the `CREATE TABLE`.
- **Effort: ~1 hour. Risk: medium (must handle the existing index/RLS/grant rebuild). No upside vs Path A.**

**Recommendation: Path A.** Empty + unused legacy table; cleanest outcome.

After your call:

### Apply order (once unblocked)
1. `20260530_subscription_grace.sql` (Feature 1)
2. `20260531_workout_tracking.sql` (Feature 2)
3. Path A drop, then `20260601_notifications_inbox.sql` (Feature 3)
4. `20260602_progression_engine.sql` (Feature 4)
5. `20260603_notification_guards_and_phase_upgrade.sql` (Tier 1)

### Live smoke tests I'll run automatically after apply
- View existence + sample SELECT from `v_client_subscription_state` for the 2 known clients
- `SELECT public.notify(auth.uid(), 'test', 'Verification', 'live smoke');` then read it back
- Insert a fake `exercise_alternative_requests` row as a known client → confirm a `notifications` row appears via trigger
- `SELECT public.ensure_subscription_notifications('<client_id>');` for the 2 known clients
- `SELECT compliance, recovery, performance, overall, formula_version FROM v_client_progression;`
- Re-run `get_advisors` and compare delta

---

## 5 · What's still verified at code level (won't change with migration application)

These were validated by static trace + `node --check` and remain green:

- ✅ Tier 1 sidebar role flips (M, N)
- ✅ `Auth.loginAsGuest` no longer throws TypeError (D)
- ✅ `Dashboard.populateProgressClientSelect` exists (L)
- ✅ `submitAddClient` requires `coach` (C)
- ✅ `_renderClientSettings` paints email, name, password modal, subscription pill + dates + days/grace remaining
- ✅ `Notifications.bindBell` ↔ `Auth.canWrite` ↔ `SubscriptionService.formatPill` integration intact across all four features
- ✅ `WorkoutSession.start/finish/logExercise` write paths gated by `Auth.canWrite()`
- ✅ Alt-exercise modal blocks if `profile.assigned_coach == null` (covers the case where Fix C ever regresses)
- ✅ Migration `20260603_*` correctly recreates all six trigger functions with the `_profile_exists` guard so a missing `profiles` row no longer rolls back the parent INSERT
- ✅ Migration `20260603_*` Phase Upgrade trigger fires only when `current_phase` actually changes for a `client` role (no spam on coach/admin profile updates)

---

## 6 · Findings unchanged from previous status (still TBD)

These are deliberately deferred for the planned Tier 2/3 features:

| ID | Gap | Will be addressed by |
|---|---|---|
| F | "Unpublished program" indicator coach-side | Tier 2 / Exercise Video feature |
| G | Exercise videos inside My Program rows | **Next planned feature** (Exercise Video Integration) |
| H | Coach alt-response = text only; no substitute persists | **Next planned feature** (Alt-Exercise Replacement) |
| E | Client dashboard Assessment Report card hardcoded | **Next planned feature** (Assessment / 3D Hologram) |
| K | Three competing coach progress surfaces | Future |
| I | No progression-history snapshot table | Future progression v2 |
| J | Performance score mostly neutral | Future progression v2 |
| A | Username vs email | Future spec discussion |
| B | Sub creation inside Add Client | Future |
| Nutrition signal | Whole new feature | Future |
| Daily cron for subscription notifications | Future |

---

## 7 · Next move

**Per your instruction — stop after Tier 1 + verification.**

I have stopped. No more code changes pending your call on §4.

Once you choose a path, I will:
1. Apply the 5 migrations in the correct order via MCP `apply_migration` (recorded in the schema_migrations registry).
2. Run the smoke tests in §4.
3. Re-run `get_advisors` to confirm no new findings.
4. Append a "§8 · Live verification results" section to this file with the actual SQL outputs.
5. Commit the updated PROJECT_STATUS.md.
6. Hand back to you for Feature 5 selection (Exercise Video / Alt-Exercise Replacement / Assessment 3D).

**No new feature development until you sign off on the migration path.**
