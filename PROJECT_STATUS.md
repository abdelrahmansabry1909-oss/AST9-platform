# PROJECT_STATUS.md — NeuCore Platform

**Last updated:** 2026-06-09
**Branch:** `claude/interesting-buck-452459`
**HEAD commit:** Client Mobile Redesign S6 just shipped (commit pending)
**Worktree path:** `D:\ASThub\.claude\worktrees\interesting-buck-452459`
**Origin repo:** `https://github.com/abdelrahmansabry1909-oss/AST9_HUB.git`
**Live Supabase project:** `byquokhcbagofshsclfy` (eu-central-1, Postgres 17.6.1.111, ACTIVE_HEALTHY)

> This document is a **handoff snapshot.** A future Claude session reading this + `FEATURE_STATUS.md` + `NEXT_STEPS.md` has every fact needed to continue without rebuilding context.

---

## 0 · One-line summary

6 features shipped + 2 hardening passes + 1 reliability sweep + 1 stabilization pass + Feature 7 (Assessment / 3D Hologram) + the **Client Mobile Redesign (S0–S6)** + 10 migrations live + full end-to-end live verification. **Features 1–6 + Reliability Sweep frozen by user signoff; F7 live. The Client Mobile Redesign replaced the client desktop-sidebar experience with a mobile-first, dark, calm 5-tab app (Today · Train · Progress · Coach · More), built S0→S6 one commit per step, presentation-layer only, coach/admin desktop untouched, and audited production-ready in S6 (one Low defect found and fixed, no Critical/High/Medium). See `CLIENT_DASHBOARD_MOBILE_REDESIGN.md` §11–13. Next: Feature 8 (Recovery Pulse, designed in `FEATURE_8_PROPOSAL.md`) or address pre-existing audit item H-1 (client-side-only write-gate).**

---

## 0.1 · ✅ RESOLVED (2026-06-11) — global coach `profiles` visibility (Option A applied)

**Status:** CLOSED · migration `20260611063848_option_a_profiles_select_scoped.sql` live (rollback paired in `rollbacks/`).
**Reference:** full analysis in `FEATURE8_COACH_VISIBILITY_RLS_PLAN.md` (Option A).

**What shipped.** The global-for-staff SELECT policy was replaced with `profiles_select_scoped`: **everyone → own row · admin → all · coach → assigned clients + staff directory (role coach/admin)**. Clients keep exactly the prior visibility (own row only — the coach name was already resolved from the client's own denormalized `assigned_coach`/`coach_name` columns, so no client→coach policy branch was needed). No `SECURITY DEFINER` helper had to be added: the policy uses only direct columns plus the existing definer helpers `is_admin()`/`is_coach()`, so there is no `profiles` self-query and no recursion. All ~30 dependent policies on other tables were verified live to use only assigned-coach lookups or own-row role checks — both still satisfied. Verified by JWT-impersonation SQL (coach 10→8 rows, 0 unassigned clients; client 1 row; admin 10) plus a 9/9 authenticated production browser regression (coach clients/subscriptions/community + client Today), 0 console errors.

**Residual accepted degradations (documented, graceful fallbacks in UI):** incoming referral cards show "Unknown client" until referrals implement assignment transfer (feature already deferred/broken); a coach browsing community posts of non-assigned clients sees "Member"/"User" as author names.

<details><summary>Original analysis (historical)</summary>

**The issue.** The `profiles` SELECT policy is global for staff — `is_admin_or_coach() OR id = auth.uid()`. So **any `coach` can read every client's full profile/PII** (`full_name, email, phone, age, goal, injury_history`) via `clients.js` (`loadAll` → `select('*').eq('role','client')`), the dashboard client lists/counts, and the client pickers. Every *other* per-client table (`workout_sessions`, `daily_routine_logs`, `progress_snapshots`, `subscriptions`, `client_programs`) is already assigned-coach scoped — `profiles` is the lone global-for-staff outlier.

**Why deferred (not fixed now).** Latent today: production has **1 admin, 0 real coaches**, and the admin is legitimately allowed to see all. The Feature-8 symptom was contained surgically without the platform-wide blast radius (see below). The full fix touches ~10 read paths and can break community/messaging — it deserves its own phase + regression.

**Already contained (Feature 8 only, 2026-06-09).** `v_client_pulse` is now explicitly scoped to `is_admin() OR client_id = auth.uid() OR assigned_coach = auth.uid()` (migration `20260609180000_feature8_v_client_pulse_scope.sql`; rollback paired). The coach Needs Attention panel is now assigned-scoped. **`profiles` was deliberately NOT touched.**

**Trigger — do this BEFORE creating any real `coach` account.** Once a non-admin coach exists, the PII exposure is live in production.

**Modules that depend on the current global `profiles` read (must keep working after a fix):**
- `clients.js` Clients table (`loadAll`) — should become assigned-scoped for coaches.
- `dashboard.js` client lists/counts (lines ~216/327/436/980/1002/1048).
- client pickers: `workoutSession.js:614`, `dailyRoutine.js:429`, `rpm/graph-builder.js:112`.
- **community / messaging (highest risk):** `communityUI.js:153` (client reads its *coach's* profile for the thread name), `community.js:490` `loadOtherCoaches` (coach reads other staff), `communityUI.js:330` referral select.

**Flows that break if tightened incorrectly:** client community thread shows "Coach" instead of the real coach name; coach↔coach messaging / referral dropdowns go empty; coach client pickers/counts empty; `profiles`-policy **recursion** if the new policy self-selects `profiles`.

**Recommended future direction (Option A):**
1. Replace the single global SELECT policy with role-aware policies: **admin = all** · **coach = assigned clients + self + other staff (coach/admin)** · **client = self + own assigned coach**.
2. Add a `SECURITY DEFINER` helper (e.g. `my_assigned_coach()`) so the policy reads the caller's `assigned_coach` without `profiles`-policy recursion.
3. Scope `v_client_progression` the same way (its `progressionEngine.listAll()` consumer also enumerates all clients to a coach).
4. Full community/messaging + pickers regression; paired rollback restoring the single original policy.

</details>

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
  - **⚠ Update (2026-06-10, Phase A/A3):** drift can also run the OTHER way — `20260516000000_rpm_phase5` was **registered but its DDL was never applied** (live DB had neither `rpm_phases.target_regions` nor `rpm_phase_messages`), which made the RPM Graph "Generate" button fail on every save. Contents applied 2026-06-10 (additive only); paired rollback at `supabase/rollbacks/20260516000000_rpm_phase5_down.sql`. Lesson: verify *objects*, not registry rows.
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
| (pending) | `sessions_rls_tighten` | Stabilization Pass — RLS hardening + supporting index for assigned_coach EXISTS |
| (pending) | `profiles_assigned_coach_index` | Stabilization Pass — partial index supporting EXISTS subqueries reused across 6 tables |

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
| F6 Alt-Exercise Replacement + Progression v1.1 | `9a8f68b` | ✅ (signed off post-F6) |
| Reliability + Defect Sweep (A→D + Highs) | `7ffb20a` | ✅ (signed off post-Sweep) |
| System Stabilization Pass (RLS + LS excision + empties) | pending | Complete + smoke-verified, not formally frozen |

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

1. ✅ **Reliability + Defect Sweep** — DONE (closed C1, C2, C3, C5, H1, H2, H3, H5, H7)
2. ✅ **System Stabilization Pass** — DONE (closed the sessions RLS leak server-side + removed all remaining LS dual-source paths + normalized empty states)
3. ✅ **Feature 7 — Assessment / 3D Hologram Integration** — DONE (S1–S4): fixed the dead data path, shared AssessmentSnapshot loader/renderer, client hero + coach Recovery parity (procedural skeleton)
4. **Deferred Highs** — H4 (client workout history), H6 (coach reassignment UI), H8 (onboarding flows)
5. **Logged follow-ups from Stabilization** — BEFORE UPDATE trigger pinning `sessions.client_id` + `coach_id` immutability; upstream "offline mode" detection that disables write surfaces when SB unreachable
5. Email/SMS push (high-severity notifications via Resend)
6. Notification deep-link pre-select on target loaders
7. Daily pg_cron for `ensure_subscription_notifications`
8. Progression v2 (nutrition + RPM phase signals — would be `v_client_progression` v2.0)
9. Nutrition Plan (whole new domain)
10. Smaller polish: unpublished-program indicator, skip tristate, username vs email, three competing coach-progress surfaces unification, all the Medium items from PRODUCT_AUDIT.md.

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
