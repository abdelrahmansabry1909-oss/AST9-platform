# DESIGN_QA_CHECKLIST.md — Client Mobile Redesign (S0–S6)

**Type:** Read-only QA audit. Analysis only — no code changed, nothing committed, nothing deployed.
**Date:** 2026-06-06
**Branch:** `claude/interesting-buck-452459` · **HEAD:** `6d22cfd` (S6)
**Scope:** the redesigned client experience (Today · Train · Progress · Coach · More) and the legacy surfaces it touches.
**Method:** static trace of the source + the built `dist/` bundle + live Supabase RLS/data probe (read-only). No browser/device run was available, so visual behavior is inferred from code, not screenshots.

---

## 1. Per-screen matrix

### 1.1 Today — `ClientDashboard.render()` → `#section-client-dashboard` / `#client-dashboard-root`
| Aspect | Behavior |
|---|---|
| **Data source** | `Progression.getScores(clientId)` (view `v_client_progression`) for the recovery dial; `Auth.getProfile()` (name, `current_phase`→stage, subscription pill); `Auth.getSubscriptionState()` + `SubscriptionService` (pill + `canWrite`); `sb.daily_routine_logs` (done-today probe); `sb.notifications` (latest unread, **excludes `subscription%`** after S6 fix). |
| **Empty** | No recovery score → dial shows "–" + "Not yet" + "Complete your first assessment with your coach…". No attention item → attention card is omitted (not a blank box). |
| **Error** | `getScores` rejection is caught → dial degrades to "Not yet" (graceful, no hard error UI). `daily_routine_logs` / `notifications` errors are swallowed (non-blocking). Offline → calm offline note at top. |
| **Subscription-expired** | Dominant CTA becomes "Renew to continue" → routes to Coach. Attention card shows "Your plan has ended" (expired) or "Plan ends in N days" (grace) → Coach. |
| **Mobile** | Today tab; offline note; recovery dial hero; one CTA; ≤1 attention card; dial has `aria-label`. |
| **Desktop** | Reached via `nav-dashboard` (role-aware → client-dashboard). Identical render; `body.nc-client` is set on desktop too, so tokens/theme apply. |

### 1.2 Train — `ClientTrain.render()` → `#section-client-train` / `#client-train-root`
| Aspect | Behavior |
|---|---|
| **Data source** | `Auth.getProfile()` (phase→stage stepper); `ClientUtil.accountability()` → `DailyRoutine.historyFor()` (streak); `DailyRoutine.mountTracker()` (`loadRoutine` + `daily_routine_logs`) on "Start session"; `ProgramPublish.renderClientProgram()` (`client_programs`) on "Your full plan" → which mounts `WorkoutSession.mountWorkouts()` (F2) → exposes `AltExercise.openModal` (F6) + `ExerciseInstructions` (F5). |
| **Empty** | Default `ROUTINE` if none published; program disclosure shows ProgramPublish's own empty state; streak 0. |
| **Error** | `accountability` catches → streak 0; tracker save failure → inline "Save failed — please retry"; offline note at top. |
| **Subscription-expired** | `mountTracker` mounted with `readOnly: !canWrite` → checklist viewable but not loggable, no reset button. Streak/plan still visible. |
| **Mobile** | Train tab; offline note; one dominant "Start session" reveal; "What's next" milestone; "Your full plan" disclosure; streak is `aria-live`. |
| **Desktop** | **No dedicated `nav-client-train` sidebar item** (see Finding D-1). Reached via Today's CTA; legacy "Daily Routine"/"My Program" items show the same embedded content standalone. |

### 1.3 Progress — `ClientProgress.render(container,{open})` → `#section-client-progress` / `#client-progress-root`
| Aspect | Behavior |
|---|---|
| **Data source** | `AssessmentSnapshot.loadLatest()` (assessments + objective + subjective + gait + profile); `Progression.getScores()`; `sb.assessments` + `rehab_objective_assessments.composite_score` (timeline). Disclosures: history (timeline), report (`renderReport`, client-friendly labels), hologram (`mountHologram`→`LoadVisualizer`), advanced (`Progression.mountClientPanel` + `ClientCharts`). |
| **Empty** | Timeline <2 points → "Building" + "Your recovery trend appears as you complete more check-ins."; history empty → "Your check-ins will appear here…"; report empty → "No report yet"; hologram → placeholder if 3D engine not ready. |
| **Error** | `Promise.all` rejection → `ClientUtil.errorState()` ("We could not load your progress" + **Try again**, retry re-renders). Distinct from new-client empty. Offline note at top. |
| **Subscription-expired** | Read-only screen by nature (no writes); fully viewable regardless of subscription. |
| **Mobile** | Progress tab; skeleton while loading; momentum summary; progressive-disclosure detail; hologram opens fullscreen and disposes WebGL on close. |
| **Desktop** | `nav-client-progress` (role-client-only). Identical render. |

### 1.4 Coach — `ClientCoach.render()` → `#section-client-coach` / `#client-coach-root`
| Aspect | Behavior |
|---|---|
| **Data source** | `Auth.getProfile()` (`coach_name` — RLS own-row, currently NULL → generic "Your recovery coach"; `current_phase`→stage; `full_name`→client first name); `Notifications.list()` (own rows via RLS, **filtered to exclude `subscription%`**, top 3 reframed as guidance); `ClientUtil.accountability()` (streak + 7-day consistency); `mailto:hello@neucore.io` CTA. |
| **Empty** | No coach name → "Your recovery coach"; no guidance → warm "No new guidance right now…"; 0/0 consistency → gentle, non-guilt copy. |
| **Error** | `Notifications.list` swallows DB errors internally and returns `[]` → renders the empty state (no separate error UI is reachable here; see Finding S-3). `accountability` → 0. Offline note at top. |
| **Subscription-expired** | Contact CTA (mailto) still works (read path); no writes. |
| **Mobile** | Coach tab; skeletons while loading; Presence → Guidance → Accountability → single Contact CTA. Tab icon is ♥ (not an envelope) to avoid "inbox" framing. |
| **Desktop** | `nav-client-coach` (role-client-only). Identical render. |

### 1.5 More — bottom sheet (`clientShell.openMore`), not a section
| Aspect | Behavior |
|---|---|
| **Data source** | None itself; routes to existing sections. Groups: **Recovery** (Advanced Insights→`my-graph`, Assessment History→`client-progress` `open=history`, Recovery Reports→`client-progress` `open=report`), **Wellness** (Nutrition→`nutrition-plan`), **Resources** (Case Studies, Community, Services), **Account** (Settings→`client-settings`, Sign Out→`__logout`). |
| **Empty / Error** | Inherited from each destination section. |
| **Subscription-expired** | Items remain navigable (read paths). |
| **Mobile** | The "More" tab opens the bottom sheet (scroll-locked, focus-trapped, Escape to close). |
| **Desktop** | The sheet is mobile-only (tab bar hidden >768px). Desktop clients reach the same destinations via the sidebar items directly; the two Progress deep-links are mobile-More-only (desktop opens Progress and expands manually). |

---

## 2. Findings

### 2.1 Duplicated functionality
| ID | Finding | Surface | Severity |
|---|---|---|---|
| **D-1** | **No desktop "Train" nav item**, but legacy `nav-daily-routine` (all-roles) + `nav-my-program` (client) expose the *same* embedded content (`mountTracker`, `renderClientProgram`) standalone. So on desktop a client can reach the routine/program two ways (legacy items + Today→CTA→Train), and the guided Train framing has no sidebar entry. | Desktop client sidebar | Medium |
| **D-2** | `notifications` section (raw inbox) is still reachable by clients on desktop via `nav-notifications` (all-roles), while the Coach tab is the intended client surface for the same data (reframed as guidance). Two views of the same notifications data for desktop clients. | Desktop client sidebar | Low |
| **D-3** | `my-graph` is reachable via **both** More → Advanced Insights (mobile) and `nav-my-graph` (desktop). This is intended parity (one concept, two device surfaces), not a true duplicate. | Both | Info (not a defect) |

### 2.2 Dead navigation paths
- On **mobile**, the client tab bar + More sheet are the only client nav (sidebar + legacy mobile-bottom-nav hidden for `body.nc-client`). `daily-routine`, `my-program`, and `notifications` have **no mobile client entry point** — they are reachable on mobile only indirectly (routine/program are embedded in Train; notifications are reframed in Coach). They are present-but-not-directly-navigable on mobile (not "dead/broken", just not surfaced — by design).
- No genuinely broken/dead links were found: every `onclick="Dashboard.showSection(...)"` target resolves to an existing `#section-…`.

### 2.3 Orphaned sections (reachable but without a clear owner)
- None. Every `#section-…` has at least one nav path (sidebar, tab bar, More sheet, or deep-link). `#section-dashboard` is the **coach/admin** stats home (clients are routed to `client-dashboard` by `showSection`), so it is owned, not orphaned.

### 2.4 Old dashboard UI present but unused
- **None in code.** `clientDashboard.js` was fully rewritten in S1; the old client analytics/cards do not exist in the current source (only in git history). The old coach `#section-dashboard` stats page is still in active use by coaches/admins.

### 2.5 Modules that became obsolete after the redesign
- **None.** The redesign is reuse-first: `DailyRoutine`, `ProgramPublish`, `WorkoutSession`, `AltExercise`, `ExerciseInstructions`, `AssessmentSnapshot`, `Progression`, `ClientCharts`, `Notifications`, `SubscriptionService` are all still used (now via the new client screens). No module lost all callers.
- New modules added in S0–S6 (`clientShell`, `clientDashboard` rewrite, `clientTrain`, `clientProgress`, `clientCoach`, `clientUtil`) all have live callers, and every `ClientUtil` export is used (verified: esc, firstName, greeting, STAGES, stageIndex, stageName, band, ago, accountability, isOffline, skeleton, offlineNote, errorState, trapTab). No dead code introduced.

---

## 3. Cleanup candidate list

### 3.1 Safe to remove now (zero functional risk)
- **Nothing structural.** The redesign left no unreachable sections, no dead modules, and no dead `ClientUtil` exports. There is no zero-risk deletion to make today. (This is a deliberate finding, not an omission.)
- The only true micro-candidate: `clientDashboard._SECTION_FOR` is a defensive fallback used only if `ClientShell` is absent (it never is). Harmless; not worth removing.

### 3.2 Should keep temporarily (remove only after a desktop decision)
- `#section-daily-routine` **client branch** + `nav-daily-routine` visibility for clients — the only desktop client path to the routine until/unless desktop is migrated to the tab model. *(The coach branch of this section is "must keep".)*
- `#section-my-program` + `nav-my-program` (role-client-only) — desktop client's standalone program view; duplicated by Train on mobile.
- `nav-notifications` for clients — desktop client's raw inbox; superseded by Coach on mobile.
- The two Progress deep-links in More (`data-open=history|report`) — keep; cheap and useful, no desktop equivalent needed.

### 3.3 Must keep
- All coach/admin sections and nav (`new-session`, `programs`, `clients`, `subscriptions`, `exercise-library`, `progress`, `workout-history`, `progression`, `coaches`, `settings`, `rpm-approvals`, `analytics`, `gait`, `#section-dashboard` coach stats).
- `daily-routine` **coach** branch (`mountCoachView` adherence dashboard); `notifications` (coach/admin alt-exercise + inbox); `mobile-bottom-nav` (the coach/admin mobile nav — only hidden for `body.nc-client`).
- Every reused module (F1–F7) — all still on the client path.
- The new redesign modules + `css/mobile-shell.css` + `css/client-theme.css`.

---

## 4. Route + feature verification

### 4.1 No client route is broken
Verified the wiring matrix in the built `dist/` bundle: each client tab maps 1:1 to a section + root + loader + render module.
| Tab | TAB_SECTION | Section | Root | Loader | Module |
|---|---|---|---|---|---|
| Today | `dashboard`→`client-dashboard` | `#section-client-dashboard` | `#client-dashboard-root` | `dashboard` | `ClientDashboard.render` |
| Train | `client-train` | `#section-client-train` | `#client-train-root` | `client-train` | `ClientTrain.render` |
| Progress | `client-progress` | `#section-client-progress` | `#client-progress-root` | `client-progress` | `ClientProgress.render` |
| Coach | `client-coach` | `#section-client-coach` | `#client-coach-root` | `client-coach` | `ClientCoach.render` |
| More | — (sheet) | n/a | n/a | per-item `showSection` | clientShell |

### 4.2 No coach/admin route affected
- Client modules render only under client-gated paths: the tab bar needs `body.nc-client` (set only for `role==='client'`); desktop client nav items carry `role-client-only` (hidden by `initShell`).
- Shared-file edits default to prior behavior: `renderReport` label overrides default to the clinical terms (coach caller `clients.js` passes none); Daily Routine dark theme is `body.nc-client`-scoped (coach `.dr-coach-*` untouched).
- Live RLS confirms isolation: `profiles` SELECT = own-row OR admin/coach; `notifications` SELECT = own OR admin. No client screen reads coach/other-client data.

### 4.3 No F1–F7 feature became inaccessible
| Feature | Client entry after redesign | Reachable? |
|---|---|---|
| **F1** Subscription grace + write-gate | Today pill + CTA + attention; Train `readOnly` gate | ✅ |
| **F2** Workout session tracking | Train → "Your full plan" → `renderClientProgram` → `WorkoutSession.mountWorkouts` | ✅ (deep: 2 reveals) |
| **F3** Notifications | Coach tab (reframed guidance) + desktop raw inbox | ✅ |
| **F4** Progression engine | Progress → Advanced insights (`mountClientPanel` + `ClientCharts`) | ✅ |
| **F5** Exercise video/instructions | Train → full plan → program/workout rows (`ExerciseInstructions`) | ✅ |
| **F6** Alt-exercise request | Train → full plan → workout row → ⇄ "Request alternative" (`AltExercise.openModal`) | ✅ (deep) |
| **F7** Assessment / 3D hologram | Progress → "Your latest report" + "Body load map (3D)" | ✅ |

**Note (not a regression):** F2/F5/F6 now live two reveals deep (Train → expand "Your full plan" → workout row). Reachable and intentional, but deeper than before. Candidate for a future discoverability pass, not a defect.

---

## 5. `/simplify` review of the redesign code (proposals only — not applied)

Reviewed S0–S6 files (`clientShell.js`, `clientDashboard.js`, `clientTrain.js`, `clientProgress.js`, `clientCoach.js`, `clientUtil.js`, `css/mobile-shell.css`, `css/client-theme.css`) across reuse / simplification / efficiency / altitude. S5 already extracted `ClientUtil` (esc/stage/band/ago/accountability/state-helpers) and `trapTab`, so the obvious duplication is gone. Remaining proposals:

### 5.1 Components that can be merged / consolidated
- **S-1 (reuse, recommend):** the "collapsible reveal that lazily mounts on first open" pattern is implemented three times — `clientTrain` ("Start session", "Your full plan") and `clientProgress` (`_disclosure`/`_wireDisclosure`). Propose promoting one shared `ClientUtil.disclosure(host,{label,onFirstOpen})` and using it in both. ~30 lines saved, one behavior to maintain.
- **S-2 (reuse, recommend):** the screen header ("Recovery Journey" eyebrow + title) is hand-rolled in Today/Train/Progress/Coach. Propose `ClientUtil.screenHeader(title, {pill})`. Minor, improves consistency.
- **S-3 (altitude, optional):** repeated inline "card" style strings (`border-radius:var(--nc-r-2xl);background:var(--nc-bg-card);border;box-shadow`) appear ~10×. Propose CSS utility classes (`.nc-card`, `.nc-cta`, `.nc-pill`) in `client-theme.css` and reference them instead of inlining. Reduces bundle bytes and centralizes the look. Larger diff; do as its own step.

### 5.2 Components that should remain separate
- **`clientTrain` / `clientProgress` / `clientCoach` / `clientDashboard` should stay separate modules.** They are distinct screens with distinct data and lifecycles (~150–300 lines each). Merging into one "client screens" module would create a god-file and hurt readability. Keep one module per tab.
- **`clientShell` (router/shell) stays separate** from the screens — correct separation of navigation vs content.
- **`ClientUtil` stays client-only** and separate from `notificationsService._ago` (which is shared with the coach inbox); do not merge those.

### 5.3 Unnecessary complexity introduced during S0–S6
- **Heavy inline styling** in template literals is the main source of verbosity (see S-3). Not "wrong", but the largest simplification opportunity; defer to a dedicated CSS-class extraction step.
- **Delegating one-liners** (`const _esc = s => ClientUtil.esc(s)`) add a thin indirection layer in each screen. This was a deliberate low-churn choice in S5 (keeps call sites stable). Acceptable; could be inlined to `ClientUtil.esc(...)` directly in a future tidy, but it is not a defect.
- **No over-engineering found** otherwise: the deep-link uses the existing `window._cpOpen` transient-global pattern (consistent with `_notifParams`); the focus-trap is shared; state helpers are centralized.

**Net:** the redesign code is in good shape. The only meaningful simplifications are S-1 (disclosure helper) and, optionally, S-3 (CSS utility classes). None are urgent; all are presentation-layer.

---

## 6. Recommended cleanup plan (phased, for a future approved step)

> All items are presentation-layer; none require backend changes. Do **not** start until explicitly approved (this document is analysis only).

**Phase 1 — desktop client nav consolidation (resolves D-1, D-2).** Decide the desktop client model:
- *Option A (recommended):* bring desktop clients onto the same five destinations. Add a `nav-client-train` item, and hide the legacy `nav-daily-routine`/`nav-my-program`/`nav-notifications` for clients (keep them for coach/admin). One coherent client IA across mobile + desktop.
- *Option B:* keep desktop on the legacy sidebar and treat the tab bar as mobile-only. Then explicitly document the legacy items as the desktop client surface and drop the half-added `nav-client-progress`/`nav-client-coach` to avoid the asymmetry.

**Phase 2 — code simplification (S-1, optionally S-2/S-3).** Promote the shared `disclosure` helper; optionally the `screenHeader` helper and the CSS utility classes. One commit, verify build + dist.

**Phase 3 — discoverability (optional).** Consider surfacing F2/F6 (workout logging + request alternative) one level shallower in Train, since they currently sit two reveals deep.

**Out of scope / tracked elsewhere:** H-1 (client-side-only write-gate) — see `PRODUCTION_READINESS_AUDIT.md`; the two accepted Low a11y items (modal `aria-hidden` siblings; Daily Routine checkbox Enter/Space) — see `CLIENT_DASHBOARD_MOBILE_REDESIGN.md` §13.

---

## 7. Verdict

The Client Mobile Redesign is **functionally sound and production-ready on mobile**: every client route resolves, no coach/admin route is affected, no F1–F7 feature is inaccessible, and the redesign introduced no dead code or obsolete modules. The one real QA theme is the **desktop client navigation hybrid** (legacy standalone items coexisting with the new client sections, and a missing desktop "Train" entry) — a consolidation opportunity, not a breakage. Recommended next action: approve **Phase 1** (desktop nav consolidation) before resuming Feature 8.

---

## 8. Update — Phase 1: Desktop Navigation Consolidation (APPLIED)

**Status:** Implemented. Presentation-layer only (one file: `app.html`). No JS, schema, RLS, migration, edge-function, or backend changes.

**Changes (desktop sidebar nav only):**
- **Added** `nav-client-train` (`role-client-only`) → `showSection('client-train')`, placed with Progress + Coach. Desktop client primary nav now reads **Today (Dashboard) · Train · Progress · Coach**, matching the mobile tab bar.
- **`nav-daily-routine`**: `nav-item` (all roles) → `nav-item role-coach-admin`. Coaches/admins keep the adherence dashboard; clients no longer see the duplicate (their routine lives in Train).
- **`nav-notifications`**: `nav-item` (all roles) → `nav-item role-coach-admin`. Coaches/admins keep the inbox + alt-exercise queue; clients use the Coach tab (reframed guidance).
- **`nav-my-program`**: `role-client-only` → hidden (`style="display:none"`, no role class). It was client-only and is folded into Train → "Your full plan". `#section-my-program` + `renderClientProgram` kept intact.

**Findings resolved:** **D-1** (no desktop Train item + Daily Routine/My Program duplicates) and **D-2** (raw Notifications nav for clients) are resolved at the navigation level.

**Coach/admin impact:** none. Daily Routine + Notifications were already coach-visible (bare `nav-item` = all roles); coaches/admins see the exact same items as before. My Program was never coach-visible. `role-coach-admin` count 18 → 20 (Daily Routine + Notifications joined the gate); coach **visible** set unchanged.

**Feature reachability after consolidation (re-verified):** F1 (Today), F2 + F5 + F6 (Train → "Your full plan" → program/workout/⇄ alt-exercise), F4 progression + F7 assessment/hologram (Progress) — all reachable. The new desktop **Train** item is what makes hiding Daily Routine/My Program safe (it provides the same routine + program + workout + alt-exercise chain on desktop).

**New cleanup opportunity discovered (NOT changed — out of this scope):**
- **N-1 (Low):** the sidebar-footer **notification bell** (`#notif-bell`, no role gate) still routes desktop clients to the raw `notifications` section via `showSection('notifications')`. It is a footer affordance (not one of the scoped nav items) and is shared with coach/admin. To fully unify the client IA, hide `#notif-bell` for clients on desktop (they have the Coach tab) while keeping it for coach/admin. Deferred for a future approved step.
- **N-2 (Info):** `nav-my-program` is hidden via a one-off inline `display:none` rather than a role class (no "always-hidden" class exists). Fine for a single retired item; introduce a shared `hidden`/`is-retired` utility only if more items get retired.

**Verification:** `npm run build` green; `dist/app.html` confirms the four edits; sections + loaders for daily-routine/my-program/notifications intact; coach/admin visible nav unchanged; client Train loader reachable. No route regressions.
