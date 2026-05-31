# RELIABILITY_SWEEP_ARCHITECTURE.md — NeuCore Platform

**Status:** Proposal · NOT yet approved · NO code written
**Author:** Claude (continuation session)
**Date:** 2026-05-31
**Branch target:** `claude/interesting-buck-452459` (HEAD `9a8f68b` — post-F6)
**Inputs:** PRODUCT_AUDIT.md · PROJECT_STATUS.md · FEATURE_STATUS.md · NEXT_STEPS.md (all in context, current as of this session)
**Goal:** Fix the Critical + High severity production defects from PRODUCT_AUDIT.md, prioritized A → B → C → D per user direction.

---

## 0 · Scope decision (read this first)

The user asked for **Critical + High severity defects** in priority order A → B → C → D.

- **In scope (this sweep):** all 4 remaining Critical (C1, C2, C3, C5 — C4 was F6, already shipped) + 5 of 8 High items (H1, H2, H3, H5, H7) that fold naturally into the same files.
- **High-severity items deferred to a follow-up:** H4 (client-side workout history), H6 (coach reassignment UI), H8 (onboarding flows). Each needs its own architecture pass — bundling them into this sweep would balloon scope past one commit.
- **All Medium items:** explicitly deferred. Listed in §10 for traceability.

**Why deferring 3 Highs is the right call:** the audit's 4 prioritized buckets (A–D) plus the small Highs sit within ~6 files and one new edge function. Adding H4 (new client section + loaders), H6 (new coach UI + RLS rule), and H8 (multi-screen wizards) would triple file count and risk surface for marginal user impact in this iteration. They earn their own architecture docs next.

---

## 1 · Bucket inventory

### 🔴 Critical — all in scope

| ID | PRODUCT_AUDIT § | Priority bucket |
|---|---|---|
| C1 | TD1 + TD9 (Programs/sessions in localStorage) | **A** |
| C2 | TD2 + TD17 (Anthropic in browser without key, silent fail) | **B** |
| C3 | TD11 (client dashboard "Loading…" placeholders) | **C** |
| ~~C4~~ | F6 missing — **shipped 2026-05-31, frozen** | — |
| C5 | TD8 (Phase Upgrade has no validation) | **D** |

### 🟠 High — split between in-scope and deferred

| ID | PRODUCT_AUDIT § | Decision | Rides with |
|---|---|---|---|
| H1 | TD3 (login → `index.html` legacy link) | ✅ in scope | A (touches `app.html`) |
| H2 | TD4 (mobile nav not role-gated) | ✅ in scope | C (touches `app.html`) |
| H3 | TD10 (no client Notifications sidebar entry) | ✅ in scope | C (touches `app.html`) |
| H4 | (no client workout history view) | ⏸ deferred | needs its own architecture |
| H5 | TD6 (Add-Exercise modal scope mismatch) | ✅ in scope | trivial UI patch + tag input |
| H6 | TD7 (no coach reassignment UI) | ⏸ deferred | needs multi-flow design |
| H7 | TD5 (`stat-sessions` from localStorage) | ✅ in scope | A (same root cause as C1) |
| H8 | (no onboarding flows) | ⏸ deferred | needs UX research + multiple screens |

### 🟡 Medium — all deferred from this sweep

Listed in §10 for traceability. Not touched.

---

## 2 · Priority A — localStorage vs Supabase inconsistencies

**Bundle:** C1 + H7 + H1 (H1 piggybacks on `app.html`)

### 2.1 Root cause

`js/dashboard.js` defines a localStorage cache (`SESSIONS_KEY = 'ast9_sessions_v2'`, lines 11–18) and uses it as the **source of truth** for three coach-facing surfaces:

| Surface | Line | What it reads |
|---|---|---|
| Coach Dashboard stat-card "Sessions" | `js/dashboard.js:343` | `_sessions.length` |
| Coach Dashboard "Recent Sessions" panel | `js/dashboard.js:374-391` | `_sessions.slice(0,5)` |
| Coach "Programs" sidebar page main list | `js/dashboard.js:857-882` | `_sessions.map(...)` |
| "Programs" toggle/rePreviewWeb expand | `js/dashboard.js:884-900` | `_sessions[i]` |
| PDF export bundle handoff | `js/dashboard.js:578-579` (`_lastBundle`) | in-memory only — *not* localStorage |

Meanwhile the DB has the real data:
- `sessions` table (verified live): `id, client_id, coach_id, phase, goal, output, form_data, created_at` — `dashboard.js:745` already writes to it on every Generate.
- `client_programs` table (F5/F6 source of truth): `id, client_id, coach_id, program (jsonb), published, published_at` — coach reads correctly via existing RLS policy `client_programs_coach_all`.

The localStorage layer is dead weight pretending to be the source of truth. New browser = empty Programs page even when the coach has published 50 programs.

### 2.2 Files affected

| File | Touch type |
|---|---|
| `js/dashboard.js` | edit — replace 4 readers with DB queries; preserve `_lastBundle` for PDF flow |
| `app.html` | edit — H1 only: replace "Back to NeuCore" `index.html` link with sign-out |

**No migration.** The tables already exist. RLS already correct.

### 2.3 Risk assessment

**Risk: Medium.**

| Risk | Mitigation |
|---|---|
| The Generate→PDF round-trip relies on the in-memory `_lastBundle`. Removing `_sessions` entirely could break PDF export. | Keep `_lastBundle` as-is (transient handoff between Generate step and PDF Export click). Only remove the *list-rendering* and *KPI* dependencies. |
| Programs list currently shows the full AI narrative output inline (`<pre>${s.output}</pre>`). `client_programs.program` is structured JSON, NOT narrative text. Different shape. | New Programs reader joins `sessions` (which has `output`) by `client_id` to keep the narrative-rendering UX. Or shows a richer card (client name + phase + published_at) with "View full" deep-link. **Recommendation: simpler card — drop the inline narrative, link to client.** |
| `sessions` RLS policy "Coaches read all sessions" lets every coach see every other coach's sessions (verified live). Switching to DB-backed Recent Sessions would surface other coaches' clients. | UI must filter `coach_id = me` explicitly. (Server-side fix is out of sweep scope — flag as a separate Medium gap for a future RLS-tightening pass.) |
| `_sessions.length` (current `stat-sessions`) counts every Generate this browser ever did. DB count will be the coach's TRUE all-time total — could be a much bigger number. | Acceptable — that's the correct number. Document the change in commit body. |
| Existing localStorage data on a real coach's browser becomes orphaned. | Acceptable — data is duplicated to DB anyway. Optionally show a one-time "Imported your offline cache" merge if `_sessions` is non-empty on first post-sweep boot. **Recommendation: skip the merge — keep the diff small.** |

### 2.4 Fix strategy

| Action | Where |
|---|---|
| 1. Keep `_sessions` + `SESSIONS_KEY` + `saveSessions()` strictly as an **in-memory PDF handoff cache** (no semantic change). Stop *reading* from it for KPIs/lists. | `js/dashboard.js:11-18` (preserved); remove all read references below |
| 2. Make `_sessions.unshift(session)` and `saveSessions()` *optional* — keep them so localStorage continues to fill, but other code stops trusting it. Lets future devs `git revert` if needed. | `js/dashboard.js:575-576` (no change) |
| 3. New `_loadCoachSessionsCount()` — `SELECT count(*) FROM sessions WHERE coach_id = me` (or all when admin). Replace `_setStat('stat-sessions', _sessions.length)`. | `js/dashboard.js:343` |
| 4. New `_renderRecentSessionsFromDB()` — query `sessions ORDER BY created_at DESC LIMIT 5` filtered by `coach_id = me` (or all for admin) joined to `profiles` for client names. Replace local-reading `_renderRecentSessions`. | `js/dashboard.js:374-391` |
| 5. New `renderProgramsListFromDB()` — query `client_programs WHERE published=true` (RLS automatically scopes by coach/admin) joined to `profiles` for client names. Render each row as: client name · phase · published date · "View" + "Republish" buttons. Drop the inline `<pre>` narrative; the rich preview lived in localStorage and isn't reproducible from `client_programs` alone. | `js/dashboard.js:857-900` |
| 6. Keep `_lastBundle` for the in-session Generate→PDF Export hand-off. Optional: also store `_lastBundle.session_id` returned from the existing `sb.from('sessions').insert(...).select().single()` so the PDF flow could later rehydrate by `sessions.id`. | `js/dashboard.js:738-746` |
| 7. **H1**: replace `<a href="index.html">Back to NeuCore</a>` on the login screen with a sign-out / hide entirely (login page should not link out). | `app.html:32-35` |
| 8. **H7 is already covered by action #3.** | — |

### 2.5 Open question (Q-A1)

The Programs page currently renders the full AI narrative as an expandable `<pre>` block inline. After the fix it links to a client/session detail. **Is that acceptable, or do you want the new card to fetch + show the `sessions.output` narrative inline as before?** Either works; the second is one extra column in the SELECT.

---

## 3 · Priority B — AI generation workflow

**Bundle:** C2 + TD17

### 3.1 Root cause

`js/dashboard.js:547-558`:

```js
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1200,
    messages:   [{ role: 'user', content: buildPrompt() }],
  }),
});
```

Three independent defects in one call:
1. **No `x-api-key` header** — Anthropic always rejects with 401.
2. **No `anthropic-version` header** — would also fail.
3. **CORS** — Anthropic's API does not allow direct browser calls. Pre-flight fails before the auth check even runs.

The `catch (aiErr)` block (line 559) silently swallows the error and substitutes a stub string. The user-facing toast then says **"Program generated!"** (line 585) — the coach has no signal the AI piece failed.

**Hidden side effect:** if the API key *were* present, it would be exposed in every coach's browser bundle. So even fixing the headers in-place would be a security defect.

### 3.2 Files affected

| File | Touch type |
|---|---|
| NEW: `supabase/functions/generate-program-narrative/index.ts` | new edge function |
| `js/dashboard.js` lines 543-565 | rewrite the AI block to call the edge function + remove the success-on-failure toast lie |

**Migration: none.** Edge function deploy is via `mcp__...__deploy_edge_function`.

**Secrets ask:** the user must provision `ANTHROPIC_API_KEY` in Supabase project secrets (Dashboard → Project Settings → Edge Functions → Secrets). I cannot do this; it's a one-time user action. The edge function reads `Deno.env.get('ANTHROPIC_API_KEY')`.

### 3.3 Risk assessment

**Risk: Medium.**

| Risk | Mitigation |
|---|---|
| Edge function deploy failure during the sweep would land an incomplete fix. | Deploy the edge function FIRST, smoke-test it, THEN swap the client call. Two-step verification. |
| Anthropic call can take 5–30s; current code shows "Generating AI analysis…" spinner — needs to keep working. | Spinner stays; edge function returns the same shape (`{ text }`). UI swap is transparent. |
| User hasn't set `ANTHROPIC_API_KEY` yet. | Edge function returns `{ error: 'AI not configured', text: null }` when env var is missing; client shows "AI narrative unavailable — program structure still generated." instead of a fake success. Coach knows. |
| Anthropic model name `claude-sonnet-4-20250514` may be deprecated or wrong by 2026. | Edge function reads model from an env var with that as the default. User can update without redeploy. |
| Existing toast says "Program generated!" — that's actually correct for the program JSON. The AI narrative is supplemental. | Keep the success toast for the PROGRAM, add a separate **warning** toast if AI narrative failed. Two messages, no lie. |
| Edge function CORS — must accept the project's app origin. | Use the standard Supabase edge function CORS shim (`Access-Control-Allow-Origin: *` for auth-gated functions is fine; auth happens via JWT). |

### 3.4 Fix strategy

| Step | What |
|---|---|
| 1 | Create `supabase/functions/generate-program-narrative/index.ts`. Pattern follows the existing `send-email` / `create-user` (referenced from `clients.js:101-112` + `subscriptions.js:263-269`). |
| 2 | Function contract: `POST { prompt: string, max_tokens?: number, model?: string }` → `200 { text: string }` or `200 { text: null, error: 'AI_NOT_CONFIGURED' }` or `5xx { error: '…' }`. Auth: requires a valid `Authorization: Bearer <jwt>` from any authenticated user (coaches/admins are the callers). |
| 3 | Inside the function: read `ANTHROPIC_API_KEY` from env; call `https://api.anthropic.com/v1/messages` with `x-api-key` + `anthropic-version: 2023-06-01` + body. Pass through the result text. |
| 4 | Deploy via `mcp__...__deploy_edge_function`. |
| 5 | Update `js/dashboard.js generateProgram()`: replace the direct fetch with `sb.functions.invoke('generate-program-narrative', { body: { prompt: buildPrompt(), max_tokens: 1200 } })`. |
| 6 | On `error` OR `data.text === null`: show a yellow "warning" toast "AI narrative unavailable — program structure still generated". Stop pretending success. |
| 7 | Persist the narrative to `sessions.output` only when it actually came back (unchanged from current flow — `_saveToSupabase` is already idempotent). |

### 3.5 Open question (Q-B1)

Should the sweep also **gate the Generate button** behind a "AI configured?" health check (single `sb.functions.invoke('generate-program-narrative', { body: { ping: true } })` on session boot)? **Recommendation: no — too clever, hides the failure mode from coaches who don't care about AI.** Toast at use-time is clearer. Answer "yes" only if you want the button to grey out.

---

## 4 · Priority C — Client dashboard loading failures

**Bundle:** C3 + H3 + H2

### 4.1 Root cause

`js/clientDashboard.js:154-165` hard-codes three rows with literal "Loading…" text that nothing populates:

```html
<div class="cd-assessment-row">
  <div class="cd-assessment-label">True Driver</div>
  <div class="cd-assessment-value">Loading…</div>
</div>
<div class="cd-assessment-row">
  <div class="cd-assessment-label">Reported Symptoms</div>
  <div class="cd-assessment-value">Loading…</div>
</div>
<div class="cd-assessment-row">
  <div class="cd-assessment-label">Coach's notes</div>
  <div class="cd-assessment-value cd-assessment-notes">Your coach will write a brief here once your first session is complete.</div>
</div>
```

Every client sees this on every Home visit. Looks perpetually broken. The 3D Load Visualizer + Chart.js panels populate correctly via `_mountVisualizer`; only the **Assessment Report card** stays in skeleton state forever.

The data exists:
- `rehab_objective_assessments` (composite_score, phase_recommendation, pain_flags, asymmetry_flags) — `_mountVisualizer` already loads the latest at line 268.
- `gait_assessments` (worst_case_scenario, exercise_priorities) — also loaded at line 286.
- Subjective: `RPMSubjective.pullSubjectiveSummary` (referenced in `dashboard.js:677`) returns dream_outcome, external_pain, recap_notes, etc.

**H3:** The sidebar nav has entries for `Dashboard`, `Daily Routine`, `Nutrition Plan`, `My Graph`, `My Program`, `Community`, `Case Studies`, `Settings` for clients — but **no entry for Notifications**. The bell icon hides in the sidebar footer (`app.html:235`); mobile clients never find it.

**H2:** Mobile bottom nav at `app.html:1576-1590` has 4 hard-coded buttons (`Home`, `Session`, `Community`, `Programs`). For a client, `Session` and `Programs` resolve to coach-only sections that render blank because of `role-coach-admin` CSS.

### 4.2 Files affected

| File | Touch type |
|---|---|
| `js/clientDashboard.js` lines 88-197 (`render` + `_mountVisualizer`) | edit — new `_renderAssessmentReport(clientId, assessment, gait)` helper called from `_mountVisualizer` after the parallel fetch completes |
| `app.html` lines 222-225 | edit — add `nav-notifications` entry visible to clients (and reuse for coaches if not already shown) |
| `app.html` lines 1576-1590 | edit — role-gate mobile bottom-nav buttons via existing `role-coach-admin` / `role-client-only` classes |

**No migration. No new module.**

### 4.3 Risk assessment

**Risk: Low.**

| Risk | Mitigation |
|---|---|
| Client may have NO assessment row yet (brand-new client) — must not show "Loading…" indefinitely. | Empty state: "Your coach will run an assessment after your first session." Already the wording in the third row for Coach's notes; reuse for True Driver and Reported Symptoms too. |
| `RPMSubjective.pullSubjectiveSummary` is referenced from `dashboard.js:677` for the PDF flow but may not always be loaded by the time ClientDashboard renders. | Wrap in `typeof RPMSubjective !== 'undefined'` check; skip the subjective row when missing. |
| Adding a Notifications sidebar entry for clients may conflict with the existing `nav-notifications` (if any). Verified earlier: there is currently NO `nav-notifications` element — section `#section-notifications` exists but no sidebar item points at it for clients. | Safe to add. The loader (`dashboard.js:138-154`) already handles the section for any role. |
| Mobile nav fix: clients lose Session/Programs buttons (acceptable — they're useless to clients). Net buttons become Home + Community + Notifications (for clients) / Home + Session + Community + Programs (for coaches). | Use existing `role-*` classes — same pattern as the sidebar. |

### 4.4 Fix strategy

| Step | What |
|---|---|
| 1 | New helper `_renderAssessmentReport({ assessment, gait, subjective })` in `clientDashboard.js`. Returns HTML for the 3 rows. |
| 2 | Inside `_mountVisualizer`, after the parallel `_loadLatestAssessment` + `_loadLatestGait` completes, also `await _loadLatestSubjective(clientId)` (new local helper that wraps `RPMSubjective.pullSubjectiveSummary` defensively). Then call `_renderAssessmentReport(...)` and `querySelector('.cd-assessment-body').innerHTML = newHTML`. |
| 3 | Row mappings: True Driver = `assessment.phase_recommendation || gait.worst_case_scenario || '—'`; Reported Symptoms = `(subjective.external_pain) || (assessment.pain_flags || []).join(', ') || 'None reported'`; Coach's notes = `subjective.recap_notes || subjective.free_form_notes || 'Your coach will write a brief here once your first session is complete.'` |
| 4 | When no assessment row exists at all: all 3 rows show "Your coach will run an assessment after your first session." |
| 5 | **H3**: add `<div class="nav-item" id="nav-notifications" onclick="Dashboard.showSection('notifications')">◔ Notifications</div>` in the sidebar at `app.html` between Community and the role-gated entries (no role class = visible to all). Keep the footer bell as a quick-access shortcut. |
| 6 | **H2**: add `role-client-only` class to the existing mobile `Session` and `Programs` buttons (no — actually need to switch to `role-coach-admin` since those are coach-only sections). Optionally add a `Notifications` mobile button with `role-client-only` so mobile clients have a way to reach their inbox. |

### 4.5 Open question (Q-C1)

For the empty state ("your coach will run an assessment…"), do you want **a single placeholder spanning all 3 rows** (cleaner) or **the same placeholder repeated per row** (matches current visual scaffolding)? **Recommendation: single placeholder** — change `.cd-assessment-body` to an empty state when no assessment row exists.

---

## 5 · Priority D — Phase upgrade edge cases

**Bundle:** C5 (single issue)

### 5.1 Root cause

`js/dashboard.js:966-994 submitPhaseUpgrade()`:

```js
async function submitPhaseUpgrade() {
  const clientId = document.getElementById('pu-client')?.value;
  const newPhase = document.getElementById('pu-phase')?.value;
  // ... no read of current_phase ...
  const { error } = await sb.from('profiles')
    .update({ current_phase: newPhase })
    .eq('id', clientId);
```

`#pu-phase` (`app.html:1722-1726`) offers only `Phase 2` and `Phase 3` (not Phase 1). The `prepPhaseUpgrade(clientId, clientName)` at `js/clients.js:130-134` sets `#pu-client` but never reads or filters by current phase.

**Consequences:**
- Coach upgrading a Phase 1 client picks "Phase 3" → silently jumps two phases.
- Coach upgrading a Phase 3 client picks "Phase 2" → silently downgrades AND fires the celebration confetti + email saying "Phase Complete!".
- Coach picks the client's current phase → no DB change (no-op) but celebration fires anyway because the toast/celebration code runs unconditionally.
- `tg_profile_phase_upgrade` trigger (Tier-1) fires on any `current_phase` change, including downgrades. Client receives "🎉 You advanced to Phase 2!" inbox notification for a downgrade. Embarrassing.

### 5.2 Files affected

| File | Touch type |
|---|---|
| `js/clients.js` line 130-134 | edit — `prepPhaseUpgrade` fetches the client's current phase + writes it into a data attribute on the modal |
| `js/dashboard.js` lines 966-994 (`submitPhaseUpgrade`) | edit — read current phase, validate transition, refuse downgrade/same-phase with a toast |
| `app.html` lines 1707-1737 (modal HTML) | edit — show current-phase pill in the modal body; dynamically disable options at-or-below current phase |
| `supabase/migrations/20260603_notification_guards_and_phase_upgrade.sql` (trigger) | **no change** — the trigger fires on any `current_phase` UPDATE. With JS guards refusing downgrades/no-ops, the trigger will only fire on legitimate upgrades. Belt-and-braces. |

**No migration.** Pure UI/JS guard.

### 5.3 Risk assessment

**Risk: Low.**

| Risk | Mitigation |
|---|---|
| Coach legitimately needs to *demote* a client after an over-aggressive upgrade. | v1 of the guard refuses downgrade with toast "Downgrade not supported via this flow — contact admin." For a future Medium polish, add a separate "Reset Phase" admin-only action. Out of sweep scope. |
| Coach picks the same phase. | Toast "Client is already on this phase. No change made." Modal stays open. No DB call. No celebration. |
| Coach upgrades by 2 phases (P1 → P3). | Allowed (skip-phase fast-track is a real scenario for advanced clients). Just add a confirmation toast: "Upgrading from Phase 1 directly to Phase 3 — are you sure?" via `confirm()`. |
| `prepPhaseUpgrade` is also called from the Add Client → Edit row path. Need the current-phase fetch to handle any client id. | Single async fetch per modal open. ~1 round-trip. |

### 5.4 Fix strategy

| Step | What |
|---|---|
| 1 | `prepPhaseUpgrade(clientId, clientName)` — async-ify; `SELECT current_phase FROM profiles WHERE id = clientId`. Store on `dataset.currentPhase` of the modal element. Update modal header to "🎉 Phase Upgrade — currently on **Phase N**". |
| 2 | Disable `<option>` elements at or below the current phase in `#pu-phase`. Phase 1 client → P2 and P3 enabled. Phase 2 client → only P3 enabled. Phase 3 client → all disabled + show "Already on the top phase" banner inside the modal. |
| 3 | `submitPhaseUpgrade()` re-reads current phase from `dataset.currentPhase` (cheap re-validation; defends against DOM tampering). Compares to `newPhase`. If `newPhase ≤ currentPhase`: toast error, do not UPDATE. |
| 4 | When valid: if `newPhase` is more than 1 step above current, `confirm()` "Skip-phase upgrade — proceed?" before UPDATE. |
| 5 | When UPDATE returns success: show celebration overlay + dispatch email (existing flow). Trigger fires the inbox notification. |
| 6 | When UPDATE returns success but `data.length === 0` (no row matched): toast "No client matched — refresh and retry." |

### 5.5 Open question (Q-D1)

For Phase 3 clients (already at top), the modal should **either show an "Already at top phase, nothing to upgrade" banner** OR **hide the upgrade button entirely on the client row**. Recommendation: both — disable the row's `⬆ Phase` button + show the banner if the modal opens anyway. Confirms?

---

## 6 · Bonus High items (in scope, bundled with priorities)

### 6.1 H5 — Add-Exercise modal scope mismatch

**Root cause:** Modal at `app.html:1740-1772` offers only 3 categories (`Rehab`, `Mobility`, `Strength`). Live schema allows 5 (`Rehab`, `Mobility`, `Strength`, `Neurology`, `Breathing`) per migration. F5's `ExercisePicker` filter chip "Conditioning" routes to `tag='conditioning'` but the Add-Exercise modal has no tags input — coaches can't tag a new exercise to surface it under that chip.

**Files affected:** `app.html:1740-1772` + `js/clients.js:239-258` (submitAddExercise).

**Fix strategy:**
- Expand `<select id="ex-category">` options to all 5 schema values (+ keep order so existing Rehab/Mobility/Strength remain default-selected).
- Add a tags input: `<input id="ex-tags" placeholder="conditioning, posterior-chain, single-leg…">` — comma-separated, stripped + lower-cased + array on insert.
- Add a target-joints input similarly (`<input id="ex-target-joints" placeholder="hip, knee, ankle">`) — schema already supports it.
- `submitAddExercise` parses both into arrays and inserts.

**Risk: Low.** Pure additive UI fix.

### 6.2 H1 — Login → index.html link (rolled into Priority A)

Single-line fix at `app.html:32-35` — already covered in §2.4 step 7.

### 6.3 H3 — Client Notifications sidebar entry (rolled into Priority C)

Single nav entry — already covered in §4.4 step 5.

### 6.4 H7 — `stat-sessions` from localStorage (rolled into Priority A)

Same root cause as C1 — already covered in §2.4 step 3.

---

## 7 · Verification plan

### 7.1 Per-priority smoke

**Priority A:**
- Open coach Dashboard on a fresh browser (no `_sessions` localStorage). Verify Sessions stat card reads a non-zero count when the coach has any `sessions` row in DB.
- Open Programs page. Verify it lists `client_programs` rows for this coach. New browser still shows them (no localStorage dependency).
- Run Generate as a coach. Verify the new session appears in Recent Sessions panel within the same render.
- Open login page → verify "Back to NeuCore" no longer links to `index.html`.

**Priority B:**
- Deploy edge function. Smoke via MCP: `select net.http_post('https://<project>.supabase.co/functions/v1/generate-program-narrative', {prompt: 'test'}, …)`. Verify response shape.
- With `ANTHROPIC_API_KEY` unset: client-side Generate flow shows warning toast "AI narrative unavailable". Program JSON still generates.
- With `ANTHROPIC_API_KEY` set: full flow returns narrative text; toast is "Program generated!" (no warning).
- Network tab: NO outbound call to `api.anthropic.com` from the browser.

**Priority C:**
- Client with NO assessment yet → Assessment Report card shows the empty state ("Your coach will run an assessment after your first session.") on all 3 rows.
- Client with an assessment → True Driver / Reported Symptoms / Coach's notes show real data; no "Loading…" anywhere.
- Client sidebar shows "Notifications" entry. Clicking it opens `#section-notifications`.
- Mobile bottom nav: as a client, only Home + Community + Notifications visible; as a coach, original 4.

**Priority D:**
- Phase 1 client: modal header reads "currently on Phase 1"; P2 + P3 selectable; downgrade impossible.
- Phase 3 client: modal opens with "Already at top phase" banner; submit button disabled; OR the Phase button on the client row is disabled.
- Coach picks same phase manually (e.g. via DevTools to force): submit catches it, toasts, refuses UPDATE.
- Coach picks two-step upgrade: `confirm()` prompts.

### 7.2 Regression check — F1–F6 still work

- F1 Subscription gate: expired client still gets `#screen-subscription-inactive`.
- F2 Workout tracker: Start/Finish/Log still work; the changes are unrelated.
- F3 Notifications: alt-request trigger still fires; new notification list still renders.
- F4 Progression: v1.1 view still returns scores.
- F5 Exercise library: ExercisePicker still opens; thumbnails still render.
- F6 Substitution: coach can still pick a substitute via the response modal; client still sees the badge.

**Test data cleanup:** any test sessions inserted into `sessions` get deleted after smoke; any test `_sessions` localStorage entries left in coach's browser are harmless (no longer read).

### 7.3 Rollback strategy

| Bucket | Rollback |
|---|---|
| A | `git revert <sweep-commit>`. The DB tables (`sessions`, `client_programs`) are untouched. `_sessions` localStorage was never deleted, so a revert reverts to localStorage-backed behavior with no data loss. |
| B | `git revert` for the JS. Edge function can be left deployed (unused) or deleted via MCP. `ANTHROPIC_API_KEY` secret can stay. |
| C | `git revert` restores the "Loading…" placeholders + removes the sidebar/mobile-nav entries. No data implications. |
| D | `git revert` restores the previous unvalidated submit path. No data implications. |

**The whole sweep is one revert away from the F6 frozen state.** No migrations means no DB rollback to write.

---

## 8 · Commit shape

Two reasonable options — let user choose:

| Option | Commits | Pros | Cons |
|---|---|---|---|
| **(a) One sweep commit** | `fix(sweep): reliability + defect sweep — Priorities A–D` | Tight changelog; matches F1–F4 commit pattern. | Hard to revert one bucket without others. |
| **(b) One per priority** | 4 commits: `fix(sweep-A): …`, `fix(sweep-B): …`, etc. | Surgical revertability; easier code review per bucket. | More noise in `git log`. |

**Recommendation: (a) one commit.** All buckets share the same goal (close audit defects); the verification phase tests them together; rollback is symmetric (the localStorage layer is preserved as a safety net in A, so a partial revert isn't urgent).

---

## 9 · User actions required before the sweep can fully verify

These are the ONLY things I can't do without you:

1. **Provision `ANTHROPIC_API_KEY`** in Supabase project secrets. Required for Priority B's edge function to return real narratives. (Without it, the function returns the structured "AI_NOT_CONFIGURED" response and the coach sees the warning toast — sweep still completes correctly, AI narrative just stays unavailable until the key lands.)
2. **Answer the 4 open questions** (Q-A1, Q-B1, Q-C1, Q-D1) below.
3. **Approve commit shape** — (a) or (b).
4. **(Future, out of sweep scope)** Tighten `sessions` RLS so coaches can't read other coaches' sessions. The current policy `Coaches read all sessions` is a multi-tenant data leak that the audit didn't flag because no UI was exploiting it. Now that the Recent Sessions panel reads from this table, the leak becomes user-visible if I don't filter coach-side. The sweep filters client-side; the proper fix is a tighter RLS policy. Flagged for the next pass.

---

## 10 · Explicitly deferred from this sweep

For traceability and to ensure no item is silently dropped.

### High-severity (deferred — need their own architecture passes)

| ID | Item | Why deferred |
|---|---|---|
| H4 | Client-side workout history view | New section + loader + UI; scope big enough to deserve its own design pass. |
| H6 | Coach reassignment UI | Affects clients table + RLS + notification triggers — non-trivial multi-flow design. |
| H8 | Onboarding flows for coach + client | Multi-screen wizards, UX research needed. |

### Medium-severity (deferred — listed for future tracking)

| ID | Item |
|---|---|
| M1 / TD12 | Community tabs not role-gated |
| M2 / TD13 | RPM Approvals section mixes coach + admin |
| M3 / TD14 | Legacy AST9 branding on `previewWeb` |
| M4 / TD15 | Coaches page Clients column hardcoded |
| M5 / TD16 | No client search/filter |
| M6 / TD19 | Nutrition Plan "Coming soon" dead-end |
| M7 / TD20 | Gait Analysis placeholder |
| M8 / TD21 | No service-worker / offline support |
| M9 / TD24 | 12 pre-existing security advisor warnings |
| M10 | Three competing coach progress surfaces |
| M11 | No admin client list / workload dashboard |
| M12 | Phase-upgrade celebration is coach-only |
| (new, surfaced this pass) | `sessions` RLS lets every coach read every other coach's sessions — visible after Priority A ships |

### Low-severity (deferred)

L1 (grace_days override at create), L2 ("Coach" greeting fallback), L3 (skip tristate), L4 (notif deep-link pre-select), L5 (notification preferences), L6 (Supabase wake indicator), L7 (username vs email).

---

## 11 · Files map (delta this sweep would ship)

```
NEW:
  supabase/functions/generate-program-narrative/index.ts   (≈70 lines)
  RELIABILITY_SWEEP_ARCHITECTURE.md                        (this doc — already on disk)

EDIT:
  js/dashboard.js                                          (≈80 lines net)
    └─ Priority A: stat-sessions, recent-sessions, programs-list rewritten to DB readers
    └─ Priority B: AI block rewired to edge function + honest toast
    └─ Priority D: submitPhaseUpgrade validation
  js/clients.js                                            (≈25 lines net)
    └─ Priority D: prepPhaseUpgrade async + current_phase fetch
    └─ Priority H5: submitAddExercise + 2 new field parses
  js/clientDashboard.js                                    (≈55 lines net)
    └─ Priority C: _renderAssessmentReport + _loadLatestSubjective helpers
  app.html                                                 (≈30 lines net)
    └─ Priority A/H1: "Back to NeuCore" link removed
    └─ Priority C/H3: nav-notifications sidebar entry
    └─ Priority C/H2: mobile bottom-nav role gating + Notifications button
    └─ Priority D: modal current-phase pill + option enabling logic
    └─ Priority H5: Add-Exercise modal — 2 extra categories + tags + target-joints inputs

NO CHANGES:
  Any migration file                  (sweep is migrationless)
  Any frozen-feature module           (auth, subscriptionService, workoutSession,
                                       notificationsService, altExerciseRequest,
                                       progressionEngine, exerciseInstructions,
                                       exercisePicker, programPublish.publish)
  index.html                          (legacy shell, never edit)
```

**Total: 1 edge function + ~190 JS lines + ~30 HTML lines. Zero migrations. Zero new modules.**

---

## 12 · Approval checklist

Before any code is written, the user confirms:

- [ ] Architecture approved as-is OR with marked changes
- [ ] Q-A1 (Programs page narrative inline vs link-to-detail) — chosen option
- [ ] Q-B1 (gate Generate button on AI health check?) — chosen option
- [ ] Q-C1 (Assessment Report empty state: single placeholder vs per-row) — chosen option
- [ ] Q-D1 (Phase 3 client modal: banner + disabled button) — confirmed both
- [ ] Commit shape (a) or (b)
- [ ] `ANTHROPIC_API_KEY` secret will be provisioned before/during/after the sweep (sweep can ship without it; AI just stays in warning state)
- [ ] Acknowledgement that the `sessions` RLS leak surfaced by this audit is logged as a future Medium gap (not fixed this sweep)

On approval, the implementation plan is:

1. (Priority B prereq) Deploy `generate-program-narrative` edge function via MCP. Smoke it.
2. JS edits in dependency-safe order: Priority A → C → D → B → H5. (B last so the deployed edge function is live before the client tries it.)
3. Manual smoke per §7.1.
4. Regression sweep per §7.2.
5. Update `FEATURE_STATUS.md`, `PROJECT_STATUS.md`, `NEXT_STEPS.md`, `PRODUCT_AUDIT.md` (mark closed items).
6. Commit (single or split per choice). Working tree clean. Nothing pushed.
7. Stop. Await signoff.

---

## STOP

No code will be written until the user approves this architecture and answers Q-A1 / Q-B1 / Q-C1 / Q-D1.
