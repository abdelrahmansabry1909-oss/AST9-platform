# PROJECT_STATUS.md — NeuCore Platform

**Last updated:** 2026-05-31
**Branch:** `claude/interesting-buck-452459`
**HEAD commit:** F6 just shipped (commit pending)
**Worktree path:** `D:\ASThub\.claude\worktrees\interesting-buck-452459`
**Origin repo:** `https://github.com/abdelrahmansabry1909-oss/AST9_HUB.git`
**Live Supabase project:** `byquokhcbagofshsclfy` (eu-central-1, Postgres 17.6.1.111, ACTIVE_HEALTHY)

> This document is a **handoff snapshot.** A future Claude session reading this + `FEATURE_STATUS.md` + `NEXT_STEPS.md` has every fact needed to continue without rebuilding context.

---

## 0 · One-line summary

6 features shipped + 2 hardening passes + 8 migrations live + 7 new JS modules + full end-to-end live verification. **Features 1–5 frozen by user signoff; Feature 6 complete and stable but not yet "frozen." Progression formula bumped v1.0 → v1.1 by F6 (no Recovery penalty for successfully-substituted requests). Next: Reliability + Defect Sweep, then Feature 7 (Assessment / 3D Hologram).**

---

## 1 · Critical context for a future session

### 1.1 Two app shells exist — work only in `app.html`
- `app.html` is the active NeuCore shell with role-aware sidebar (`role-coach-admin`, `role-client-only`, `role-admin-only`).
- `index.html` is the **legacy AST9 single-role shell** — out of scope, deliberately untouched. **Never edit `index.html`** unless the user explicitly says so.

### 1.2 The four locked architectural rules
1. **Write-gate:** every client-side write call must check `Auth.canWrite()`. `active | grace → ok` · `expired | pending | none → toast + return`.
2. **Single source of truth for subscription state:** read `Auth.getSubscriptionState()` (cached on `_profile.subscription`); never query `subscriptions` directly from a UI module — use `SubscriptionService`.
3. **Notification authorization in SQL once:** never `INSERT INTO notifications` directly — always go through `public.notify(...)`. The `WITH CHECK (false)` direct-insert policy enforces this at the DB.
4. **Progression formula immutable in place:** any reweight ships as a new view migration + `formula_version` bump (changelog header documenting exactly what changed). Never silently edit in place. F6 honored this rule by bumping v1.0 → v1.1 with the alt-CTE substitute-aware change documented in the migration header.

### 1.2-bis · Program publishing rule (new with F6)
5. **Published `client_programs.program` JSON is immutable.** Anything that needs to alter what the client sees ships as an *override layer* (per-render query → in-memory rewrite), never as a JSON mutation. F6's substitution flow is the canonical example. PDF exports, analytics, future personalization must follow the same pattern.

### 1.3 The five locked working-style rules (from user memory)
1. Lock architecture before any code
2. One feature at a time
3. No scope drift
4. Verify before signoff
5. After signoff, the feature is **frozen** — don't touch unless a bug surfaces

### 1.4 Two pre-existing schema oddities — be aware
- **Migration registry drift.** Four migration files exist on disk but aren't in `supabase_migrations.schema_migrations`: `20260515_rpm_foundation`, `20260516_rpm_phase5`, `20260521_daily_routine`, `20260522_client_program_publish`. Their tables exist (rpm_graphs, daily_routine_logs, client_programs) — applied via the SQL editor, not the CLI. Not a blocker; just don't trust `list_migrations()` as a complete map.
- **`daily_routine_logs` shape differs from its disk migration.** Live has `(id, client_id, log_date, completed bool, battery_pct int, completed_at)`. Disk file defines `(percent, total_tasks, completed_tasks jsonb, completed_count, updated_at)`. The Feature 4 view `v_client_progression` was adapted live to derive `routine_pct = COALESCE(battery_pct, completed?100:0)`. The on-disk migration file matches the live-applied SQL — they're consistent now.

### 1.5 Foreign-key invariant
- `notifications.recipient_id` FKs to `profiles(id) NOT NULL`.
- `rpm_graphs.coach_id` and `case_shares.coach_id` FK to `auth.users(id)` (legacy schema).
- The six notification triggers wrap every `notify()` call in `IF public._profile_exists(v_recipient)` (Tier 1). If a coach exists in auth but not in profiles, the trigger silently no-ops instead of rolling back the parent INSERT.

---

## 2 · Current architecture

### 2.1 Role model
- `profiles.role ∈ {admin, coach, client}` · `profiles.assigned_coach` FKs `profiles(id)` for clients.
- Sidebar visibility driven by `Dashboard.initShell` via `.role-coach-admin` / `.role-client-only` / `.role-admin-only` CSS classes.
- Loader registry: `js/dashboard.js → const loaders = { 'dashboard': ..., 'client-settings': ..., 'workout-history': ..., 'notifications': ..., 'progression': ..., ... }`.

### 2.2 Auth flow
- `Auth.init` → loads `_profile` from `profiles` → for clients, calls `_refreshSubscriptionState` → if `expired | pending | none`, throws `SubscriptionInactiveError {code: 'SUBSCRIPTION_INACTIVE', state}`. UI boot catches and shows `#screen-subscription-inactive`.
- `Auth.canWrite()` returns true for non-clients, delegates to `SubscriptionService.canWrite(state)` for clients.
- `Auth.getSubscriptionState()` returns the cached `_profile.subscription`.

### 2.3 Cross-module communication
- **Notifications inbox** is the canonical seam. Modules don't call each other; they `INSERT` into their own tables and let DB triggers publish into `notifications`. UI badge subscribes via Supabase Realtime + 60s poll fallback.
- **Subscription state** is read once per session and cached on `_profile.subscription` — no per-component re-fetch.
- **Library lookup** for program rendering is one batched `ExerciseLibrary.loadAll()` per `renderClientProgram`; the resulting Map is passed to `WorkoutSession.mountWorkouts({ libMap })`.

### 2.4 Data flow (client journey)

```
Coach creates Client (Clients.submitAddClient → create-user edge fn → profiles row)
        ↓
Coach creates Subscription (Subscriptions.submit → subscriptions row)
        ↓
Coach runs New Session (assessments + rehab_objective_assessments + gait_assessments + body_map_states)
        ↓
Coach Generate → Review → Publish (ProgramPublish → upsert client_programs.program + client_routines.tasks)
        ↓
Client logs in (Auth.login → SubscriptionService gate)
        ↓
Client lands on Client Dashboard (3D LoadVisualizer + Progression gauges + Subscription pill)
        ↓
Client navigates to My Program (ProgramPublish.renderClientProgram → ExerciseLibrary lookup
                                  → WorkoutSession.mountWorkouts with libMap)
        ↓
Client starts workout (WorkoutSession.start → workout_sessions row)
        ↓
Client logs sets/reps/weight (WorkoutSession.logExercise → workout_exercise_logs upsert
                                with exercise_id when row is library-linked)
        ↓
Client may request alternative (AltExercise.openModal → exercise_alternative_requests INSERT
                                  → tg_aer_insert trigger → notification to coach)
        ↓
Client finishes workout (WorkoutSession.finish → row status='completed', intensity, notes)
        ↓
Progression engine recalculates on next render (v_client_progression view reads workout_sessions
                                                  + workout_exercise_logs + daily_routine_logs
                                                  + exercise_alternative_requests)
        ↓
Coach sees the workout in Workout History (mountCoachView)
Coach sees updated scores in Progression overview (mountCoachOverview)
Coach gets inbox notifications for alt-requests, RPM submissions, case approvals,
       subscription expiring/grace, phase upgrades
```

---

## 3 · Live Supabase state inventory

### 3.1 Tables added by this work (RLS enabled, all policies attached)
| Table | RLS | Rows | Source migration |
|---|---|---|---|
| `notifications` | ✅ 4 policies | 0 | `notifications_inbox` (Feature 3) |
| `exercise_alternative_requests` | ✅ 4 policies | 0 | `notifications_inbox` (Feature 3) |
| `workout_sessions` | ✅ 4 policies + partial-unique-active-idx | 0 | `workout_tracking` (Feature 2) |
| `workout_exercise_logs` | ✅ 1 policy (inherits via parent) + unique (session, idx) | 0 | `workout_tracking` (Feature 2) |

### 3.2 Views added (both `security_invoker=true` — RLS on underlying tables governs)
| View | Source migration | Purpose |
|---|---|---|
| `v_client_subscription_state` | `subscription_grace` (F1) | One row per client with `effective_status`, `days_remaining`, `grace_days_left`, `grace_until` |
| `v_client_progression` | `progression_engine` (F4) → bumped by `alt_exercise_substitute` (F6) | One row per client with `compliance`, `recovery`, `performance`, `overall` + signal counts. **Formula v1.1** (F6): `alt_requests_30d` now excludes requests where `status='addressed' AND substitute_exercise_id IS NOT NULL` — no Recovery penalty for successfully-substituted requests. |

### 3.3 Functions added
| Function | Type | Purpose |
|---|---|---|
| `public.notify(...)` | SECURITY DEFINER | Single insert path for notifications inbox. Authz inside. |
| `public.reactivate_subscription(client, months, start, notes)` | SECURITY DEFINER | Coach/admin gated. Inserts new active subscription row. |
| `public.ensure_subscription_notifications(client)` | SECURITY DEFINER | Idempotent. Inserts expiring/grace notifications per billing window. |
| `public._profile_exists(uuid)` | STABLE | Trigger-safety guard. |
| `public._clamp_score(numeric)` | IMMUTABLE | View math helper. |
| `public.touch_workout_log_updated_at()` | trigger fn | maintenance |
| `tg_aer_notify_coach()`, `tg_aer_notify_client()` | trigger fn | Alt-exercise notifications |
| `tg_phase_subm_notify_coach()`, `tg_phase_subm_notify_client()` | trigger fn | RPM approval notifications |
| `tg_case_share_notify_admins()`, `tg_case_share_notify_coach()` | trigger fn | Case study approval notifications |
| `tg_profile_phase_upgrade()` | trigger fn | Coach phase upgrade → client inbox |

All have `SET search_path = public` (advisor-clean). Trigger functions have `REVOKE EXECUTE FROM anon, authenticated, public` (they're not RPC-callable).

### 3.4 Triggers attached
| Trigger | Table | Event |
|---|---|---|
| `tg_aer_insert` | `exercise_alternative_requests` | AFTER INSERT |
| `tg_aer_update` | `exercise_alternative_requests` | AFTER UPDATE OF status |
| `tg_phase_subm_insert` | `phase_submissions` | AFTER INSERT |
| `tg_phase_subm_update` | `phase_submissions` | AFTER UPDATE OF status |
| `tg_case_share_insert` | `case_shares` | AFTER INSERT |
| `tg_case_share_update` | `case_shares` | AFTER UPDATE OF status |
| `tg_profile_phase_upgrade` | `profiles` | AFTER UPDATE OF current_phase |
| `workout_exercise_logs_touch` | `workout_exercise_logs` | BEFORE UPDATE (maintenance) |

### 3.5 Migrations in `supabase_migrations.schema_migrations` (this work)
| Version | Name | Feature |
|---|---|---|
| `20260530202156` | `drop_legacy_notifications` | Path A precursor |
| `20260530202308` | `subscription_grace` | Feature 1 |
| `20260530202413` | `workout_tracking` | Feature 2 |
| `20260530202555` | `notifications_inbox` | Feature 3 |
| `20260530203052` | `progression_engine` | Feature 4 (v1.0) |
| `20260530203157` | `notification_guards_and_phase_upgrade` | Tier 1 |
| `20260530204349` | `advisor_hardening` | Tier 2 |
| `20260531123907` | `alt_exercise_substitute` | Feature 6 (column + index + trigger refresh + progression v1.1) |

(plus the 12 pre-existing migrations + 4 untracked ones noted in §1.4)

### 3.6 Security advisors — current state
- **15 warnings total** (12 pre-existing + 3 introduced by this work).
- 3 from this work are **all intentional** (gated internally):
  - `notify(authenticated)` callable — needed by `AltExercise.openModal` etc.
  - `reactivate_subscription(authenticated)` callable — needed by `SubscriptionService.reactivate`
  - `ensure_subscription_notifications(authenticated)` callable — needed by `Auth.init`
- 12 pre-existing warnings (is_admin, is_coach, get_my_role, etc.) are out of scope.

---

## 4 · Database schema changes summary

| Migration | Adds | Modifies |
|---|---|---|
| `subscription_grace` | view `v_client_subscription_state`, RPC `reactivate_subscription` | `subscriptions` += `grace_days int DEFAULT 7` |
| `workout_tracking` | tables `workout_sessions`, `workout_exercise_logs` + partial unique idx + trigger | — |
| `notifications_inbox` | tables `notifications`, `exercise_alternative_requests` + 6 triggers + RPC `notify` + RPC `ensure_subscription_notifications` | — |
| `progression_engine` | view `v_client_progression` + helper `_clamp_score` | — |
| `notification_guards_and_phase_upgrade` | helper `_profile_exists` + trigger `tg_profile_phase_upgrade` | recreates 6 notification trigger fns with FK guard |
| `advisor_hardening` | — | SET search_path on 3 helpers + REVOKE EXECUTE on 8 trigger fns and 3 anon-restrictions |

**Feature 5 added zero migrations.** Program JSON gained an optional `exercise_id` field at the `workouts[].{warmup,main,cooldown}[]` entry level — JSON shape evolution only.

---

## 5 · Completed features

See `FEATURE_STATUS.md` for the per-feature deep dive. Headline:

| Feature | Commits | Frozen? |
|---|---|---|
| F1 Subscription Grace | `4f65456` + `230f751` + `7265f09` | ✅ |
| F2 Workout Tracking | `4f65456` + `230f751` | ✅ |
| F3 Notifications + Alt + Retrofit | `4f65456` + `230f751` + `7265f09` | ✅ |
| F4 Progression v1 | `4f65456` + `230f751` | ✅ |
| Tier 1 (spec compliance + FK + Phase notif) | `7265f09` | — |
| Tier 2 (advisor hardening) | `230f751` | — |
| F5 Exercise Video Integration | `2627a11` | ✅ (signed off pre-F6) |
| F6 Alt-Exercise Replacement + Progression v1.1 | pending | Complete + smoke-verified, not formally frozen |

---

## 6 · Live-verified features

Every feature listed above was verified end-to-end against the live Supabase project:

- **F1:** Subscription view returns correct effective_status for the 2 live clients (active, 83d & 72d remaining).
- **F2:** Insert/upsert paths work; one-active-per-client unique constraint raises `23505` as designed; RLS scoped correctly.
- **F3:** `notify()` self-test round-trip; alt-exercise trigger chain (insert → coach notification, update → client notification); phase upgrade trigger emits `from_phase`/`to_phase`; `ensure_subscription_notifications` idempotent.
- **F4:** Score shifted 45.0 → 52.8 after one workout — matches formula exactly.
- **F5:** Coach publish with mixed linked + legacy rows; workout flow logs `exercise_id` for linked, null for legacy; analytics LEFT JOIN recovers library row for linked log.

All verification artifacts cleaned up. Production data unaffected.

---

## 7 · Outstanding gaps (priority-ordered)

Detail in `NEXT_STEPS.md §3` + `PRODUCT_AUDIT.md`. Headline:

1. **Reliability + Defect Sweep** (next per user direction Q4 — closes PRODUCT_AUDIT.md C1, C2, C3, C5 + high-severity TD3, TD4, TD5, TD10)
2. **Feature 7 — Assessment / 3D Hologram Integration** (also closes PRODUCT_AUDIT.md TD11)
3. Email/SMS push (high-severity notifications via Resend)
4. Notification deep-link pre-select on target loaders
5. Daily pg_cron for `ensure_subscription_notifications`
6. Progression v2 (nutrition + RPM phase signals — would be `v_client_progression` v2.0)
7. Nutrition Plan (whole new domain)
8. Smaller polish: unpublished-program indicator, skip tristate, username vs email, three competing coach-progress surfaces unification.

---

## 8 · Branch state

```
2627a11 feat(F5): Exercise Video Integration — zero migrations, JSON shape evolution   ← HEAD
230f751 verify(live): Path A complete — 7 migrations live + smoke-passed
1d97fbd docs(status): live verification halted at notifications collision
7265f09 fix(tier1): spec compliance + FK guards + phase upgrade notification
4f65456 feat(platform): Features 1-4 + verification report
defa453 fix(client-sidebar): gate New Session + Programs as role-coach-admin
59a7b48 feat(client): Chart.js metric panels (Force Steadiness, CoG, Risk Timeline)
34b131d feat(client): live Point A/B Load Visualizer + assessment-driven profile
f5cac7c feat(client): role-aware client dashboard scaffold (Phase A)
```

**Nothing pushed.** Working tree clean except for the three handoff docs being generated now.

---

## 9 · How to continue

Read in this order:

1. `PROJECT_STATUS.md` (this file) — for the big picture
2. `FEATURE_STATUS.md` — per-feature deep dive
3. `NEXT_STEPS.md` — recommended build order + Feature 6 architecture preview

The user's standing rule: **lock architecture before any code, one feature at a time, no scope drift.** Always propose architecture first, get a "go" or scope changes, then build.

For live Supabase work, the project ID is `byquokhcbagofshsclfy` and the MCP tools (`mcp__f0b78c38-76ea-4245-8df6-3f1d98401250__*`) are available via `ToolSearch`.

For files: every JS module is an IIFE that exposes a single `window.XYZ` global. Migrations live in `supabase/migrations/` with the date-prefixed naming convention. **Always use `apply_migration` (not `execute_sql`) for DDL** so the registry stays consistent.
