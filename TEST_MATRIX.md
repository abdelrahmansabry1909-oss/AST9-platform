# NeuCore / AST9 — Test Matrix

Companion to **SYSTEM_REVIEW.md**. Every case has: **Objective · Preconditions · Steps · Expected Result · Failure Impact**. Cases that guard a review finding cite its ID (e.g. *guards C-1*). Auth contexts: `ADMIN`, `COACH` (non-admin), `COACH2` (different coach), `CLIENT` (assigned to COACH), `CLIENT2` (assigned to COACH2), `ANON`.

Categories: **U** unit · **INT** integration · **E2E** end-to-end · **SEC** security · **REG** regression.
Status column intentionally omitted (read-only audit) — these are specifications to execute, not results.

> **Currency (2026-08-27).** This document is a **point-in-time specification**,
> not a live inventory of the suite. It has not tracked the test files added
> since it was written — `css-vendor-prefix-order`, `monitoring-release-stamp`,
> `fullbody-rom-scoring`, `panel-fold`, `gait-engine-parity`,
> `integration-chain-analysis`, `shoulder-activation`, `objective-sync-bindings`,
> `upper-body-rom-columns` and `assessment-save-reporting` are all absent from
> it, among others. The authoritative list of what actually runs is the
> `test:unit` script in `package.json` (**390 tests across 33 files** as of
> 2026-08-27), enforced against orphans by `tests/unit/test-manifest.test.js`.
> Read this file for the cases it specifies; do not read it as coverage.
>
> Note also what these specs cannot cover. The suite is entirely static — it
> reads source and asserts about it. Nothing in it signs in, saves an
> assessment, or renders a chart. Several defects fixed in 2026-08-26/27 passed
> a fully green suite for months (see ISSUE_LOG #26–#29), which is the argument
> for the mutation-testing habit now used on every new guard: a guard that
> cannot be made to fail is not evidence.

---

## 1. Unit tests (U)

### U-AUTH-01 — `_gateClient` status matrix
- **Objective:** Login gate admits only active/grace.
- **Preconditions:** `auth.js` loaded.
- **Steps:** Call `_gateClient` with `{effective_status:x}` for x ∈ active, grace, expired, pending, none, undefined.
- **Expected:** true for active|grace; false otherwise; no throw on null.
- **Failure impact:** Expired/pending clients gain write access or active clients are locked out.

### U-AUTH-02 — `canWrite` role/subscription matrix
- **Objective:** Write-gate honors role + subscription.
- **Preconditions:** profile loaded.
- **Steps:** coach profile (any sub); client active; client expired; client with `SubscriptionService` undefined.
- **Expected:** coach→true always; client active→true; client expired→false; undefined service→true (documented fail-open, M-7).
- **Failure impact:** Read-only clients can write, or paying clients blocked.

### U-AUTH-03 — login wake-retry
- **Objective:** One retry only on network/timeout, not on auth errors.
- **Preconditions:** mock `signInWithPassword`.
- **Steps:** (a) first call rejects "timed out" then resolves; (b) first call returns invalid-credentials.
- **Expected:** (a) retried once after ~3s, succeeds; (b) no retry, error surfaced.
- **Failure impact:** Double-submit of bad creds / lockouts, or no recovery from paused project.

### U-SUB-01 — `v_client_subscription_state` effective status
- **Objective:** Derived status correct vs dates.
- **Preconditions:** insert sub rows (rolled back): end +10d; today; -3d (grace 7); -30d; status='pending'.
- **Steps:** Select view per client.
- **Expected:** active, active, grace, expired, pending.
- **Failure impact:** Wrong gating, wrong billing UI.

### U-SUB-02 — `formatPill`
- **Objective:** Pill label/tone per state.
- **Steps:** active d>14 / 1–14 / today; grace 1 vs n days; expired; none.
- **Expected:** teal/amber/amber; rose singular/plural; rose; gray.
- **Failure impact:** Misleading status chip.

### U-SUB-03 — `SubscriptionService.reactivate` guards
- **Objective:** Only 3/6/12-month plans.
- **Steps:** call with 3,6,12 and with 1,4.
- **Expected:** 1/4 throw `unsupported plan`; valid ones invoke RPC + clear cache.
- **Failure impact:** Invalid plan rows.

### U-PROG-01 — Compliance formula
- **Objective:** 0.4 workouts + 0.4 routine + 0.2 ex-completion, clamped.
- **Preconditions:** seed (rolled back) 12 completed workouts, 100% routine, 100% completion.
- **Steps:** read `v_client_progression`.
- **Expected:** compliance=100; all-zero activity → 0.
- **Failure impact:** Wrong coach signal / phase decisions.

### U-PROG-02 — Recovery penalties + substitution exclusion *(guards F6)*
- **Objective:** overreach/abandon/alt penalize; honored substitution does not.
- **Steps:** (a) 2 overreach → expect 80; (b) 1 pending alt → −5; (c) 1 `addressed`+`substitute_exercise_id` alt → no decrement.
- **Expected:** as stated; clamp ≥0.
- **Failure impact:** Substituting an exercise unfairly tanks Recovery (the F6 regression this guards).

### U-PROG-03 — Performance gating
- **Objective:** needs ≥3 sessions/exercise; delta clamped [-0.20,0.50]; else default 50.
- **Steps:** 2 sessions (→50) vs 3 with rising volume (→>50).
- **Expected:** as stated; `formula_version='1.1'`.
- **Failure impact:** Noise-driven performance score.

### U-WO-01 — `start` resume/abandon invariant
- **Objective:** one active session per client.
- **Steps:** start key A; start key A again; start key B.
- **Expected:** same row returned for A; starting B auto-abandons A.
- **Failure impact:** Multiple active sessions corrupt progression counts.

### U-WO-02 — `logExercise` upsert dedup
- **Objective:** unique `(session_id,exercise_index)`.
- **Preconditions:** unique index present (verified).
- **Steps:** log index 0 twice with different sets.
- **Expected:** single row, last write wins; empty reps&weight rows dropped.
- **Failure impact:** Duplicate/duplicated set logs.

### U-RT-01 — `saveLog` percent + no-SB throw
- **Objective:** percent math; surfaces storage failure.
- **Steps:** 3/7 tasks → 43%; simulate `sb` undefined.
- **Expected:** correct percent; throws "Storage unavailable" (no silent drop).
- **Failure impact:** Lost check-ins shown as saved.

### U-NOTIF-01 — `notify()` permission matrix *(guards notify design)*
- **Objective:** actor allowed only when self/admin/coach-of-recipient/client-of-recipient.
- **Steps (rolled back, impersonated):** actor=recipient; actor=admin; actor=recipient's coach; unrelated actor; null recipient.
- **Expected:** first three insert; unrelated raises; null raises.
- **Failure impact:** Notification spoofing / spam across tenants.

### U-EXLIB-01 — exercise embed/thumbnail URL helpers
- **Objective:** `getEmbedUrl`/`getThumbnailUrl` handle YouTube/Vimeo/empty.
- **Steps:** pass valid YT, Vimeo, malformed, null.
- **Expected:** correct embed/thumb or graceful null; no throw.
- **Failure impact:** Broken video tiles in program/tracker.

---

## 2. Integration tests (INT)

### INT-LIFECYCLE-01 — client signup→program→workout→progression
- **Objective:** Happy path end to end.
- **Preconditions:** ADMIN session.
- **Steps:** create CLIENT (active sub) → COACH publishes program → CLIENT logs 3 sets + finishes intensity 7 → read progression.
- **Expected:** profile/sub rows; program visible; `workout_sessions.completed` + logs; progression reflects workout.
- **Failure impact:** Core product loop broken.

### INT-COACH-01 — alt request → substitute → republish
- **Objective:** F6 override lifecycle.
- **Steps:** CLIENT requests alt on X → COACH addresses + substitute Y → CLIENT program shows Y w/ badge → COACH republishes → request auto-declined "Closed — Program Republished", badge gone.
- **Expected:** as stated; one client notification per state change.
- **Failure impact:** Stale substitution swaps the wrong exercise in a new program.

### INT-PHASE-01 — phase upgrade via RPC *(guards C1)*
- **Objective:** assigned coach upgrade succeeds and UI reflects DB.
- **Preconditions:** COACH assigned to CLIENT on Phase 1.
- **Steps:** COACH calls `set_client_phase(CLIENT,'Phase 2')`; observe profile + notification + UI toast/confetti.
- **Expected:** `current_phase='Phase 2'`, `phase_upgrade` notification, UI celebrates only on returned row.
- **Failure impact:** Silent no-op phase upgrades (the fixed C1 regressing).

### INT-NOTIF-01 — trigger → inbox deep-link
- **Objective:** AER insert notifies coach; row deep-links.
- **Steps:** CLIENT inserts AER → COACH inbox unread+1 → open routes to section with params.
- **Expected:** notification present, scoped to coach, link works.
- **Failure impact:** Coaches miss client requests.

### INT-SUB-01 — reactivate via RPC
- **Objective:** SubscriptionService.reactivate path.
- **Steps:** COACH (assigned) reactivates expired CLIENT 3mo.
- **Expected:** new active sub via RPC; cache cleared; list refreshes.
- **Failure impact:** Renewal broken.

### INT-CHARTS-01 — client dashboard derives from real assessment
- **Objective:** assessment/gait/subjective populate report + charts; empty-state when none.
- **Steps:** CLIENT with assessment vs without.
- **Expected:** True Driver/Symptoms/Notes filled; otherwise single placeholder (Q-C1).
- **Failure impact:** Permanent "Loading…" / fabricated data.

---

## 3. End-to-end (E2E)

### E2E-DAY-01 — client full day
- **Objective:** routine + workout + alt + evening routine in one day.
- **Steps:** morning check-ins (partial) → start+finish workout → request alt → evening check-ins.
- **Expected:** routine `percent` row, completed session, pending alt→coach notification, progression Compliance reflects day; streak only if ≥60%.
- **Failure impact:** Day's activity mis-recorded.

### E2E-COACHDASH-01 — coach dashboard scoping
- **Objective:** every panel shows only the coach's assigned clients.
- **Steps:** COACH with assigned + unassigned clients loads sessions stat, programs list, progression overview, alt inbox, routine adherence.
- **Expected:** only assigned clients/data appear.
- **Failure impact:** Cross-tenant exposure (also a security assertion — see SEC-RLS-01).

### E2E-CONC-01 — concurrency assumptions
- **Objective:** no auth deadlock / corruption under parallel use.
- **Steps:** same client two tabs (auth pass-through lock); two clients log simultaneously; coach+client touch same alt request.
- **Expected:** no deadlock; independent rows; client can edit AER only while `pending`.
- **Failure impact:** Login hangs / lost writes / state races.

### E2E-EXPIRY-01 — subscription lifecycle
- **Objective:** active→grace→expired transitions + gating + notifications.
- **Steps:** advance dates (or seed) across boundaries; run `subscription-checker`; client logs in at each state.
- **Expected:** correct effective_status, write-gate, one notification per window (idempotent on `data->>'window'`).
- **Failure impact:** Wrong access / notification spam.

---

## 4. Security tests (SEC) — **highest priority**

### SEC-EDGE-01 — `create-user` requires admin *(guards C-1)* 🔴
- **Objective:** Non-admin cannot create users / cannot set role=admin.
- **Preconditions:** CLIENT session token.
- **Steps:** `POST /functions/v1/create-user` with `{email,password,full_name,role:'admin'}` using CLIENT's JWT.
- **Expected (target):** 403 forbidden; **no** auth user, **no** profile created.
- **Current (defect):** 200 — admin account created.
- **Failure impact:** Total tenant compromise (privilege escalation).

### SEC-EDGE-02 — `delete-user` requires admin *(guards C-2)* 🔴
- **Objective:** Non-admin cannot delete accounts.
- **Steps:** CLIENT JWT → `POST /functions/v1/delete-user {user_id: <ADMIN id>}`.
- **Expected (target):** 403; account intact.
- **Current (defect):** 200 — target deleted.
- **Failure impact:** Destruction / DoS / takeover.

### SEC-EDGE-03 — `send-email` requires authorized role *(guards H-4)*
- **Objective:** Non-staff cannot trigger arbitrary client emails; `message` escaped.
- **Steps:** CLIENT JWT → send-email for arbitrary `client_id`; include `message` with `<script>`/HTML.
- **Expected (target):** 403; if allowed for staff, `message` HTML-escaped.
- **Failure impact:** Email spam/abuse; HTML injection in inbox.

### SEC-SIGNUP-01 — self-signup cannot set role *(guards H-1)* 🔴 if signup open
- **Objective:** Public signup cannot self-assign admin.
- **Steps:** `POST /auth/v1/signup {email,password,data:{role:'admin'}}` as ANON.
- **Expected (target):** signup disabled (404/403) OR `handle_new_user` forces `role='client'` regardless of metadata.
- **Failure impact:** Anonymous admin self-provisioning.

### SEC-PROFILE-01 — client cannot self-escalate *(guards C2, regression)*
- **Objective:** profiles privilege columns locked for non-admin.
- **Steps (impersonated, rolled back):** CLIENT `UPDATE profiles SET role='admin'/assigned_coach/current_phase WHERE id=self`.
- **Expected:** all raise (trigger); `full_name` update allowed.
- **Failure impact:** Privilege escalation (the fixed C2 regressing).

### SEC-RLS-01 — cross-coach isolation *(guards H1, regression)*
- **Objective:** COACH2 sees zero of COACH's client data.
- **Steps (impersonated):** COACH2 selects assessments/body_map_states/gait_assessments/rehab_objective_assessments/progress_logs/progress_snapshots/subscriptions/daily_routine_logs/client_programs/workout_sessions for CLIENT.
- **Expected:** 0 rows everywhere.
- **Failure impact:** Clinical/billing data leak across tenants.

### SEC-RLS-02 — subscription writes RPC/admin-only *(guards H2/H-2)*
- **Objective:** non-admin coach cannot mutate subscriptions directly.
- **Steps (impersonated):** non-admin COACH `UPDATE`/`INSERT`/`DELETE subscriptions` for CLIENT.
- **Expected:** UPDATE/DELETE affect 0 rows; INSERT denied; renewals only via `reactivate_subscription()`.
- **Failure impact:** Billing tampering.

### SEC-RLS-03 — phase change only via RPC token *(guards C1/C2)*
- **Objective:** direct `current_phase` write blocked without token.
- **Steps (impersonated):** COACH `UPDATE profiles SET current_phase` directly; then via `set_client_phase`.
- **Expected:** direct raises; RPC succeeds (admin/assigned only) and enforces no-downgrade/no-same-phase.
- **Failure impact:** Uncontrolled phase mutation.

### SEC-NOTIF-01 — notifications insert-locked
- **Objective:** clients cannot forge notifications.
- **Steps:** authenticated `INSERT notifications` directly.
- **Expected:** denied (`WITH CHECK false`); only `notify()` writes.
- **Failure impact:** Spoofed alerts.

### SEC-RPC-01 — `reactivate_subscription` authorization
- **Objective:** only admin/assigned coach renews.
- **Steps (impersonated):** non-assigned actor calls RPC for CLIENT.
- **Expected:** raises `permission denied`.
- **Failure impact:** Cross-tenant billing changes.

### SEC-VISITOR-01 — anon insert abuse *(guards M-6)*
- **Objective:** quantify open `visitor_inquiries` insert.
- **Steps:** ANON repeated inserts.
- **Expected (target):** rate-limited/captcha; currently unrestricted — document risk.
- **Failure impact:** Spam flooding.

### SEC-CORS-01 — edge function CORS
- **Objective:** privileged functions not callable cross-origin by arbitrary sites.
- **Steps:** inspect `Access-Control-Allow-Origin` on create/delete/send-email.
- **Expected (target):** restricted origin; currently `*` — document with C-1/C-2/H-4.
- **Failure impact:** Drive-by calls with a stolen/any JWT.

---

## 5. Regression tests (REG) — guard the signed-off fixes & risky interactions

### REG-SUB-01 — coach subscription actions don't silently fail *(guards H-2)*
- **Objective:** `activate()`/`remove()`/`submit()` either succeed or show an error — never silent success.
- **Steps:** non-admin COACH triggers each in the UI (or against RLS).
- **Expected (target):** explicit success or explicit error; no "success" toast on 0 rows.
- **Current (defect):** activate/remove toast success on 0 rows; submit RLS-errors.
- **Failure impact:** Coaches believe billing changed when it didn't.

### REG-PHASE-01 — phase upgrade non-optimistic *(guards C1)*
- **Objective:** UI celebrates only on confirmed DB row.
- **Steps:** force RPC error (e.g., downgrade) and a success.
- **Expected:** error → toast, no confetti/email; success → confetti + email with confirmed phase.
- **Failure impact:** Fake "upgraded" UX.

### REG-PROFILE-GUARD-01 — guard trigger still fires after EXECUTE revoke *(guards C2 hardening)*
- **Objective:** revoking RPC EXECUTE didn't disable enforcement.
- **Steps (impersonated, rolled back):** CLIENT role→admin.
- **Expected:** blocked.
- **Failure impact:** Silent re-opening of C2.

### REG-MIG-01 — registry ↔ disk 1-to-1
- **Objective:** every remote migration has a matching local file.
- **Steps:** compare `list_migrations` versions to `supabase/migrations/*.sql` names.
- **Expected:** exact match (currently 30↔30).
- **Failure impact:** `supabase preview` "remote versions not found".

### REG-RLS-INITPLAN-01 — perf guard after any policy change *(guards M-1/M-2)*
- **Objective:** ensure policy edits keep `(SELECT auth.uid())` wrapping and minimal permissive overlap.
- **Steps:** re-run performance advisor after any RLS migration.
- **Expected:** `auth_rls_initplan` / `multiple_permissive_policies` counts do not increase.
- **Failure impact:** Query latency creep on every RLS-scoped table.

### REG-WORKOUT-MEDIA-01 — media persists after Start *(guards M-5)*
- **Objective:** thumbnails/preview/badge remain after starting a workout.
- **Steps:** open My Program with a substituted, video-linked exercise; click Start.
- **Expected (target):** media + "🔄 Substituted" badge still rendered.
- **Current (defect):** they vanish until reload.
- **Failure impact:** Clients lose exercise guidance mid-session.

### REG-LOCALSTORAGE-01 — DB single source of truth
- **Objective:** no functional localStorage persistence reintroduced.
- **Steps:** grep modules; exercise routine/workout/session flows offline.
- **Expected:** only `supabaseClient` probe + `rpm/graph-viewer` view-state; data flows are DB-only; failures surface (no silent drop).
- **Failure impact:** Divergent client/DB state.

---

## 6. Priority execution order

1. **SEC-EDGE-01/02/03, SEC-SIGNUP-01** (Critical/High security — currently failing by design of the defect).
2. **SEC-PROFILE-01, SEC-RLS-01/02/03, SEC-NOTIF-01, SEC-RPC-01** (regression guards for signed-off fixes — should pass now; lock them in).
3. **REG-SUB-01, REG-PHASE-01, REG-PROFILE-GUARD-01, REG-MIG-01.**
4. **INT/E2E** happy paths.
5. **U-*** units.
6. **M/L perf + UX** (M-1/2/3/5, REG-WORKOUT-MEDIA-01) as part of hardening.
