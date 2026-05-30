# PROJECT_STATUS.md — NeuCore Platform Verification

**Date:** 2026-05-30
**Scope:** Static end-to-end verification of Features 1–4 + full client-journey audit.
**Method:** Code-path tracing across every file touched + cross-checking schema/RLS/wiring. No live Supabase queries — every "Working" claim below is verifiable by inspecting the cited file path + line range.
**App shell:** `app.html` only. `index.html` (legacy AST9) is intentionally not in scope.

---

## 0 · Executive Summary

| Feature | Verdict | Confidence |
|---|---|---|
| Subscription Grace System | **✅ Working** with 2 minor wiring gaps | High |
| Workout Tracking          | **✅ Working** with 1 missing integration | High |
| Notifications             | **⚠ Partially Working** — 1 cross-module gap + 1 silent failure mode | High |
| Progression Engine        | **✅ Working** — formula v1 sound; coach overview depends on profiles RLS | High |
| **Full Client Journey**   | **⚠ 6 gaps**, mostly client-sidebar visibility + flow disconnects | High |

**No regressions** found in pre-existing modules. **No syntax errors** (all touched JS files pass `node --check`).

**Top blockers before next feature work:**
1. Client sidebar denies access to Case Studies + Settings (spec contradicts current `.role-*` gating)
2. Phase Upgrade flow bypasses the notifications inbox
3. Coach response to alt-exercise request doesn't modify the published program — only sends text
4. Two existing tables FK to `auth.users(id)` while new tables FK to `profiles(id)`, creating a hidden integrity dependency on profiles-mirroring-auth.users

---

## 1 · Feature 1 — Subscription Grace System

**Files**
`supabase/migrations/20260530_subscription_grace.sql`, `js/subscriptionService.js`, `js/auth.js`, `js/subscriptions.js`, `js/clientDashboard.js`, `app.html` (#screen-subscription-inactive, #sub-stat-grace, #subs-filter)

### Working ✅
- View `v_client_subscription_state` returns one row per client with correct `effective_status` enum (`active|grace|expired|pending`). `security_invoker=true` so RLS on `subscriptions` governs visibility.
- `SubscriptionService.getEffectiveState()` caches per-client for 30s; `listAllStates()` warms the cache while loading the coach table.
- `Auth.login` and `Auth.init` both call `_refreshSubscriptionState`; both throw `SubscriptionInactiveError {code:'SUBSCRIPTION_INACTIVE', state}`. Caller (UI.handleLogin + boot try/catch) routes to `#screen-subscription-inactive` and bypasses the toast path. **Verified by tracing `auth.js:88-95` + `auth.js:142-148` + `app.html:_showSubscriptionInactive`.**
- `Auth.canWrite()` returns true for `active|grace`, true for all non-client roles, false for `expired|pending|none`. Used by `WorkoutSession.start/finish/logExercise` + `AltExercise.openModal`.
- Coach Subscriptions page: 4 stat cards (Active / Expiring / Grace / Expired), filter chips (`all/active/grace/expired/pending`), clickable stat cards trigger same filter. Grace + Expired rows show "↺ Reactivate" button.
- Reactivation goes through `SubscriptionService.reactivate(clientId, {months})` which delegates to `SECURITY DEFINER` RPC `public.reactivate_subscription(...)`. Permission check (`admin OR assigned_coach`) lives in SQL.
- Client dashboard pill (`active`→teal, ≤14d→amber, grace→rose) + grace banner above hero with days-left + end-date + grace-until.

### Partially Working ⚠
- **Wiring gap A**: `Subscriptions.loadAll()` is called when the coach navigates to Subscriptions, but `_wireFilter()` ran once at DOMContentLoaded. If the user navigates to `#section-subscriptions` *after* re-rendering its markup (no current flow does this, but hot-reload would), filter chip handlers don't rebind. **Severity: low**, future-risk only.
- **Wiring gap B**: `app.html:_showApp` calls `Dashboard.populateProgressClientSelect?.()` but that function does not exist on `Dashboard` (grep returns no match). Silent no-op. Pre-existing, not introduced by Feature 1. **Severity: cosmetic**, but blocks the Progress Charts client dropdown from auto-populating.

### Broken ❌
None.

### Missing Integrations
- **Email/SMS push during grace**: out of scope per Feature 1 architecture lock, but worth noting again — Resend integration exists in `send-email` edge function, never invoked for grace.
- **Daily cron** to sweep all clients and populate subscription notifications — currently only fires on the client's own `auth.init`, so coaches don't get the "grace started" notification until *the client* logs in.

---

## 2 · Feature 2 — Workout Tracking

**Files**
`supabase/migrations/20260531_workout_tracking.sql`, `js/workoutSession.js`, `js/programPublish.js` (+ `js/dashboard.js`, `js/clients.js`, `app.html`)

### Working ✅
- Schema: `workout_sessions` + `workout_exercise_logs` with correct FKs to `profiles(id)` and `client_programs(id)`. Partial unique index `WHERE status='active'` enforces "one active session per client".
- RLS: client owns own rows; assigned_coach can read + insert + update; admin all. Logs inherit via parent session join.
- `WorkoutSession.start` auto-abandons a prior active session on a *different* workout key (resume semantics).
- `mountWorkouts` is called from `renderClientProgram` after every render; each `[data-workout-tracker-host="<id>"]` slot gets either a "▶ Start Workout" CTA or a live tracker (timer + per-exercise rows + Finish).
- Per-set inputs (reps + weight + "+ Add set"), "Done" checkbox, per-exercise notes — all upsert via `(session_id, exercise_index)` unique key with 600ms debounce.
- Finish modal: intensity 1–10 slider + notes → updates `duration_seconds + intensity_rating + session_notes + status='completed'`.
- Coach view: `mountCoachView` populates client dropdown (scoped by `assigned_coach` for non-admin), sessions table (When · Workout · Status · Duration · Intensity), set-by-set detail card.
- Deep-link: Clients table "◐ Workouts" button stashes `window._wsPreselectClient` and triggers section change; loader consumes + nulls the global.
- `Auth.canWrite()` short-circuit on every write call with toast "Read-only — subscription inactive."

### Partially Working ⚠
- **`WorkoutSession.start` coach_id derivation** uses `_coachOfClient(clientId)` which returns `Auth.getProfile()?.assigned_coach` *only for self*. For a coach inserting a session on behalf of a client (which RLS allows), `coach_id` becomes `null`. Existing flow doesn't expose this path in UI, but RLS technically permits it. **Severity: low**, hypothetical only.

### Broken ❌
None.

### Missing Integrations
- **Video preview inside the active workout row**: spec says each exercise should show its video preview. `client_programs.program.workouts[].exercises[]` currently stores exercise text only (no `exercise_id` linkage to the Exercise Library). Workout row renders name + target sets/reps but no thumbnail / no playback. Documented as deferred during Feature 2 architecture lock.
- **Workout history → Progress Charts crossover**: the existing `Charts.renderClientProgressPage(clientId)` doesn't read `workout_sessions` data. Workout history lives in its own section; the progression engine consumes the same data but the legacy Charts page doesn't. **Severity: medium** — two competing views of "progress".

---

## 3 · Feature 3 — Notifications + Alt-Exercise

**Files**
`supabase/migrations/20260601_notifications_inbox.sql`, `js/notificationsService.js`, `js/altExerciseRequest.js`, `js/workoutSession.js` (+ `js/dashboard.js`, `app.html`)

### Working ✅
- `notifications` table + `WITH CHECK (false)` direct-INSERT policy + `SECURITY DEFINER public.notify(...)` RPC with locked authorization rules (self ✓ admin ✓ coach→own client ✓ client→own coach ✓).
- `exercise_alternative_requests` table + client-INSERT policy + client-UPDATE-while-pending policy + coach-UPDATE policy.
- 6 triggers attached:
  - `tg_aer_insert` → notify coach with `alt_exercise_request`
  - `tg_aer_update` → notify client with `alt_exercise_decided`
  - `tg_phase_subm_insert` → notify graph.coach with `rpm_approval_pending`
  - `tg_phase_subm_update` → notify client with `rpm_approval_decided`
  - `tg_case_share_insert` → notify every admin
  - `tg_case_share_update` → notify submitting coach
- `ensure_subscription_notifications(client_id)` is idempotent (key = sub_id+type) and creates client + coach mirror entries on expiring/grace transitions. Called from `_showApp` on client init.
- `NotificationsService`: list/unreadCount/markRead/markAllRead/archive/remove, Supabase realtime channel + 60s polling fallback, `bindBell(el)` wires badge + click, `mountInbox(host)` with severity-colored rows, deep-link via `link_section`+`link_params`.
- `AltExercise.openModal(ctx)` writes a request row; trigger sends the notification. `AltExercise.mountInbox(host)` shows pending requests with Respond modal (Address/Decline + free-text response); trigger notifies the client.
- "⇄ Alt" mini-button is wired into every WorkoutSession exercise row with full ctx (programId, workoutKey, exerciseIndex, exerciseName).
- Bell in sidebar footer; `#section-notifications` with `#notifications-root` + coach-only `#alt-requests-root`.

### Partially Working ⚠
- **Deep-link destinations don't pre-select**: clicking a notification with `link_section='my-program'` and `link_params={request_id}` navigates to My Program, but `ProgramPublish.renderClientProgram` doesn't read `window._notifParams`. Same for `link_section='my-graph'`, `'rpm-approvals'`, `'subscriptions'`. User lands on the right page but has to find the specific item manually. **Severity: medium** (UX).
- **Realtime requires Supabase setup**: `NotificationsService._ensureChannel()` subscribes via `sb.channel(...)`. If Realtime isn't enabled on the `notifications` table in Supabase Studio → Database → Replication, the channel subscription silently degrades to 60s polling. Documented in migration but worth a one-time setup step. **Severity: low**.
- **Bell discoverability**: there's no `nav-notifications` sidebar entry. Inbox is reachable only via the bell or via a notification deep-link. **Severity: low** (cosmetic).

### Broken ❌
None at the code level. **Latent integrity risk:**
- `notifications.recipient_id` FKs to `profiles(id) NOT NULL`. But `rpm_graphs.coach_id` (line 147 of `20260515_rpm_foundation.sql`) and `case_shares.coach_id` (line 55 of `AST9_Phase3_Migrations.sql`) FK to `auth.users(id)`. If a coach exists in `auth.users` without a matching `profiles` row, `tg_phase_subm_notify_coach` / `tg_case_share_notify_admins` will fail with FK violation, **rolling back the source INSERT** (the client's phase submission or coach's case share). In practice Supabase's standard signup trigger keeps `profiles` mirrored to `auth.users`, but this is an implicit invariant. **Severity: medium** — defensive fix recommended (`ON CONFLICT DO NOTHING` won't help because the FK fires before INSERT; the right fix is to skip the notify when `EXISTS (SELECT 1 FROM profiles WHERE id = v_coach)`).

### Missing Integrations
- **Phase Upgrade modal does NOT notify**: `Dashboard.submitPhaseUpgrade` (dashboard.js:893) updates `profiles.current_phase` directly and sends the legacy `phase_upgrade` email. It does **not** insert a notification. So the celebration confetti shows on coach's screen, but the client doesn't get an inbox entry when they next log in. **Severity: high** — explicit spec requirement ("celebration message sent to client") only partially met.
- **Workout abandonment doesn't notify the coach**: when `WorkoutSession.start` auto-abandons a prior session, no notification fires. Spec didn't mandate this, but it would be a meaningful Recovery signal. **Severity: low**.
- **Notifications aren't ever auto-archived**: read items remain in the list forever. No retention policy. **Severity: low** (becomes medium at scale).

---

## 4 · Feature 4 — Progression Engine

**Files**
`supabase/migrations/20260602_progression_engine.sql`, `js/progressionEngine.js`, `js/dashboard.js`, `js/clientDashboard.js`, `app.html` (#section-progression, #cd-progression-host)

### Working ✅
- `v_client_progression` view with `security_invoker=true` → existing RLS on workout_sessions / daily_routine_logs / exercise_alternative_requests governs row visibility per user.
- Formula v1.0 documented in the migration; carries `formula_version` column so reweight ships as v2 alongside v1.
- All four scores compute correctly per the documented math:
  - Compliance = 0.4·workout_completion + 0.4·routine + 0.2·exercise_completion
  - Recovery = 100 − 10·overreach − 30·abandonment_rate − 5·alt_requests, clamped
  - Performance = mean per-exercise (top-set Δ in window), mapped −20%↔+50% → 40↔100; defaults to 50 (neutral) when no qualifying data
  - Overall = 0.4·Compliance + 0.3·Recovery + 0.3·Performance
- `_clamp_score(v)` helper + COALESCE on every signal — null-safe.
- `Progression.mountClientPanel(host)` renders four inline-SVG semicircular gauges + tone palette (≥80 teal, ≥60 lime, ≥40 amber, ≥20 orange, <20 rose) + supporting micro-stats per gauge + 7-day routine delta line + version stamp.
- `Progression.mountCoachOverview(host)` lists all clients (one extra round-trip to `profiles` for names) with sortable columns + click-to-detail. Detail panel includes the four gauges + the full Signal Breakdown grid.

### Partially Working ⚠
- **Performance score is mostly 50/neutral** because typical NeuCore rehab programs rotate exercises and rarely repeat the same exercise 3× in 30 days. By design the engine returns 50 when `exercises_tracked_30d < 3`, but in practice this means Performance carries almost no signal for Phase 1/2 clients. **Severity: medium** — the score appears stable but is not actually measuring anything for most users. Worth re-weighting in v2 once nutrition + RPM-phase-advancement signals exist.
- **Compliance "12 workouts/30d" target** (≈3/week) is too aggressive for rehab Phase 1 clients (whose programs are often 1–2 days/week). Currently a Phase 1 client doing exactly what's prescribed scores 17–33% on the workout slice. **Severity: medium** — recommend deriving the target from `client_programs.program.days_per_week` in v2.

### Broken ❌
None.

### Missing Integrations
- **Nutrition signal**: no `nutrition_logs` table exists, so the engine has no nutrition input — Compliance is technically a "workout + routine" composite. Spec called out four trackers (Workout, Routine, Nutrition, combined). **Severity: high** — Compliance score is misnamed until nutrition lands.
- **Historical snapshots**: no `progression_history` table. Today's view always reads from live data; there's no record of what a client's overall score was last week. The pre-existing `progress_snapshots` table (AST9_Phase3_Migrations.sql) stores per-assessment ROM/control/force/neuro scores — *different concept*, not used here. **Severity: medium** — blocks any "your score went up 8 points this week" UX.
- **Phase progression signal**: client advancing phases (Phase 1 → 2 → 3) is currently captured in `profiles.current_phase` but not consumed by the engine. **Severity: low**.

---

## 5 · Full Client Journey Audit

> Path: **Coach creates Client → Client logs in → Assessment view → Program view → Workout completion → Progress tracking**

### Step 1 — Coach Creates Client
**File:** `js/clients.js:67-117` (`submitAddClient`)

| Status | Finding |
|---|---|
| ✅ | Modal collects name, email, temporary password, age, phase, phone, coach, goal |
| ✅ | Calls Supabase edge function `/functions/v1/create-user` with bearer token; creates auth user + profiles row with `role='client'`, `assigned_coach`, etc. |
| ✅ | Refreshes client list + dropdowns after success |
| ⚠ | **Spec says "Create Username"**; current flow uses email as the auth identifier (Supabase Auth requires email). No `username` column exists. **Gap A.** |
| ⚠ | **Spec says "Select Subscription Type / Duration / Activate Subscription" in the same flow**; current Add Client modal does NOT create a subscription. Coach must separately open the New Subscription modal and link the client. **Gap B.** |
| ❌ | No assigned_coach validation: if coach is left blank, client is created with `assigned_coach=null`. Downstream: `AltExercise.openModal` blocks ("No coach assigned"), `WorkoutSession.start` writes `coach_id=null` (allowed by RLS), grace-period notifications skip the coach side. **Gap C.** |

### Step 2 — Client Login
**File:** `js/auth.js:60-110`, `app.html:UI.handleLogin`

| Status | Finding |
|---|---|
| ✅ | Email + password authenticate against Supabase |
| ✅ | Subscription state cached on `_profile.subscription` |
| ✅ | Active + Grace pass; Expired/Pending/None routed to dedicated `#screen-subscription-inactive` (Feature 1) |
| ✅ | Cold-start retry pattern handles paused Supabase instances |
| ⚠ | "Continue as Demo" button (`Auth.loginAsGuest`) is referenced from `app.html:69` but `Auth.loginAsGuest` does NOT exist on the Auth IIFE. Click → TypeError. **Pre-existing bug; not introduced by recent features. Gap D.** |

### Step 3 — Assessment View (client side)
**File:** `js/clientDashboard.js`, `src/neucore/client/*`

| Status | Finding |
|---|---|
| ✅ | Client lands on `#section-client-dashboard` (role-aware routing) |
| ✅ | Welcome header + subscription pill + grace banner (Feature 1) + Progress gauges (Feature 4) + Point A/B LoadVisualizer + 3 metric Chart.js panels (Force Steadiness / CoG / Risk Timeline) |
| ⚠ | **Assessment Report card placeholder** (`cd-assessment` div) still shows "Loading…" hardcoded text. `loadProfile + loadGait` fetch the data but the assessment narrative + coach's notes + reported symptoms never get written into the DOM. **Severity: medium. Gap E.** |
| ⚠ | "Peer Success Gallery" card still says "Coming soon". Stub from Phase A. **Severity: low.** |
| ❌ | No way for the client to see their **RPM Reactive Graph** unless they discover the `nav-my-graph` sidebar item — and the My Graph section renders only if `RPMGraphViewer.init()` is wired. |

### Step 4 — Program View
**File:** `js/programPublish.js:330-450` (`renderClientProgram`), wired via `js/dashboard.js:120`

| Status | Finding |
|---|---|
| ✅ | Reads `client_programs` (published only); shows phase, days/week, schedule chips, each workout with warmup/main/cooldown sections |
| ✅ | After render, mounts `WorkoutSession.mountWorkouts(...)` so each workout has a Start/Finish slot |
| ❌ | **Coach must publish before client sees anything.** The publish action lives in `programPublish.js` (after Generate in New Session). If the coach hits Generate but doesn't click Publish, `client_programs.published=false` and the client sees "No program published yet". No UI indication on the coach side that "this client has unpublished changes". **Gap F.** |
| ❌ | **Exercise videos not surfaced.** Library has `video_url` per exercise; the program JSON has plain text exercise names. No exercise_id linkage. Documented in Features 2 + 3 as deferred. **Gap G.** |
| ⚠ | **No "Notes from coach" or "Day name" override.** The published structure is what the rule-based generator produced; per-day labeling (e.g. "Push Day") doesn't survive publish unless the coach manually edits in the review panel. |

### Step 5 — Workout Completion
**File:** `js/workoutSession.js`

| Status | Finding |
|---|---|
| ✅ | Start Workout → row inserted with `status='active'` |
| ✅ | Live timer, per-exercise sets/reps/weight inputs, debounced auto-save |
| ✅ | Done checkbox, "+ Add set", per-exercise notes |
| ✅ | "⇄ Alt" button → AltExercise modal (Feature 3) |
| ✅ | Finish modal → intensity rating + workout notes, closes row with `duration_seconds + status='completed'` |
| ✅ | Refresh / re-navigate resumes the active session from DB (one-active-per-client invariant) |
| ⚠ | **No way to delete a partial set without page reload**: "+ Add set" creates a row; there's no "−" button. **Severity: low.** |
| ⚠ | **Coach response to alt-request doesn't modify the program.** Coach can say "do X instead" in free text; client sees the text in their inbox notification, but the exercise in their next workout is still the original. **Gap H.** |
| ❌ | **No way to skip an exercise.** Done checkbox marks it completed; unchecking it means "still doing", not "skipped". No tristate. Progression engine treats unchecked as incomplete, even if the client deliberately skipped (e.g. equipment unavailable). **Severity: low.** |

### Step 6 — Progress Tracking (client side)
**File:** `js/progressionEngine.js:mountClientPanel`, `js/clientDashboard.js`

| Status | Finding |
|---|---|
| ✅ | Four gauges render on client dashboard above the metrics grid |
| ✅ | Each gauge shows score + supporting micro-stat + tone-coded label |
| ✅ | 7-day routine delta visible |
| ⚠ | **No historical trendline** — client sees today's score in isolation. No way to know if they're improving or regressing over the last 30/90 days. Tied to missing `progression_history` table. **Gap I.** |
| ⚠ | **Performance score is meaningless for most clients today** (default 50 / no qualifying data — see Feature 4 partial-working). **Gap J.** |

### Step 7 — Coach views Client Progress
**Files:** `js/progressionEngine.js:mountCoachOverview` + `js/workoutSession.js:mountCoachView` + `js/charts.js:renderClientProgressPage`

| Status | Finding |
|---|---|
| ✅ | Coach sidebar Progression entry → overview table → click-row → detail |
| ✅ | Coach sidebar Workout History entry → client picker → sessions → detail |
| ⚠ | **Three competing surfaces** for "client progress":<br>1. **Progression** (new, Feature 4) — 4 scores<br>2. **Workout History** (new, Feature 2) — set-by-set<br>3. **Progress Charts** (existing) — per-assessment ROM/control/force/neuro snapshots, plus PDF export<br>None of these cross-link. Coach has to context-switch. **Gap K.** |
| ❌ | **Progress Charts client dropdown never populates** because `Dashboard.populateProgressClientSelect` is referenced (`app.html:_showApp`) but doesn't exist on `Dashboard`. Optional chaining silently no-ops. **Pre-existing bug. Gap L.** |

---

## 6 · Client Sidebar Coverage vs Spec

Original spec sidebar for clients:

| Spec item | Sidebar nav exists? | Role gating | Status |
|---|---|---|---|
| Program | ✅ `nav-my-program` | `role-client-only` | OK |
| Daily Routine | ✅ `nav-daily-routine` | none (visible to all) | OK — though coaches see it too |
| Nutrition Plan | ✅ `nav-nutrition-plan` | `role-client-only` | Stub UI |
| Community | ✅ `nav-community` | none | OK |
| **Case Studies** | ✅ `nav-case-studies` | **`role-coach-admin`** ❌ | **Client cannot reach Case Studies from sidebar.** Spec violation. **Gap M.** |
| **Settings** | ✅ `nav-settings` | **`role-admin-only`** ❌ | **Client cannot change password from sidebar.** Spec violation. **Gap N.** |

Bonus client items present but unmentioned by spec: My Reactive Graph (`nav-my-graph`), Dashboard (the role-aware home).

---

## 7 · Consolidated Gap List (priority-ordered)

| ID | Gap | Severity | Fix effort | Where |
|---|---|---|---|---|
| **N** | Client cannot change password from sidebar (`nav-settings` is `role-admin-only`) | 🔴 High — explicit spec | XS — flip role class + clone a settings card | `app.html:219` + new `#section-client-settings` |
| **M** | Client cannot reach Case Studies (`nav-case-studies` is `role-coach-admin`) | 🔴 High — explicit spec | XS — remove role class | `app.html:192` |
| **F** | No "unpublished changes" indicator on coach side; client sees empty Program until coach manually publishes | 🟠 Medium | S | `js/programPublish.js` + Clients table column |
| **G** | Exercise videos missing inside My Program / WorkoutSession rows | 🟠 Medium | M — needs `exercise_id` threaded through `client_programs.program.workouts[].exercises[]` + ProgramPublish editor + Workout row template | `js/programGenerator.js`, `js/programPublish.js`, `js/workoutSession.js` |
| **H** | Coach alt-exercise response = text only, doesn't substitute the exercise in the program | 🟠 Medium | M — add "Suggest substitute (from library)" to the Respond modal + persist substitution | `js/altExerciseRequest.js` + new field on `exercise_alternative_requests` |
| **E** | Client dashboard Assessment Report card hardcoded "Loading…" — never wired to data | 🟠 Medium | S | `js/clientDashboard.js` |
| **K** | Three competing coach surfaces for "client progress" with no cross-links | 🟠 Medium | S — add a "More on this client" link section pointing to the other two | `js/progressionEngine.js` + `js/workoutSession.js` + `js/charts.js` |
| **C** | New client created with `assigned_coach=null` if coach not picked → alt-exercise blocked, grace notifications skip coach | 🟡 Low | XS — required field validation in modal | `js/clients.js:79` |
| **L** | `Dashboard.populateProgressClientSelect` doesn't exist; called at boot, silent no-op | 🟡 Low | XS | `js/dashboard.js` (add function) |
| **D** | "Continue as Demo" calls `Auth.loginAsGuest` which doesn't exist → TypeError | 🟡 Low | XS — either implement guest or remove the link | `js/auth.js` or `app.html:69` |
| **I** | No historical progression trendline; clients see today only | 🟡 Low | M — needs `progression_history` snapshot table + nightly capture | new migration + new module |
| **J** | Performance score is mostly meaningless (defaults to 50 for most clients) | 🟡 Low | M — re-weight in v2 or derive from RPM phase advancement | new migration `_progression_v2.sql` |
| Phase Upgrade ↦ no inbox notification | "celebration sent to client" partially met | 🟠 Medium | XS — add one `public.notify(...)` call | `js/dashboard.js:893 submitPhaseUpgrade` |
| FK invariant — `rpm_graphs.coach_id` + `case_shares.coach_id` ref `auth.users` but notifications ref `profiles` | 🟡 Low (latent) | S — guard with EXISTS before notify | `supabase/migrations/20260601_notifications_inbox.sql` triggers |
| Bell has no sidebar entry for discoverability | 🟡 Low — cosmetic | XS | `app.html` sidebar |
| **A** | Spec wants "Create Username" — currently email-only | 🟡 Low — spec misalignment | S — add `username` column + login resolver | migration + `auth.js` |
| **B** | Coach Add Client doesn't create subscription in same flow | 🟡 Low | S — extend modal with sub fields | `js/clients.js` + `app.html` |
| Notification deep-link doesn't pre-select target item | 🟡 Low | S | individual loaders read `window._notifParams` |
| Nutrition signal missing → Compliance is mis-labeled | 🟠 Medium (Future) | L — whole nutrition feature | future feature |

---

## 8 · Recommended Sequence Before Any New Feature

The verification produced **6 small fixes** that don't deserve their own "feature" but that unblock the spec compliance the platform currently fails:

**Tier 1 (1–2 hours total)** — pure-spec compliance, no architecture:
1. **N** + **M** — flip sidebar role classes so clients see Case Studies + Settings (5 min)
2. **D** — either implement `Auth.loginAsGuest` or remove the demo link (5 min)
3. **L** — implement `Dashboard.populateProgressClientSelect` (10 min)
4. **C** — make `assigned_coach` required in Add Client modal (10 min)
5. **Phase Upgrade → Notification** — add one `public.notify(...)` call to `submitPhaseUpgrade` (15 min)
6. **FK guard** — wrap each trigger's notify call in `IF EXISTS (SELECT 1 FROM profiles WHERE id = v_recipient)` (20 min)

**Tier 2 (½ day)** — UX completeness for already-built features:
7. **E** — wire the Assessment Report card on client dashboard to real data
8. **F** — coach-side "unpublished changes" badge + Clients-table column
9. Notification deep-link pre-select for the three loaders (`my-program`, `rpm-approvals`, `subscriptions`)

**Tier 3 (1+ day each)** — features in their own right:
10. **G** — thread `exercise_id` through programs + surface videos in WorkoutSession rows
11. **H** — coach response modal with substitute-exercise picker
12. **K** — cross-links between Progression / Workout History / Progress Charts
13. **I** — progression_history snapshot table + trendline
14. Nutrition Plan (full feature; will rename Compliance correctly)
15. Daily cron for subscription notifications (coach side gets grace alerts independent of client login)

Recommendation: ship **Tier 1 in one commit** (zero architectural risk, closes 6 spec-compliance gaps), get sign-off, then choose Tier 2/3 priorities.

---

## 9 · Verdict

**Stop-and-fix justified.** Before building Feature 5, the platform should clear at least Tier 1 — every item is small, every item closes a real spec gap, and three of them (M, N, D) directly contradict what the platform claims to deliver to clients.

Features 1–4 themselves are sound. The verification did **not** uncover any broken code path inside the four features as designed. The friction is at the **seams**: between the new features and the legacy modules (Phase Upgrade, Progress Charts, Add Client), and between the spec and the existing sidebar role classes.

No further feature implementation pending your review of this report.
