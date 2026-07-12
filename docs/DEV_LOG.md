# AST9 Dev Log

> Chronological log of major completed phases. Dates and PR/commit values are
> verified against `gh pr list` and `git log origin/main` (Phase R0, 2026-06-27).
> Earlier rehab phases (pre-#48) are summarized in the root `FEATURE_STATUS.md`
> and `PROJECT_STATUS.md`; this log focuses on the recent program-versioning and
> Athletic Performance arc plus the active hotfixes.

Verification legend:
- **DB-verified** — migration applied to the live prod DB and RLS verified by
  transaction-local impersonation (admin/coach/client).
- **Owner visual** — frontend reviewed by the owner in the browser; no automated
  browser smoke is available in this environment (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).
- **Backend-reproduced** — payload accepted/denied confirmed against the live
  schema by impersonated, rolled-back SQL.

---

## Client access subscriptions

### Phase A — Admin/coach subscription management
- **Date:** 2026-07-10 · branch `feat/client-subscription-management`
- **What:** An admin **or the client's assigned coach** can now create/edit a
  client access subscription (custom label `plan_name`, custom months 1–60,
  dates, notes, active/pending status) via two `SECURITY DEFINER` RPCs —
  `create_client_subscription()` and `update_client_subscription()` — that check
  `is_admin() OR profiles.assigned_coach = auth.uid()` in SQL. **Table RLS is
  unchanged** (direct writes stay admin-only via `subscriptions_admin_write`);
  coaches never write the table directly. Widened the old `plan IN (3,6,12)`
  CHECK to `plan BETWEEN 1 AND 60`, added an `end_date > start_date` CHECK, and a
  `plan_name` column (≤80 chars). Manual client-access management — no payment
  provider; unrelated to `coach_subscriptions` billing/slots.
- **Files:** `supabase/migrations/20260710000000_client_subscription_management.sql`,
  `supabase/rollbacks/20260710000000_client_subscription_management_down.sql`,
  `js/subscriptionService.js`, `js/subscriptions.js`, `app.html` (subscription
  modals + New-Subscription button role).
- **Verification:** DB-verified — impersonated, rolled-back role matrix
  (admin ✓, assigned coach ✓, other coach ✗, client ✗, months-range ✓,
  plan_name persist ✓, direct coach table write blocked by RLS ✓; zero test
  rows left). Advisor `0028`/anon clean (explicit anon `EXECUTE` revoked,
  matching `reactivate_subscription`). `node --check` + `npm run build` green;
  boot smoke: modal fields present, no console errors. Owner authenticated
  smoke pending (no creds in this environment).
- **Secondary review (Fable 5, advisory) + fixes:** Fable flagged a **blocker**
  and a **major** that Claude confirmed against local evidence and fixed in the
  same PR:
  - `update_client_subscription` originally accepted `status='cancelled'`, but
    `v_client_subscription_state` (in `20260530202308_subscription_grace.sql`)
    has **no `cancelled` branch** → a future-dated cancelled row read as
    `active` and kept write access. Fix: **drop `cancelled`** from the accepted
    statuses (it was never offered in the UI; the effective-state view is left
    untouched — the latent gap is now unreachable and logged in
    [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).
  - Coach could set `expired`/`cancelled` via the edit RPC (End is admin-only).
    Fix: **only an admin may set `expired`**; coaches are limited to
    active/pending (RPC-enforced; the `es-status` picker hides `expired` for
    non-admins).
  - Minor fixes folded in: derive the create end-date **after** the range check
    (friendly error, not date-overflow); require the target to be `role='client'`;
    cap `notes` at 2000 chars; add the missing `.select()` honesty guard to
    `activate()`. Re-verified (real non-admin coach: create ✓, update
    active/pending ✓, set-expired ✗, set-cancelled ✗, foreign client ✗; admin
    expire ✓; months-overflow → friendly ✓; non-client target ✗; zero rows left).

---

## Program versioning

### Phase B — Edit Current Program (coach workflow)
- **Date:** 2026-07-11 · branch `feat/edit-current-program`
- **What:** Gave coaches an obvious **Edit Current Program** button on the active
  program card that clones the client's active published version into a draft and
  opens the existing `ProgramPublish` editor — it never mutates
  `client_programs.program`. Split the old, misleadingly-named `createNewDraft`
  (which silently cloned the latest program) into two clear paths:
  `editCurrentProgram(clientId, activeVersionId)` (clone active → draft, with a
  dup-guard that reopens an in-progress edit draft instead of spawning duplicates)
  and `createBlankDraft(clientId)` (blank scaffold — "**Build New Program**";
  confirms before a second concurrent draft). Save = draft only (`_saveDraft`);
  Publish still routes through the atomic `publish_program_version()` RPC
  (supersede prior active + update the single `client_programs` pointer + append a
  `client_program_revisions` snapshot). `duplicateAsDraft` retained for the
  History "Revise as Draft" action. A shared `_createDraftVersion` helper de-dups
  the insert logic.
- **Files:** `js/dashboard.js` only (product logic). **No** `programPublish.js`
  change (the editor already saved-draft/published correctly); **no** `app.html`
  change (reused `modal-program-edit`).
- **DB/RLS:** **none — no migration.** Reused the existing `client_program_versions`
  RLS (`cpv_write` = admin/assigned-coach; `cpv_select` exposes only the client's
  active-published version, hiding drafts) and `publish_program_version()` authz
  (`is_admin() OR coach_id=self OR assigned_coach=self`).
- **Verification:** `node --check` (`dashboard.js`, `programPublish.js`) +
  `npm run build` green; boot smoke (new fns wired, `createNewDraft` gone, no
  console errors). **Product-safety matrix — impersonated, rolled back, zero rows:**
  client insert draft ✗, client sees draft = 0 rows, client self-publish = 0 rows
  changed, client publish via RPC ✗, assigned coach insert draft ✓ (rows=1), other
  coach foreign draft ✗. Owner authenticated UI smoke pending (no creds in env).

### E1b-1 — Program versions foundation
- **Date:** 2026-06-24 · **PR #59** · merge `5f9ccc6` (`e769acd`)
- **What:** New `client_program_versions` table + RLS (client served due-only,
  `effective_from <= now()`, no client write) + `resolveClientProgram` serving
  overlay. Inert until live DB migrated.
- **Files:** `supabase/migrations/20260624000000_client_program_versions.sql`,
  rollback, `js/clientProgram.js`.
- **Verification:** DB-verified.

### E1b-2 — Coach edit-upcoming scheduling
- **Date:** 2026-06-24 · **PR #60** · `8ea4034`
- **What:** Coach UI to schedule an upcoming program version by effective date.
- **Files:** program builder/publish JS + `app.html`.
- **Verification:** Owner visual.

---

## Athletic Performance lane

### F1 — Athletic service shell
- **Date:** 2026-06-25 · **PR #61** · `97000e4`
- **What:** Service-switcher shell adding the "Athletic Performance" lane as a
  `body`-class axis (`service-rehab` / `service-athletic`) orthogonal to role.
- **Files:** `app.html`, `js/dashboard.js`, CSS.
- **Verification:** Owner visual.

### F2 — Athletic assessment foundation
- **Date:** 2026-06-25
- **PR #62** (`d1d86c6`) — assessment foundation schema: `athlete_profiles`,
  `assessment_batteries`, `athlete_assessments`, `athlete_test_results` + RLS +
  `tg_athletic_touch()`.
- **PR #63** (`7e77b6f`, F2B-Fix) — add assessment indexes; tighten battery RLS
  (default-battery write rule).
- **PR #64** (`cb671e6`) — assessment UI foundation (`js/athleticService.js`, `app.html`).
- **PR #65** (`de3a2d5`) — normalize assessment save payloads.
- **Files:** `supabase/migrations/20260625000000_*`, `20260625010000_*`, JS/HTML.
- **Verification:** schema DB-verified; UI Owner visual.

### F3 — Movement observations
- **Date:** 2026-06-25 → 2026-06-26
- **PR #66** (`904f157`, F3B) — `athletic_movement_observations` table (child of
  `athlete_assessments`): 28 cols, 10 movement domains, 16 finding tags
  (`<@` controlled vocabulary), canonical lowercase `side`, **no scoring/norms/ML**.
- **PR #67** (`dcb67dd`, F3B-Hardening) — close inherited client self-stamp RLS
  hole: gate every owning/assigned-coach write branch behind
  `public.is_coach_or_admin()` across 5 athletic tables (7 policies).
- **PR #68** (`7786dba`) — movement observations UI.
- **Files:** `supabase/migrations/20260625020000_*`, `20260625030000_*`,
  matching rollbacks, JS/HTML.
- **Verification:** schema + hardening **DB-verified** (client self-stamp insert
  denied `42501` on all 5 tables; coach/admin writes preserved; client reads 0);
  UI Owner visual.

### Athletic save hotfixes (#69–#71)
- **PR #69** — *align save payloads with schema* — 2026-06-26 · `db046a1`.
  Column/JSONB/enum alignment for `saveAthleteStory` / assessment save.
  Files: `app.html`, `js/athleticService.js`. Backend-reproduced.
- **PR #70** — *use valid assessment status* — 2026-06-27 · `71897f2`.
  `status` must be `draft|final` (CHECK); frontend was sending `completed` → now `final`.
  Files: `js/athleticService.js`. Backend-reproduced.
- **PR #71** — *align best-of payload and cache bust* — 2026-06-27 · `6c4f110`.
  `best_of` column is `integer`; frontend sent a boolean (`42804`). Fixed to
  `best_of: isBest ? 1 : 0` and read site `.eq('best_of', 1)`; **bumped cache
  token** `js/athleticService.js?v=20260625a → ?v=20260627a` so clients re-fetch.
  Files: `app.html`, `js/athleticService.js`. (Implements the backend save-failure
  diagnostic recommendation.) Backend-reproduced.
  > **Open item:** real authenticated owner browser save smoke still pending — see [ISSUE_LOG.md](ISSUE_LOG.md).

### R1A — Lock Athletic Performance preview
- **Date:** 2026-06-27 · **PR #72** · `5e9f2e5`
- **What:** Gate the Athletic lane to `admin` only. `switchService('athletic')` for
  a non-admin opens `modal-athletic-locked` and resets to Rehab; `showSection`
  blocks all `ATHLETIC_SECTIONS` for non-admins; coach switcher label becomes
  `Performance 🔒`.
- **Files:** `js/dashboard.js`, `app.html`, `css/neucore-premium.css`.
- **Verification:** Owner visual.

---

## Phase R0 — Documentation & repo-control baseline
- **Date:** 2026-06-27 (this phase)
- **What:** Create the `docs/` control-baseline doc set (this file + 7 others).
  Documentation only — no app/source/migration/RLS/auth changes.
- **Files:** `docs/*.md` (new).
- **Verification:** N/A (docs only).

---

## Phase P-FE-3 — Royal NeuCore Redesign
- **Date:** 2026-07-10
- **What:** Rebuilt the NeuCore login page to implement a premium split-screen design, and updated the landing page. The visual identity of both pages was redesigned to follow the new Royal NeuCore system (midnight navy bases, soft gold accents, ivory text, and subtle sapphire secondary glows). This includes a left hero column with an illustrative mock telemetry panel, a centered login card, a transition of CTA colors to gold, and preservation of the mock telemetry disclaimer and hidden-state safety.
- **Files:** `app.html`, `index.html`, `css/landing.css`, `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`.
- **Verification:** Computed display validated (visible = `block`, hidden = `none`), viewports (390px) checked, no console errors, and Vite build passes.

### Mobile Navbar Responsive Cleanup (P-FE-3 Follow-up)
- **Date:** 2026-07-11
- **What:** Fixed a mobile responsive overflow issue where the "Explore Platform" nav CTA was overflowing the viewport on narrow screens (e.g. 375px). Modified the landing page layout to hide the primary navbar CTA on mobile devices (width <= 480px) to prevent layout breakages while keeping the "Sign In" button fully visible and reachable.
- **Files:** `css/landing.css`, `docs/DEV_LOG.md`.
- **Verification:** Built successfully (`npm run build`), captured desktop and mobile screenshots (390px/375px), verified zero horizontal overflow, and confirmed Sign In button is fully reachable.

### Logged-in Dashboard Porcelain Emerald Visual Polish & Readability Fix
- **Date:** 2026-07-11 · branch `feat/porcelain-emerald-dashboard-polish`
- **What:** Redesigned the authenticated dashboard and platform shell components (sidebar, topbar, cards, tables, inputs, and quick action panels) to a premium Porcelain Bright Royal visual theme with Luxurious Emerald brand accents. Fixed the container opacity issue by ensuring all main grid/panel/content containers evaluate to computed opacity of `1`. Corrected the Objective Assessment numerical result inputs by styling them with high-contrast text (`#071326`) on a pure white background (`#FFFFFF`), clear placeholder text (`#6B7585`), robust focus states, and a fixed height of `42px` to eliminate vertical text clipping. Polished the assessment workspace layout using ivory-backed cards, deep navy headers, and refined padding.
- **Files:** `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`.
- **Verification:** Built successfully (`npm run build`), updated the Playwright assertions script to navigate, select, and expand the accordion zones of the Objective Assessment workspace, typed test values (`12`, `45`, `90`), asserted computed color and opacity values (computed opacity `1`, text color `rgb(7, 19, 38)`), and generated screenshots (`objective_assessment_emerald.png` and other page layouts). All checks passed with zero console errors.

### FitExpert-Inspired Porcelain Emerald Dashboard Polish
- **Date:** 2026-07-11 · branch `feat/fitexpert-dashboard-reference-polish`
- **What:** Refined the authenticated app shell, sidebar, header, and dashboard components using the FitExpert dashboard structure as a style reference. Applied a flat, clean SaaS theme with bright porcelain canvas (`#F8F9F9`), crisp white panels (`#FFFFFF`), very high-contrast comfortable typography (`#181C32` primary text, `#4B5565` secondary text, `#7E8299` muted text), and flatter card borders (`rgba(24, 28, 50, 0.06)`) and flat shadows while retaining AST9's medical emerald accents selectively.
- **Files:** `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`.
- **Verification:** Built successfully (`npm run build`), ran Playwright visual verification asserting container opacities evaluate to `1` and filled Objective Assessment inputs are fully visible and not clipped.

### FitExpert-Inspired Dashboard Layout & Sidebar Polish
- **Date:** 2026-07-11 · **PR #120** · merge `be4a72a`
- **What:** Reorganized the authenticated dashboard layout and sidebar to match the FitExpert dashboard structure while preserving the porcelain-emerald theme. Restored a clear "Dashboard" page header. Refined the first fold to feature a wide welcome card with integrated workflow steps on the left and a compact Client Overview roster card on the right. Moved the KPI row below the first fold and simplified its card styles to be flat. Expanded the desktop sidebar to a wider (`220px`), non-collapsing sidebar displaying text labels next to icons. Polished general cards and Objective Assessment cards to use thin borders (`rgba(24, 28, 50, 0.06)`), minimal shadows, and cleaner section spacing.
- **Files:** `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`, `app.html`.
- **Verification:** Built successfully (`npm run build`), ran Playwright visual checks asserting welcome cards, wide sidebar width (220px), client roster placement, and input fields remain fully functional and visible.

### Objective Assessment Visual Polish
- **Date:** 2026-07-12 · branch `feat/objective-assessment-visual-polish`
- **What:** Polished the Objective Assessment tab to improve input box readability, range slider controls, and body map presentation in bright/porcelain mode. Specifically:
  1. Restored the joint editor pain slider gradient background (green -> yellow -> orange -> red -> dark red) and premium white/emerald-bordered thumb by resolving broad input override rules.
  2. Hidden the side zone rail chips (`#zone-rail`, `.zone-rail`, `.zone-chip`) next to the 3D skeleton to present a clean, unboxed anatomy model.
  3. Optimized input boxes (`.form-input`, `input[type="number"]`, `select`) in the Objective tab to use a centered layout, height of `44px`, font-size of `14px`, font-weight `600`, and compact `8px 10px` padding to prevent typed values from clipping.
  4. Enforced a minimum width of `480px` on hip and shoulder tables with card-level horizontal scrolling (`overflow-x: auto`) to prevent grid column compression on narrow screens.
- **Files:** `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`.
- **Verification:** Built successfully (`npm run build`), ran visual assertion tests verifying inputs/sliders, hidden rails, wide layout constraints, and zero console errors.

### Generate Page Movement Analysis Step & Simulator Styling
- **Date:** 2026-07-12 · branch `feat/generate-movement-analysis-step`
- **What:** Refactored the assessment analysis flow on the Generate tab to separate the movement quality scores and 3D simulation analysis from automatic/manual program generation.
  1. Added a dedicated `#movement-analysis-btn` button (visual style managed in `css/neucore-premium.css`) before program creation actions to trigger analysis independently.
  2. Refactored the analysis launch code into a reusable `runMovementAnalysis()` function, and wired it to dedicated analysis, auto-generate, and manual-build buttons.
  3. Added assessment signature tracking (`window._lastMovementAnalysisSignature`) using active client ID + assessment values. If data has changed, clicking Generate or Build Manually automatically recalculates and refreshes the analysis first.
  4. Redesigned the Movement Simulation panel (`.gait-page`, sub-panels, headers, and buttons) to follow the porcelain + emerald theme direction (white cards, clean grey borders, dark canvas viewport for contrast, and emerald/amber/red color-coded telemetry and buttons).
  5. Refactored `ActivationChart` in `src/neucore/simulation/ActivationChart.js` directly with clean bright-mode support, utilizing soft porcelain-emerald gridlines (`rgba(24, 28, 50, 0.06)`), high contrast dark text `#181C32`, and clinical legend colors.
- **Files:** `app.html`, `src/main.js`, `src/neucore/gait/GaitAnalysisPage.js`, `src/neucore/simulation/ActivationChart.js`, `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`.
- **Verification:** Built successfully (`npm run build`), and verified layout/simulation render and user workflows in Playwright.
