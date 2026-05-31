# NeuCore — Full System Audit & Reconstruction Review

**Scope:** Frontend (vanilla JS IIFE modules + `app.html`) · Supabase Postgres 17 schema · RLS · SECURITY DEFINER RPCs · triggers · views · edge functions.
**Mode:** Read-only engineering audit. No features, no schema changes, no refactors. Findings are grounded in live DB introspection (project `byquokhcbagofshsclfy`) cross-checked against repo source on branch `claude/interesting-buck-452459`.
**Date:** 2026-05-31.

---

## 1. System Architecture Breakdown

### 1.1 Layers

| Layer | Implementation | Source of truth |
|---|---|---|
| Auth + session | `js/auth.js` over `sb.auth` (Supabase GoTrue) | `auth.users` + `public.profiles` |
| Authorization | Postgres RLS on all 49 public tables (all `rls_enabled=true`) + `is_admin()/is_coach()/is_admin_or_coach()/get_my_role()` SECURITY DEFINER helpers | DB |
| Client runtime | `window.*` global modules, no bundler. Load order in `app.html` matters (e.g. `Dashboard.emptyState` must exist before `clientDashboard.js`/`progressionEngine.js` call it) | — |
| Subscription gate | `js/subscriptionService.js` → view `v_client_subscription_state`; renewal only via `reactivate_subscription()` RPC | `subscriptions` table + view |
| Programs (coach authoring) | `js/programGenerator.js` + `js/programPublish.js` → `client_programs.program` JSONB (immutable once published) | `client_programs` |
| Programs (client view) | `programPublish.renderClientProgram` + F6 override layer | `client_programs` + `exercise_alternative_requests` |
| Daily routine | `js/dailyRoutine.js` → `daily_routine_logs` (one row per client/day), `client_routines` for the published task list | DB (localStorage fully removed) |
| Workout tracking | `js/workoutSession.js` → `workout_sessions` (1 active/client) + `workout_exercise_logs` (upsert on `session_id,exercise_index`) | DB |
| Progression scoring | View `v_client_progression` (formula **v1.1**, all math in SQL); `js/progressionEngine.js` is pure presentation | DB view |
| Notifications | Insert-locked `notifications` table (`WITH CHECK false`); all writes via `notify()` RPC fired from DB triggers; `js/notificationsService.js` reads/realtime/poll | DB |
| Alt-exercise / substitution (F6) | `js/altExerciseRequest.js` + override layer in publish/tracker; `tg_aer_*` triggers notify | `exercise_alternative_requests` |

### 1.2 Tenancy model — **two competing idioms** (see §5.1)

- **Idiom A (correct, newer — F1–F6 era):** scoped by `coach_id = auth.uid()` **OR** `EXISTS (profiles p WHERE p.id = <tbl>.client_id AND p.assigned_coach = auth.uid())` **OR** `is_admin()`. Used by `client_programs`, `client_routines`, `workout_sessions`, `workout_exercise_logs`, `sessions`, `exercise_alternative_requests`, `notifications`.
- **Idiom B (coarse, legacy — initial schema):** scoped by **role only** — `EXISTS (profiles WHERE id=auth.uid() AND role IN ('coach','admin'))` or `is_admin_or_coach()`. Used by `assessments`, `body_map_states`, `gait_assessments`, `rehab_objective_assessments`, `progress_logs`, `progress_snapshots`, `subscriptions`, and a leftover policy on `daily_routine_logs`.

Idiom B means **any coach can see/modify any client's data** in those tables. This is the dominant architectural weakness.

### 1.3 RPC / trigger correctness (audited, **sound**)

- `notify()` — self-guards: actor must be recipient, admin, the recipient's coach, or the recipient's client. Good.
- `reactivate_subscription()` — self-guards: caller must be admin or the client's assigned coach. Good. (But the `subscriptions` table is *also* directly writable — see §4 H2.)
- `tg_aer_notify_client/coach`, `tg_profile_phase_upgrade`, `tg_case_*`, `tg_phase_subm_*` — all `SECURITY DEFINER`, `search_path=public`, guard with `_profile_exists()`, and route through `notify()`. Substitute-aware body in `tg_aer_notify_client` matches F6 spec. Good.
- `v_client_subscription_state` — picks latest sub per client (`row_number()` by `end_date desc, created_at desc`), computes `active/grace/expired/pending` correctly against `current_date`. Good.
- `v_client_progression` v1.1 — Compliance 0.4/0.4/0.2, Recovery penalises overreach + abandon-rate + (non-substituted) alt requests, Performance from volume deltas (≥3 sessions), Overall 0.4/0.3/0.3. The `alt` CTE correctly **excludes** `status='addressed' AND substitute_exercise_id IS NOT NULL` so honoured substitutions don't hurt Recovery (matches F6 Q1). Good.

---

## 2. Flow-by-Flow Analysis

### 2.1 Auth → role routing → dashboard
1. `Auth.login()` → `signInWithPassword` (75s timeout + one wake-retry for paused projects) → `loadProfile()` selects `profiles` row (falls back to a synthetic client profile if the row is missing).
2. For `role==='client'`, `_refreshSubscriptionState()` reads the view; `active|grace` pass, everything else throws `SubscriptionInactiveError` and signs out.
3. Role accessor drives section rendering; `clientDashboard.js` owns the client home, `dashboard.js` owns coach/admin.
- **Risk:** `loadProfile` fallback fabricates `role` from `user_metadata`. If the `profiles` row read fails transiently (not just "missing"), a real client could be treated with default `role='client'` — benign here, but the fallback can't distinguish "new user" from "read error." Low.
- **Risk:** `_refreshSubscriptionState` fails **open** when `SubscriptionService` is undefined (`effective_status:'active', _unverified:true`). Acceptable dev affordance; document it.

### 2.2 Coach: create client → assign program → respond to alt → upgrade phase
- **Create client:** `clients.js submitAddClient` → `create-user` edge function (service role) sets `assigned_coach`, `current_phase`, etc. Correct (RLS would otherwise block coach-created profiles; the `Admins insert profiles` policy requires `get_my_role() IN (admin,coach)` for direct inserts, but creation is routed through the function).
- **Assign/publish program:** `programPublish._publish()` upserts `client_programs`/`client_routines` (unique on `client_id` — verified), then **republish sweep** closes active substitutions (`status='declined'`, body "Closed — Program Republished") firing one client notification each. Sound. JSON immutability preserved (override layer never mutates stored program).
- **Respond to alt request:** `altExerciseRequest._openResponseModal` → updates row with `status`, `coach_response`, `substitute_exercise_id`; `tg_aer_update` notifies client. UI enforces "declined carries no substitute." Sound.
- **Upgrade phase:** `clients.prepPhaseUpgrade` (coach button) → `dashboard.submitPhaseUpgrade` → **direct `UPDATE profiles SET current_phase`**. ⛔ **This is where the system breaks for non-admin coaches — see §4 C1.**

### 2.3 Client: program → workout → logs → progression
- `renderClientProgram` reads published program, applies F6 substitution override (most-recent per `workout_key|exercise_index`), resolves library metadata once, renders read-only with "🔄 Substituted" badge. Sound.
- `WorkoutSession.start/finish/logExercise` all gate on `Auth.canWrite()`; upsert key verified; one-active-session invariant enforced by auto-abandon. Sound.
- Daily routine persists per day (`upsert` on `client_id,log_date` — verified); streak computed client-side; `saveLog` now **throws** when SB is unavailable (no silent drop). Sound.
- Progression: view aggregates last 30/7 days; presentation-only client. Sound. Recompute-per-request (no materialization) is fine at current scale.
- **Bug (Medium):** after `start()`, `_renderTrackerSlot` re-mounts via `mountWorkouts(host, { programId, workouts: host._workouts || [workout] })`. `renderClientProgram` never sets `host._workouts`, and **`libMap` is not threaded into the re-render** → on the slot that just started, exercise media, instructions, and the substitution badge disappear until a full page reload. See §4 H4.

### 2.4 Notifications
- Triggers → `notify()` → row insert; client reads via realtime channel filtered to `recipient_id`, with 60s poll fallback. Deep-linking via `link_section`/`link_params` → `Dashboard.showSection`. `markRead`/`archive`/`remove` scoped by RLS (`recipient_id=auth.uid() OR is_admin()`). Sound. Direct inserts blocked (`WITH CHECK false`). Good.

---

## 3. Full Test Suite

> Notation: **I** input · **E** expected output · **Δ** data/UI state change · **F** failure cases. "as coach C1", "client of C2" etc. denote auth context. These are designed as executable specs (Supabase SQL/PostgREST + DOM). No test code is shipped per audit rules.

### 3.1 Unit tests

**U-AUTH**
- U-AUTH-1 `_gateClient`: I `{effective_status:'grace'}` → E `true`; I `'expired'`→`false`; I `undefined`→`false`. F: null state must not throw.
- U-AUTH-2 `canWrite`: coach profile → `true` regardless of sub; client `active`→`true`; client `expired`→`false`; `SubscriptionService` undefined + client → `true` (documented fail-open). Δ none.
- U-AUTH-3 `login` paused-project path: first call rejects `timed out` → retried once after 3s. F: non-network error must NOT retry (rethrow).
- U-AUTH-4 `loadProfile` missing row → synthetic profile with `role` from `user_metadata`. F: read **error** (not absence) currently indistinguishable — assert documented behavior.

**U-SUB**
- U-SUB-1 `v_client_subscription_state` effective_status matrix: build rows for `end_date` = +10d / today / -3d(grace 7) / -30d / status='pending' → E `active/active/grace/expired/pending`. Δ none (view).
- U-SUB-2 `formatPill`: `active` d>14 teal, 1–14 amber, today amber; `grace` rose with singular/plural day; `expired`/`none` correct.
- U-SUB-3 `reactivate(months)`: only 3/6/12 allowed; else throws. Δ on success: new `subscriptions` row, cache invalidated.

**U-PROG (view math)**
- U-PROG-1 Compliance: 12 completed workouts + 100% routine + 100% ex-completion → E `100`. Zero activity → `0`.
- U-PROG-2 Recovery: 0 overreach, 0 abandon, 0 alt → `100`; 2 overreach → `80`; 1 abandoned of 2 started → `-15` term → clamps ≥0.
- U-PROG-3 Recovery substitution exclusion: one `addressed`+substitute alt request must **not** decrement Recovery; one `pending` alt request **must** (-5).
- U-PROG-4 Performance: needs ≥3 sessions/exercise; first→last volume delta clamped [-0.20,0.50]. <3 sessions → `performance` defaults 50.
- U-PROG-5 `formula_version` literal `'1.1'`.

**U-WORKOUT**
- U-WO-1 `start` resume: existing active w/ same `workout_key` returns it; different key auto-abandons prior then inserts. F: `canWrite()` false → throws `subscription_inactive`, no insert.
- U-WO-2 `logExercise` upsert dedups on `(session_id,exercise_index)` (index verified). Set rows with both reps & weight empty are dropped.
- U-WO-3 `finish` computes `duration_seconds` from `started_at`; sets `status='completed'`.

**U-ROUTINE**
- U-RT-1 `saveLog` computes `percent = round(count/total*100)`; SB unavailable → **throws** (assert UI shows "Save failed").
- U-RT-2 `loadRoutine` returns published `client_routines.tasks` when `published=true`, else the 7-item default ROUTINE. Streak ≥60% rule; today-blank does not break streak.

**U-NOTIF**
- U-NOTIF-1 `notify()` permission matrix: actor=recipient ✓; actor=admin ✓; actor=recipient's coach ✓; unrelated coach ✗ (raises). F: null recipient raises.
- U-NOTIF-2 direct `INSERT into notifications` as authenticated → **denied** (`WITH CHECK false`).

### 3.2 Integration tests

**I-CLIENT-LIFECYCLE** (signup → program → workout → progression)
1. Admin creates client via `create-user` → Δ `profiles` row with `assigned_coach=C1`, `current_phase='Phase 1'`, `subscriptions` active. E client can log in.
2. C1 publishes program → Δ `client_programs.published=true`. E client `renderClientProgram` shows it; pre-publish shows "No program published yet".
3. Client starts workout, logs 3 sets, finishes intensity 7 → Δ `workout_sessions.status='completed'`, `workout_exercise_logs` rows. E coach `mountCoachView` shows the session.
4. After ≥3 sessions on one exercise with rising volume → E `v_client_progression.performance` > 50. Δ gauges update.
- F: expired subscription → all writes blocked with read-only toast; reads still succeed.

**I-COACH-FLOW** (create → assign → alt → upgrade)
1. Client requests alt on exercise X → Δ `exercise_alternative_requests` pending; `tg_aer_insert` → coach notification. E appears in coach inbox.
2. Coach marks addressed + picks substitute Y → Δ row addressed+`substitute_exercise_id=Y`; `tg_aer_update` → client notification with substitute-aware body. E client program now shows Y with "🔄 Substituted" badge tooltip = original X.
3. Coach republishes program → Δ that request `declined` "Closed — Program Republished"; client notified once. E badge disappears on next render.
4. Coach upgrades client Phase 1→2 → **E (target): `profiles.current_phase='Phase 2'`, `tg_profile_phase_upgrade` notification, celebration**. ⛔ **Currently fails for non-admin coach (C1) — RLS filters the UPDATE to 0 rows; see §4 C1.** This integration test is the canary.

**I-CROSS-MODULE**
- I-XM-1 F5 picker → substitution → tracker logs against substitute `exercise_id` (not original).
- I-XM-2 Substituted+addressed request excluded from Recovery penalty end-to-end (request → view recompute).
- I-XM-3 Subscription expiry → `ensure_subscription_notifications` emits client+coach notifications once per window (idempotent on `data->>'window'`).

### 3.3 System-level end-to-end scenarios

**E2E-DAY (single client full day)**
- Morning routine check-ins (partial), start+finish workout, request an alt mid-session, evening routine. Assert: routine `percent` row, workout completed, alt pending notification to coach, progression Compliance reflects the day. UI: streak increments only if ≥60%.

**E2E-COACH-DASH**
- Coach with N clients loads dashboard: sessions stat (`sessions` table scoped by `coach_id`), programs list (link-to-detail cards), progression overview table (sortable), alt inbox, daily-routine adherence. Assert each panel scopes to the coach's assigned clients **only** (this is also a security assertion — see S-RLS-1, which currently fails on Idiom-B tables).

**E2E-CONCURRENCY (assumptions)**
- Two clients log workouts simultaneously: independent rows, no contention (per-row upsert keys). ✓ assumption holds.
- Same client in two tabs: `supabaseClient.js` uses a **pass-through auth lock** (cross-tab serialization disabled). Assert no auth deadlock; accept last-writer-wins on routine/log upserts. Single active workout invariant may race (two tabs both `start()` → second auto-abandons first). Document as acceptable.
- Coach + client edit same alt request: client UPDATE policy restricted to `status='pending'`; once coach moves it off pending, client can no longer edit. ✓.

### 3.4 Security / correctness tests

**S-RLS (multi-tenant isolation)**
- S-RLS-1 As coach C2 (no assignment to C1's client K), attempt `SELECT * FROM <tbl> WHERE client_id=K`:
  - `client_programs/client_routines/workout_sessions/workout_exercise_logs/sessions/daily_routine_logs(scoped policy)/exercise_alternative_requests/notifications` → **E 0 rows** ✓ (Idiom A).
  - `assessments/body_map_states/gait_assessments/rehab_objective_assessments/progress_logs/progress_snapshots/subscriptions` → **E 0 rows** but **CURRENTLY RETURNS K's ROWS** ⛔ (Idiom B leak — §4 H1).
  - `daily_routine_logs` via legacy `"Coaches view daily logs"` SELECT (`is_admin_or_coach()`) → **CURRENTLY RETURNS K's ROWS** ⛔ (§4 H1).
- S-RLS-2 As coach C2, `UPDATE subscriptions SET end_date=... WHERE client_id=K` (direct PostgREST, not RPC) → **E denied** but **CURRENTLY SUCCEEDS** ⛔ (§4 H2).
- S-RLS-3 As coach C2, `INSERT progress_snapshots(client_id=K,...)` → **E denied** but **CURRENTLY SUCCEEDS** (write check is role-only).
- S-RLS-4 As client, `UPDATE profiles SET role='admin' WHERE id=self` → policy `Users update own profile` has **no `WITH CHECK`**, so a self-update can change *any* column including `role`/`assigned_coach`/`current_phase`. **E should be denied for privileged columns; CURRENTLY a client can self-promote.** ⛔ Critical — see §4 C2.

**S-API-BYPASS**
- S-API-1 Anon `POST /rpc/is_admin` etc. → returns boolean (advisor WARN). Low: no data, but information surface. Assert acceptable or revoke anon.
- S-API-2 Anon `INSERT visitor_inquiries` (WITH CHECK true) → succeeds (intended public form, but unrestricted → spam). Assert rate-limit/captcha at edge.
- S-API-3 Authenticated `POST /rpc/reactivate_subscription` as non-coach for arbitrary client → **E raises 'permission denied'** ✓ (guard verified).

**S-STATE (invalid transitions)**
- S-ST-1 Phase: same-phase → "no change"; downgrade → blocked; skip ≥2 → confirm. (Client-side guards present in `submitPhaseUpgrade`, but enforcement is moot until C1 is fixed.) Add a server-side `CHECK`/trigger for true enforcement.
- S-ST-2 Workout: cannot `finish` a session that isn't yours (RLS `client_id=auth.uid()` on `workout_sessions` ALL). ✓.
- S-ST-3 Subscription: `effective_status` derived, not directly settable to 'active' without dates — but direct table write (S-RLS-2) bypasses the RPC's date math. Tie to H2 fix.

---

## 4. Critical Bug List

### ⛔ C1 — Coach phase upgrade silently no-ops (correctness + user trust) — **CRITICAL**
`dashboard.js submitPhaseUpgrade()` runs `sb.from('profiles').update({current_phase}).eq('id', clientId)`. `profiles` UPDATE policies are **only** `Admins update any profile` (`get_my_role()='admin'`) and `Users update own profile` (`id=auth.uid()`). A **non-admin coach** therefore updates **0 rows**, but PostgREST returns `error=null` → the code shows `"Client upgraded! 🎉"`, fires confetti, and POSTs `send-email` (phase_upgrade) — **while the client's phase never changed and no `tg_profile_phase_upgrade` notification fires** (the trigger only runs on a real `current_phase` change). The coach and client receive contradictory signals. Masked only if the operator account is `role='admin'`.
*Evidence:* `clients.js:62` wires the button for coaches; policy dump shows no coach path.

### ⛔ C2 — Client can self-escalate role / reassign coach / self-upgrade phase — **CRITICAL (security)**
`Users update own profile` is `USING (id=auth.uid())` with **no `WITH CHECK`**. PostgREST `UPDATE /profiles?id=eq.<self>` can set `role='admin'`, `assigned_coach`, `current_phase`, `subscription`-adjacent columns, etc. A logged-in client can self-promote to admin and then read/write everything. This is the highest-severity finding.
*Evidence:* policy `Users update own profile` qual `(id = auth.uid())`, `with_check = null`.

### ⛔ H1 — Cross-coach data leak on legacy (Idiom-B) tables — **HIGH (security, systemic)**
Any authenticated coach can **read every client's** rows in `assessments`, `body_map_states`, `gait_assessments`, `rehab_objective_assessments`, `progress_logs`, `progress_snapshots`, and (via leftover `"Coaches view daily logs"` SELECT) `daily_routine_logs`. The Stabilization Pass tightened `daily_routine_logs` with `dr_logs_coach_read` but **did not drop** the permissive legacy policy — RLS policies are OR-combined, so the loose one wins.

### ⛔ H2 — Direct subscription writes bypass the guarded RPC — **HIGH (security/billing)**
`subscriptions` policy `Admins and coaches manage subscriptions` is `FOR ALL USING is_admin_or_coach()`. Although `reactivate_subscription()` is correctly guarded, the table is **also directly writable** by *any* coach for *any* client: `INSERT/UPDATE/DELETE subscriptions` via PostgREST lets coach C2 extend, expire, or delete C1's client's billing. Defeats the purpose of the RPC.

### H3 — Edge-function repo/runtime drift — **HIGH (operational/DR)**
Deployed (ACTIVE) functions: `subscription-checker`, `generate-program`, `create-user`, `send-email`, `delete-user`. On-disk `supabase/functions/`: only `rpm-ai-suggest`, `visitor-survey`. **Five production functions — including the ones that mint users (`create-user`, service-role) and send email — have no source in the repo**, and two repo functions aren't deployed. No version control, no review, no disaster recovery for the privileged functions.

### H4 — Workout tracker loses media/substitution context after Start — **MEDIUM/HIGH (UX regression)**
After `start()`, the slot re-renders with `host._workouts || [workout]` and **no `libMap`** (`workoutSession.js:246`, `:302`). `renderClientProgram` never assigns `host._workouts`. Result: thumbnails, ▶ Preview, ℹ Info, and the "🔄 Substituted" badge vanish on the active workout until a full reload. The `_substitutedFrom` markers also aren't re-derived in the standalone re-mount.

### M5 — Phase-upgrade email decoupled from success — **MEDIUM**
Even after C1 is fixed, `submitPhaseUpgrade` does not verify rows-affected before sending the celebration email / confetti. Add `.select()` and assert a row came back; only then notify.

### M6 — Migration preview parity — **MEDIUM (known/documented)**
10 pre-2026-05-15 migrations are no-op stubs; a fresh `supabase preview`/branch DB will be missing `profiles`, `subjective_assessments`, `case_shares`, early RLS, etc. The one-time `supabase db pull --schema public` consolidation is still pending (documented in `supabase/migrations/README.md`).

### L7 — `visitor_inquiries` anon INSERT unrestricted (spam) · L8 — anon can call `is_*()` RPCs (info) · L9 — `rpm_touch_updated_at` mutable `search_path` · L10 — leaked-password protection disabled · L11 — `_coachOfClient` returns null when a coach starts a session on behalf of a client (session unattributed to coach_id). All **LOW**.

---

## 5. Design Risks & Architectural Weaknesses

### 5.1 Two RLS idioms (the root cause of C2/H1/H2)
The schema evolved from a role-based authorization model (Idiom B) to a per-assignment one (Idiom A) without retrofitting the original tables. The result is an **inconsistent tenancy guarantee**: half the tables enforce "your clients only," half enforce "any coach." Any reasoning about multi-tenant safety is currently false for Idiom-B tables. A single, uniform policy template (admin OR owning-coach OR assigned-coach OR self) applied across **all** client-data tables — plus a `WITH CHECK` on every UPDATE — would collapse the risk surface. (The `profiles_assigned_coach_idx` added in Stabilization already supports the EXISTS pattern everywhere.)

### 5.2 Privilege-sensitive columns share a table with self-service columns
`profiles` mixes client-editable fields (display prefs) with authorization fields (`role`, `assigned_coach`, `current_phase`). Without column-scoped `WITH CHECK`, self-update is all-or-nothing. Either split privileged columns into an admin-only table or add a `WITH CHECK` that pins `role`/`assigned_coach`/`current_phase` to their OLD values for non-admins (and route phase changes through a SECURITY DEFINER `set_client_phase()` RPC — symmetric with `reactivate_subscription`).

### 5.3 Client-trusted state machine
Phase ordering is parsed from the free-text label `"Phase N"` in JS; there's no DB constraint on legal transitions. The progression formula is correctly server-side and immutable-by-version, but phase transitions are not. Promote phase changes to an RPC with server-side transition rules.

### 5.4 Operational source-of-truth gaps
- Edge functions (H3) — the privileged ones are unversioned.
- Migration history (M6) — preview can't reproduce production from scratch.
Both mean the repo is **not** a complete, reproducible description of the running system. For an AAA architecture-first posture this is the biggest non-security gap.

### 5.5 Resilience choices (accept, but document)
- Pass-through Supabase auth lock disables cross-tab serialization (single-coach assumption). Fine now; revisit if multi-device coaches appear.
- `v_client_progression` recomputes on every read across all clients' workout/log/routine history. Correct, but O(history) per dashboard load; will need a materialized view or per-client filter pushdown as data grows.
- Auth fail-open when `SubscriptionService` missing — convenient in dev, risky if a load-order regression ships it to prod.

### 5.6 Strengths (preserve)
Notify-only-via-RPC with insert-lock; immutable published-program JSON with an override layer; version-stamped progression formula; guarded SECURITY DEFINER RPCs; all tables RLS-enabled; localStorage fully removed (DB single source of truth); idempotent migrations. The **newer** half of the system is genuinely well-architected — the debt is concentrated in the original schema and in ops reproducibility.

---

## 6. Final Verdict

### 🔴 NOT PRODUCTION SAFE — pending two security fixes and one correctness fix.

The platform is feature-complete and the F1–F6 era is well-built, but three issues block a "production safe" rating:

| # | Severity | Blocker |
|---|---|---|
| **C2** | Critical (security) | Client can self-promote to `admin` via `profiles` UPDATE (no `WITH CHECK`). Full tenant compromise. |
| **H1/H2** | High (security) | Any coach can read all clients' clinical data and write any client's billing (legacy role-only RLS). |
| **C1** | Critical (correctness) | Coach phase upgrade silently does nothing while reporting success + emailing the client. |

These are **data-isolation and integrity** defects, not cosmetic. C2 alone is disqualifying for a multi-tenant health product.

**Path to production safe (no scope beyond fixes):**
1. Add `WITH CHECK` to `profiles` UPDATE pinning `role`/`assigned_coach`/`current_phase` for non-admins (fixes C2). Route phase changes through a guarded `set_client_phase()` RPC (fixes C1 + S-ST-1 + M5).
2. Replace Idiom-B policies on the 7 legacy tables with the uniform assigned-coach template; drop the leftover `daily_routine_logs` permissive policies (fixes H1). Make `subscriptions` writable only via RPC (fixes H2).
3. Commit the 5 deployed edge functions to `supabase/functions/` and run the `db pull` consolidation (fixes H3 + M6).
4. Thread `libMap`/`_workouts` through the post-Start re-render (fixes H4).

After 1–2, re-run the **S-RLS-1..4** and **I-COACH-FLOW step 4** tests as the gate. With those green, the rating moves to **production safe**.

---

*Audit performed read-only against live project `byquokhcbagofshsclfy` + repo branch `claude/interesting-buck-452459`. No schema, data, or code was modified. Remediation is proposed, not applied — awaiting direction.*
