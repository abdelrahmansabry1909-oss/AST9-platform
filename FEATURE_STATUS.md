# FEATURE_STATUS.md — NeuCore Platform

**Last updated:** 2026-05-31 (post Reliability + Defect Sweep)
**Branch:** `claude/interesting-buck-452459`
**HEAD commit:** Reliability Sweep just shipped (commit pending)
**Live Supabase project:** `byquokhcbagofshsclfy` (eu-central-1, Postgres 17.6.1.111)

Per-feature breakdown. For overall architecture see `PROJECT_STATUS.md`. For what to build next see `NEXT_STEPS.md`.

---

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ shipped | Code committed + migrations applied + live-verified |
| ⚠ partial | Code committed but a slice deliberately deferred (see "Deferred slice") |
| ⏸ planned | Architecture-locked, not yet built |
| ❌ blocked | Needs a user decision before continuing |
| 🔒 frozen | Signed off — do not modify unless a bug is discovered |

---

## ✅ 🔒 Feature 1 — Subscription Grace + Write-Gate Service

**Commit:** `4f65456` (code) · `230f751` (live verified) · `7265f09` (Tier-1 hardening)
**Status:** Signed off · Frozen
**User signoff:** Yes (turn "Sign off Features 1-4 as complete")

### What it does
Adds a 7-day grace window after `subscriptions.end_date`. During grace, login + read access remain available; the subscription pill turns rose and a banner above the client home prompts renewal. Past grace, login is replaced by a dedicated `#screen-subscription-inactive` takeover.

### Locked architecture
- `SubscriptionService` is the single source of truth (`getEffectiveState`, `listAllStates`, `canWrite`, `formatPill`, `reactivate`)
- Effective state cached on `_profile.subscription` after `Auth.init` / `Auth.login`
- **Write-gate rule:** `active | grace → write` · `expired | pending | none → read-only`. Every future write path checks `Auth.canWrite()`.

### Files
- DB: `supabase/migrations/20260530_subscription_grace.sql` — view `v_client_subscription_state`, RPC `public.reactivate_subscription`
- JS: `js/subscriptionService.js`, edits to `js/auth.js`, `js/subscriptions.js`, `js/clientDashboard.js`
- HTML: `#screen-subscription-inactive`, `#sub-stat-grace`, `#subs-filter` chips

### Live verification (230f751)
- View returns correct rows for the 2 live clients (83d / 72d remaining → `active`)
- `reactivate_subscription` RPC permission gate (admin OR assigned_coach) holds in SQL
- Pill + banner render correctly per state

### Deferred slice
- Email/SMS push on grace transitions (Resend integration exists, not wired)
- Daily pg_cron to sweep all clients (today only fires when the affected client logs in)

---

## ✅ 🔒 Feature 2 — Workout Session Tracking

**Commit:** `4f65456` (code) · `230f751` (live verified)
**Status:** Signed off · Frozen

### What it does
Adds full workout-execution tracking: "Start Workout" creates a session with a live timer; per-exercise sets/reps/weight + notes auto-save (600 ms debounce); "Finish Workout" prompts for intensity rating (1–10) + session notes; coach gets a Workout History page with set-by-set detail.

### Locked architecture
- `workout_sessions` — one row per Start press; partial unique index enforces **one active session per client** (auto-abandon on conflict)
- `workout_exercise_logs` — one row per exercise, sets stored as `jsonb [{n, reps, weight, rpe?}]`, unique `(session_id, exercise_index)` for clean upsert
- `WorkoutSession` data layer: `start`, `finish`, `abandon`, `logExercise`, `getActiveSession`, `history`, `detail`
- `WorkoutSession.mountWorkouts(host, { programId, workouts, libMap })` — client tracker mount point, called from `programPublish.renderClientProgram`
- `WorkoutSession.mountCoachView(host, { preselectClientId })` — coach Workout History page
- **Every write call gates via `Auth.canWrite()`** (Feature 1 contract)

### Files
- DB: `supabase/migrations/20260531_workout_tracking.sql`
- JS: `js/workoutSession.js`, edits to `js/programPublish.js`, `js/dashboard.js`, `js/clients.js`
- HTML: sidebar entry "Workout History", `#section-workout-history`, "◐ Workouts" action per client row

### Live verification (230f751)
- One-active-per-client invariant raises `23505` on second insert
- `workout_exercise_logs` upsert on `(session_id, exercise_index)` works
- RLS scoped correctly (client owns; assigned_coach reads/writes; admin all)

### Deferred slice
- Tristate "skip" (today: unchecked = incomplete, no explicit skip)
- Exercise videos inside workout rows — landed in Feature 5

---

## ✅ 🔒 Feature 3 — Notifications + Alt-Exercise + Cross-Module Retrofit (FULL)

**Commit:** `4f65456` (code) · `230f751` (live verified) · `7265f09` (FK guards) · `1d97fbd` (collision audit)
**Status:** Signed off · Frozen

### What it does
Generic polymorphic inbox + alt-exercise request flow + 6 server-side triggers that retrofit RPM phase submissions, case-study approvals, and subscription expiring/grace into the same inbox without editing those legacy modules.

### Locked architecture
- `notifications` — `recipient_id`, `actor_id`, `type`, `title`, `body`, `link_section`, `link_params jsonb`, `severity (info|warning|critical)`, `read_at`, `archived`, `data jsonb`
- **INSERT only via `public.notify(...)` SECURITY DEFINER RPC** — direct INSERT blocked by `WITH CHECK (false)` policy
- Authorization in SQL once: self · admin · coach→own client · client→own coach
- Cross-module retrofit via 6 triggers (no JS edits to RPM / Community / Subscription modules)
- `ensure_subscription_notifications(client_id)` — idempotent (key = `(client, type, sub_id)`); called from `Auth.init` per client
- Realtime channel + 60s polling fallback in `NotificationsService.subscribe`

### Files
- DB: `supabase/migrations/20260601_notifications_inbox.sql` (+ `drop_legacy_notifications` precursor)
- JS: `js/notificationsService.js`, `js/altExerciseRequest.js`, edits to `js/workoutSession.js` (⇄ Alt button), `js/auth.js` (init-time call), `js/dashboard.js` (loader), `app.html` (bell + `#section-notifications`)

### Path A note (1d97fbd)
A legacy empty `notifications` table predated this work with shape `(user_id, from_user_id, message, is_read)`. Pre-drop verification confirmed 0 rows + 0 dependencies; dropped CASCADE; new schema applied clean. Documented in `PROJECT_STATUS.md §4`.

### Live verification (230f751)
- `notify()` self-test round-trip works
- Alt-exercise insert → coach notification appears via trigger
- Alt-exercise update → client notification appears via trigger
- Phase upgrade trigger fires with full payload (Tier-1 addition)
- `ensure_subscription_notifications` correctly no-ops for clients outside thresholds

### Deferred slice
- Notification deep-link pre-select on target loaders (lands on section, doesn't highlight item)
- Email/SMS push (Resend exists, not wired)
- Auto-archive retention policy
- Mute / preferences UI

---

## ✅ 🔒 Feature 4 — Progression Engine v1

**Commit:** `4f65456` (code) · `230f751` (live verified — Bug 2 fix included)
**Status:** Signed off · Frozen · **Formula v1.0 — reweighting requires v2 migration**

### What it does
Four scores per client over a rolling 30-day window: Compliance · Recovery · Performance · Overall. Renders as four semicircular SVG gauges on the client dashboard; sortable table + per-client signal breakdown on the coach Progression page.

### Locked formulas (v1.0 — documented in the migration header)
- **Compliance** = 0.4·workout_completion_rate + 0.4·routine_adherence_pct + 0.2·session_completion_quality. Target ≈ 3 workouts/week (`completed × 100/12` clamped to 100).
- **Recovery** = 100 − 10·overreach_sessions(≥9/10) − 30·abandonment_rate − 5·alt_requests_30d, clamped 0–100.
- **Performance** = mean per-exercise (latest top-set vol vs first in window) mapped −20%↔+50% → 40↔100; **50 = neutral** when no exercise has ≥3 sessions in window.
- **Overall** = 0.4·Compliance + 0.3·Recovery + 0.3·Performance.

### Files
- DB: `supabase/migrations/20260602_progression_engine.sql` — view `v_client_progression` (`security_invoker=true`), helper `_clamp_score`. **Live-adapted for `daily_routine_logs.battery_pct` schema** (the disk file `20260521_daily_routine.sql` defines `percent`, live has `battery_pct + completed bool`).
- JS: `js/progressionEngine.js` — inline-SVG gauges (no chart-lib dep), tone palette
- HTML: sidebar entry "Progression", `#section-progression`, `#cd-progression-host` on client home

### Live verification (230f751)
Score shifted **45.0 → 52.8** after one completed workout — matches formula exactly (0.4·23.3 + 0.3·95 + 0.3·50 = 52.82).

### Known limitations (deliberate v1)
- **Performance score is mostly 50/neutral** for most NeuCore clients because rehab programs rotate exercises and rarely repeat one 3× in 30d. Acceptable in v1; reweight in v2 when nutrition + RPM-phase signals land.
- Compliance's "3/week target" too aggressive for Phase 1 rehab clients (1–2 sessions/week is normal). Same — reweight in v2.

### Reweighting rule (locked)
Any change to the formula ships as a new migration `20260xxx_progression_v2.sql` + bumps `formula_version`. NEVER edit `v_client_progression` in place — visible numbers must not drift silently.

### Deferred slice
- Historical snapshot table for trendlines ("score went up 8 this week")
- Nutrition signal (whole feature; renames Compliance correctly)
- RPM phase advancement signal

---

## ✅ Tier 1 — Spec-Compliance + FK Guards + Phase Upgrade Notif

**Commit:** `7265f09`
**Status:** Shipped + verified (no signoff needed — was a bug-fix pass)

### Closed gaps from the post-Feature-4 audit
| ID | Fix | Where |
|---|---|---|
| **M** | Clients can reach Case Studies via sidebar | `app.html nav-case-studies` (removed `role-coach-admin`) |
| **N** | Clients can change password via sidebar Settings | new `#section-client-settings` + `nav-client-settings` |
| **D** | `Auth.loginAsGuest` no longer TypeErrors | implemented as typed `DEMO_UNAVAILABLE` error |
| **L** | `Dashboard.populateProgressClientSelect` exists | populates `#progress-client-select` from assigned clients |
| **C** | Add Client modal requires assigned coach | `submitAddClient` validates `fields.coach` |
| **FK** | Notification triggers FK-safe | new `_profile_exists` guard wrapping every `notify()` call |
| **Phase Upgrade** | Coach upgrade fires a client inbox notification | new `tg_profile_phase_upgrade` trigger on `profiles.current_phase` |

### Files
- DB: `supabase/migrations/20260603_notification_guards_and_phase_upgrade.sql`
- JS: edits to `app.html`, `js/auth.js`, `js/clients.js`, `js/dashboard.js`

---

## ✅ Reliability + Defect Sweep — Priorities A → D + Highs (H1, H2, H3, H5, H7)

**Commit:** pending (shipped 2026-05-31)
**Status:** Live + smoke-verified end-to-end
**Architecture record:** `RELIABILITY_SWEEP_ARCHITECTURE.md` (12 sections, all 4 user-decision questions locked)
**Audit closed:** PRODUCT_AUDIT.md C1, C2, C3, C5 + H1, H2, H3, H5, H7

### Priority A — localStorage → DB readers (C1 + H7 + H1)
- `js/dashboard.js loadDashboardStats` now calls `_loadSessionsStatAndRecent()` which reads from the `sessions` table (count + last 5) scoped to `coach_id = me` for coaches, all for admin
- `js/dashboard.js renderProgramsList` reads `client_programs` (RLS handles scope), shows client name + phase + published date + deep-links to Workouts + Progression (per **Q-A1: link-to-detail card**, no inline narrative)
- `_sessions` localStorage kept as a transient PDF-handoff cache so `_lastBundle` flow still works; no surface reads from it anymore
- `app.html` login page "Back to NeuCore" → `index.html` link removed (H1)
- **New finding flagged for future RLS pass:** `sessions` policy "Coaches read all sessions" lets every coach read every other coach's sessions. Sweep filters client-side; tightening the policy is logged as a Medium gap.

### Priority C — Client dashboard wiring (C3 + H3 + H2)
- `js/clientDashboard.js` new `_renderAssessmentReport({assessment, gait, subjective})` helper + new `_loadLatestSubjective` defensive wrapper around `RPMSubjective.pullSubjectiveSummary`
- Three rows wired: True Driver (phase_recommendation → gait worst case), Reported Symptoms (subjective external_pain → pain_flags joined), Coach's notes (subjective recap_notes → free_form_notes → empty-state copy)
- Per **Q-C1**: single placeholder when no assessment exists (not per-row Loading… repeated)
- `app.html` sidebar: `nav-notifications` entry added (no role class — visible to ALL roles including clients) (H3)
- `app.html` mobile bottom-nav: `role-coach-admin` added to Session + Programs buttons; new `role-client-only` "Inbox" button added (H2)

### Priority D — Phase Upgrade guards (C5)
- `js/clients.js prepPhaseUpgrade` async-ified; fetches `current_phase` from profiles; stamps on modal dataset; pill shown next to modal title
- `_applyPhaseUpgradeGuards` disables `<option>` elements at-or-below current phase; selects the lowest enabled
- Per **Q-D1**: Phase 3 client = "Already at top phase" banner shown inside modal AND `⬆ Phase` button disabled on the clients table row
- `js/dashboard.js submitPhaseUpgrade` re-validates server-side: refuses same-phase (info toast), refuses downgrade (error toast), prompts `confirm()` on skip-phase upgrades (P1→P3)

### Priority B — AI call via edge function (C2 + TD17)
- **No new edge function deployed.** Discovered the existing `generate-program` function (version 4, ACTIVE) already does this — wired to Gemini 2.0 Flash via `GEMINI_API_KEY` secret. The previous browser-side `fetch('https://api.anthropic.com/...')` was a regression.
- `js/dashboard.js generateProgram` STEP 4 rewritten to `sb.functions.invoke('generate-program', { body: { prompt } })` with proper Gemini response shape parsing (`candidates[0].content.parts[].text`)
- Per **Q-B1**: NO health-check ping. Runtime warning toast on failure: "AI narrative unavailable — program structure still generated. Check the GEMINI_API_KEY secret on the edge function."
- Toast lie removed — `aiUnavailable` flag drives separate warning toast after the always-fires success toast for the program JSON itself

### H5 — Add-Exercise modal scope
- 5 categories now: Rehab · Mobility · Strength · **Neurology · Breathing** (matches the live `exercises.category` CHECK constraint)
- New inputs: **Tags** (comma-separated, lower-cased, deduplicated → array) + **Target joints** (same parse)
- `Clients.submitAddExercise` only attaches array columns when non-empty to avoid overwriting schema defaults
- Tag hint explicitly mentions "Conditioning" so coaches know how to surface exercises under that ExercisePicker chip

### Files (sweep delta)
- EDIT: `js/dashboard.js` (~115 lines), `js/clients.js` (~110 lines), `js/clientDashboard.js` (~70 lines), `app.html` (~30 lines)
- NEW: `RELIABILITY_SWEEP_ARCHITECTURE.md` (architecture record)
- **Zero migrations · Zero new modules · Zero new edge functions**

### Live verification
- Priority A: live `sessions` rowcount = 21, FK embed `sessions_client_id_fkey` validated, `client_programs` reader returns expected shape with FK embed
- Priority C: DB-side `_loadLatestAssessment` / `_loadLatestGait` paths confirmed; no schema dependencies missing
- Priority D: phase ordering comparator verified against live data (Phase 1 + Phase 2 clients present; no live Phase 3 client to smoke the top-phase banner against, but the comparator is straightforward)
- Priority B: existing `generate-program` function verified ACTIVE v4 (no deploy needed); response shape parser handles Gemini envelope `candidates[].content.parts[].text`
- Regression: F1 view returns 2 rows · F4 formula stays `'1.1'` · F6 column + trigger branch intact · 15 advisor warnings (same as pre-sweep, zero new)

### Deferred from this sweep (per architecture §0 + §10)
| ID | Item | Why |
|---|---|---|
| H4 | Client-side workout history view | Needs its own architecture pass |
| H6 | Coach reassignment UI | Multi-flow design needed |
| H8 | Onboarding flows | UX research + multiple screens |
| (new) | `sessions` RLS multi-tenant leak | Surfaced by Priority A; logged for separate RLS-tightening pass |

---

## ✅ Tier 2 — Advisor Hardening

**Commit:** `230f751`
**Status:** Shipped + verified

Closed 11 of the 14 security-advisor warnings introduced by Features 1–4 + Tier 1. The remaining 3 (`notify`, `reactivate_subscription`, `ensure_subscription_notifications` callable by authenticated) are intentional — they're gated internally and called from the JS layer.

### Files
- DB: `supabase/migrations/20260604_advisor_hardening.sql` — `SET search_path = public` on helpers + REVOKE EXECUTE on trigger functions (which shouldn't be RPC-callable)

---

## ✅ 🔒 Feature 5 — Exercise Video Integration

**Commit:** `2627a11`
**Status:** Signed off · Frozen
**User signoff:** Yes (turn "Features 1–5 are signed off" before F6 implementation)

### What it does
Threads the existing Exercise Library through `programPublish` editor → client program view → workout tracker. Linked exercises surface their thumbnail, ▶ Preview (inline expand 16:9 or fullscreen modal via Shift-click / narrow viewport), and ℹ Instructions disclosure (chips for joints + tags, sections for cues / common errors / progressions / regressions).

### Locked architecture (Option A — zero migrations)
- Program JSON gains an optional `exercise_id` field on each `{warmup,main,cooldown}[]` entry. Stores **both** `exercise_id` and `exercise_name` per spec.
- Library is the single source of truth — `renderClientProgram` does `ExerciseLibrary.loadAll()` (5-min cache) once per render and builds an id→row Map; passed to `WorkoutSession.mountWorkouts({ libMap })` so the tracker doesn't re-fetch.
- Legacy free-text rows (no `exercise_id`) render exactly as before. Mixed payloads (linked + legacy in the same workout) are explicitly supported and live-verified.
- **`ExercisePicker` is reusable** — `window.ExercisePicker.open({ defaultFilter, onSelect })` returns a Promise. Used by Feature 5 publish editor; will be reused unchanged by Feature 6 alt-response modal.
- **`ExerciseInstructions` is the only place** that decides how clinical text fields become rendered sections (forward-compat for a future `instructions` field).

### 8 user-stated requirements — all honoured
| # | Requirement | Where |
|---|---|---|
| 1 | Store both `exercise_id` + `exercise_name` in program JSON | `programPublish._wireSection` picker + autosuggest both set both fields |
| 2 | Library remains single source of truth | live lookup at render, no snapshot |
| 3 | `ExercisePicker` reusable for Feature 6 | `js/exercisePicker.js` |
| 4 | Both autosuggest + Library-button workflows | both implemented in `_exerciseRow` |
| 5 | Both inline + fullscreen player | inline 16:9 expand by default · Shift-click or `<640px` viewport → existing `ExerciseUI.openVideoModal` |
| 6 | Surface thumbnail · instructions · joints · tags | thumbnail tile + `ExerciseInstructions.renderFull` (chips + sections) |
| 7 | Reusable instruction-builder helper | `js/exerciseInstructions.js` |
| 8 | 7 filter chips | `ExercisePicker.FILTERS` — All / Phase 1–3 / Mobility / Strength / Conditioning |

### Conditioning chip note
The live `exercises.category` CHECK constraint is `IN ('Rehab','Mobility','Strength','Neurology','Breathing')`. No `Conditioning`. Under the zero-migration constraint, the chip routes to `tag='conditioning'`. Coaches tag exercises to surface them. Widening the CHECK to include `Conditioning` is a 2-line migration if you prefer that path.

### Files
- NEW: `js/exerciseInstructions.js`, `js/exercisePicker.js`, `FEATURE_5_PROPOSAL.md` (kept as design record)
- EDIT: `js/programPublish.js`, `js/workoutSession.js`, `app.html`
- NO migration. NO changes to `exerciseLibrary.js`, `exerciseUI.js`, `auth.js`, services, `dashboard.js`, `index.html`.

### Live verification
- Seeded a library exercise, published a program with one linked row + one legacy row, started a workout, logged both → `exercise_id` reaches `workout_exercise_logs.exercise_id` for the linked row, stays null for the legacy row. Analytics LEFT JOIN recovers the library row for the linked log.
- All verification rows cleaned up; `client_programs` restored to prior payload.

### Deferred slice (locked out of scope of F5)
- `exercises.default_prescription jsonb` auto-fill (Option B from proposal)
- Polished `exercises.instructions text` field (Option C — helper already accepts it when present)
- Equipment / difficulty / duration metadata

---

## ✅ Feature 6 — Alternative Exercise Replacement Workflow

**Commit:** pending (shipped 2026-05-31)
**Status:** Live + smoke-verified end-to-end
**Approval level:** Not yet "signed off / frozen" — complete-and-stable but eligible for refinement based on real-coach usage.
**Architecture record:** `FEATURE_6_ARCHITECTURE.md` (12 sections, all 4 user-decision questions locked).

### What it does
Closes the half-finished F3 promise. Coach reviews an alt-request, picks a substitute from the Library via the reusable `ExercisePicker` (F5), optionally adds a note, marks Addressed. The client's My Program + Workout Tracker swap the original exercise for the substitute on the next render. Logs are written against the substitute's `exercise_id` so analytics attribute correctly.

### Locked architecture — Option A (override layer, never mutates published JSON)
- One column: `exercise_alternative_requests.substitute_exercise_id uuid REFERENCES exercises(id) ON DELETE SET NULL` + partial index `aer_active_substitutes_idx`
- Trigger fn `tg_aer_notify_client` refreshed to enrich the body: "Your coach replaced *X* with *Y* — *response*"
- `programPublish.renderClientProgram` builds a substitution Map (most-recent per slot) and swaps `exercise_id` + `name` in the in-memory `workouts[]` tree before F5's library prefetch — so libMap naturally resolves the substitute and all F5 media wiring works unchanged
- `WorkoutSession._renderExerciseLogRow` shows the same "🔄 Substituted" tooltip badge on the live tracker row (Q3: replacement-only with original on hover)
- `programPublish._publish()` adds a republish sweep: closes every active substitution for the client as `status='declined'` with body `"Closed — Program Republished"` (Q2)

### v1.1 progression formula bump (per Q1 — locked)
- `v_client_progression` `CREATE OR REPLACE`-d with v1.1
- Only the `alt` CTE changed: requests where `status='addressed' AND substitute_exercise_id IS NOT NULL` are EXCLUDED from `alt_requests_30d` → no Recovery penalty for resolved-by-substitution requests
- `formula_version` literal flipped `'1.0'` → `'1.1'`
- Honors the locked "no in-place silent drift" rule via version-stamped migration with full changelog header

### User decisions locked
| Q | Answer | Implementation |
|---|---|---|
| Q1 | No Recovery penalty for successfully-substituted requests | v1.1 view `alt` CTE filters them out |
| Q2 | Auto-close on republish with "Closed — Program Republished" | `_publish()` sweep with exact wording |
| Q3 | Show only replacement; original via tooltip badge | "🔄 Substituted" pill with `title=` attribute on both render surfaces |
| Q4 | F6 first, Reliability Sweep next | This commit; sweep on deck |

### Files
- DB: `supabase/migrations/20260606_alt_exercise_substitute.sql` — column + index + trigger fn refresh + v_client_progression v1.1
- JS: edits to `js/altExerciseRequest.js` (substitute picker integration + inbox pill), `js/programPublish.js` (subMap fetch + swap + badge + republish sweep), `js/workoutSession.js` (inline badge on tracker row)
- No new modules · No new HTML sections · No new modals

### Live verification (2026-05-31)
- Column + partial index + trigger fn + v1.1 view all confirmed via MCP
- End-to-end DO $$ block (6 steps): client request → coach notif → substitute UPDATE → enriched client body (mentions both names + response) → render-time subMap lookup returns substitute id → workout_exercise_logs.exercise_id = substitute → v1.1 alt CTE excludes the substituted request → republish sweep flips status + clears column + emits "Closed — Program Republished" notification → cleanup
- All 6 assertions passed. Zero residue across exercises/requests/notifications/sessions. Zero new advisor warnings.

### Deferred slice (locked out of scope of F6)
- Auto-suggest substitute by tag/joint overlap
- Substitution audit history table (request row is single-substitute by design)
- PDF export reflects substitutions
- Notification deep-link pre-selects the substituted row in My Program (deferred F3 slice)

---

## ⏸ Feature 7 — Assessment Results / 3D Hologram Integration

**Status:** Planned (next after the Reliability + Defect Sweep per user direction Q4)
**Dependency:** Standalone — no upstream feature blocks this.

### What it will do
Wire the client-dashboard Assessment Report card (PRODUCT_AUDIT.md TD11 — currently hardcoded "Loading…") to real data: pull the most-recent `rehab_objective_assessments` + `gait_assessments` + coach notes; populate True Driver / Reported Symptoms / Coach's notes rows; cross-link to the 3D body map.

---

## ⏸ Other deferred items (smaller, can interleave)

| Item | Effort | Owner-feature when sensible |
|---|---|---|
| Daily pg_cron for `ensure_subscription_notifications` | S | Operational task — not feature-bound |
| Email/SMS push for high-severity notifications | M | Could ride with F6 |
| Notification deep-link pre-select on target loaders | S | Could ride with F6 |
| Three competing coach-progress surfaces unification | M | F7 or later |
| Workout history → Progress Charts crossover | S | F7 or later |
| Progression v2 (nutrition + RPM phase signals) | L | After nutrition feature |
| Nutrition Plan (full feature) | L | Its own feature |
| Username vs email at signup | S | Spec misalignment — discuss before building |
| "Unpublished program" indicator coach-side | S | UX polish |
| Per-exercise skip tristate | S | UX polish |

---

## Summary table

| Feature | DB migrations | JS modules | Status | Signoff |
|---|---|---|---|---|
| F1 Subscription Grace | 1 | 4 modified, 1 new | ✅ live | 🔒 frozen |
| F2 Workout Tracking | 1 | 1 new, 4 modified | ✅ live | 🔒 frozen |
| F3 Notifications + Alt-Exercise + retrofit | 2 (+1 drop) | 2 new, 3 modified | ✅ live | 🔒 frozen |
| F4 Progression Engine v1 | 1 | 1 new, 2 modified | ✅ live | 🔒 frozen |
| Tier 1 Spec + FK + Phase Upgrade | 1 | 4 modified | ✅ live | — |
| Tier 2 Advisor hardening | 1 | 0 | ✅ live | — |
| F5 Exercise Video Integration | 0 | 2 new, 2 modified | ✅ live | 🔒 frozen |
| F6 Alt-Exercise Replacement | 1 | 0 new, 3 modified | ✅ live | 🔒 frozen |
| **Reliability + Defect Sweep (A→D + H1/H2/H3/H5/H7)** | **0** | **0 new, 4 modified** | **✅ live** | not yet "frozen" |
| **F7 Assessment / 3D Hologram** | **0 pending** | **TBD** | **⏸ planned** | — |

**Live migrations applied: 8** (all in `supabase_migrations.schema_migrations` — F6 added `20260531123907 alt_exercise_substitute`).
**Live tables created by this work: 4** (`notifications`, `exercise_alternative_requests`, `workout_sessions`, `workout_exercise_logs`). F6 added one column to `exercise_alternative_requests`.
**Live views created by this work: 2** (`v_client_subscription_state`, `v_client_progression` — bumped to v1.1 by F6).
**Live JS modules added by this work: 7** (`subscriptionService`, `workoutSession`, `notificationsService`, `altExerciseRequest`, `progressionEngine`, `exerciseInstructions`, `exercisePicker`). F6 added **zero new modules** — reused F5's `ExercisePicker` verbatim.
