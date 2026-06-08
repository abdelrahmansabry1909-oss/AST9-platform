# DEPLOYMENT_READINESS_REPORT.md — Client Mobile Redesign

**Type:** Final deployment-readiness review. **Analysis only** — no code changed, nothing committed, nothing deployed. This document is the only file created.
**Date:** 2026-06-06
**Branch:** `claude/interesting-buck-452459` · **HEAD audited:** `f453382` (local = origin, verified in sync)
**Target:** merge to `main` (push to `main` triggers the GitHub Pages deploy at https://abdelrahmansabry1909-oss.github.io/AST9_HUB/)
**Method:** git/branch verification + static source trace + built `dist/` artifact inspection + live Supabase RLS probe. No real browser/device run was available in this environment (see M-3).

---

## 1. Branch & commit verification

`git fetch` + presence check: **all 8 redesign commits are present**, and local HEAD equals `origin/claude/interesting-buck-452459` (`f453382`).

| Commit | Subject | Present |
|---|---|---|
| `3df7064` | S0 — mobile client app shell + bottom tab bar | ✅ |
| `2dece2f` | S1 — Today (status-first recovery hero) | ✅ |
| `2872910` | S2 — Train (Daily Routine + Program merged) | ✅ |
| `aa9cb8e` | S3 — Progress (recovery momentum + desktop route) | ✅ |
| `7d79ef6` | S4 — Coach support screen + grouped More | ✅ |
| `32a7bdd` | S5 — theme/states/copy/a11y/simplify | ✅ |
| `6d22cfd` | S6 — regression audit + consistency fix + docs | ✅ |
| `f453382` | desktop nav consolidation (Phase 1) | ✅ |

---

## 2. Build & deploy pipeline readiness

| Check | Result |
|---|---|
| Workflow trigger | `.github/workflows/deploy.yml` deploys on push to `main` (or manual dispatch). The redesign branch does **not** auto-deploy. |
| CI build | `npm ci` → `npm run build` → upload `dist` → `deploy-pages`. Clean-room build from source. |
| Last local build at HEAD | Green (exit 0, ~3.5s) at `f453382` (prior turn; no source changed since). |
| `dist/` tracking | **Gitignored** (`.gitignore: dist/`) → CI always rebuilds; no stale committed bundle risk. |
| New client JS in artifact | `dist/js/` contains `clientUtil`, `clientDashboard`, `clientTrain`, `clientProgress`, `clientCoach`, `clientShell` (the `copy-legacy-js` plugin `cpSync`s all of `js/`). |
| CSS resolution | `mobile-shell.css` + `client-theme.css` are bundled+hashed into `/AST9_HUB/assets/app-*.css`; `dist/app.html` has **0** raw `href="css/…"` references → no Pages 404 risk. |
| Base path | `base: '/AST9_HUB/'` applied to hashed assets; 22 classic `js/*.js` script tags load relative to `/AST9_HUB/app.html`. |

**Pipeline verdict:** deploy-ready; the artifact is complete and self-consistent.

---

## 3. Audit by dimension

### 3.1 Mobile client experience — PASS
Bottom tab bar (Today · Train · Progress · Coach · More), `env(safe-area-inset-*)` on bar/sheet/hologram, 44px+ targets, single bottom bar (legacy `.mobile-bottom-nav` + dead hamburger hidden for `body.nc-client`), shimmer skeletons, offline notes, scroll-locked + focus-trapped overlays.

### 3.2 Desktop client experience — PASS (consolidated)
Sidebar primary nav now **Today · Train · Progress · Coach** (Phase 1). Secondary items (Nutrition, My Graph, Services, Case Studies, Community, Settings) remain as sidebar entries (the desktop equivalent of mobile's More). `body.nc-client` applies the dark theme on desktop too; the tab bar is hidden >768px. Residual: see L-1 (notification bell).

### 3.3 Coach / admin experience — PASS (unchanged)
Client modules render only under client-gated paths (`body.nc-client` set only for `role==='client'`; client sidebar items are `role-client-only`, hidden by `initShell`). Daily Routine + Notifications were already coach-visible (bare all-roles items) and remain so; My Program was never coach-visible. Shared-file edits default to prior behavior (`renderReport` labels default to clinical terms; Daily Routine dark theme is `body.nc-client`-scoped, leaving `.dr-coach-*` untouched). Live RLS confirms isolation: `profiles` SELECT = own-row OR admin/coach; `notifications` SELECT = own OR admin.

### 3.4 Navigation integrity — PASS
Tab → section → root → loader → module is 1:1 in the built bundle for all four client screens. Every `showSection(...)` target resolves to an existing `#section-…`. No broken, dead, or orphaned routes. More deep-links (`data-open=history|report`) resolve into Progress disclosures.

### 3.5 F1–F7 accessibility — PASS
| Feature | Client path | OK |
|---|---|---|
| F1 subscription grace + write-gate | Today pill/CTA/attention; Train `readOnly` | ✅ |
| F2 workout/session tracking | Train → "Your full plan" → `renderClientProgram` → `WorkoutSession.mountWorkouts` | ✅ |
| F4 progression engine | Progress → Advanced insights | ✅ |
| F5 exercise video/instructions | Train → full plan → program/workout rows | ✅ |
| F6 client alt-exercise request | Train → full plan → workout row → ⇄ `AltExercise.openModal` | ✅ |
| F7 assessment / 3D hologram | Progress → report + Body load map | ✅ |
*(F3 notifications: Coach tab for clients; raw inbox retained for coach/admin.)*

### 3.6 Accessibility — PASS with minor gaps
Focus trap + restore on the hologram dialog and More sheet; Escape closes; `role=tablist/tab` on the bar, `role=dialog` on the hologram; `aria-live` on the streak; dial `aria-label`; `prefers-reduced-motion` honored app-wide. Gaps: L-2 (modal siblings not `aria-hidden`), L-3 (Daily Routine custom checkbox lacks Enter/Space).

### 3.7 Performance — PASS with pre-existing debt
Hologram is lazy-mounted and disposes its WebGL context on close (`LoadVisualizer.destroy` → `BodyCanvas.destroy` → `cancelAnimationFrame` + `renderer.forceContextLoss`); Today never paints WebGL; skeletons avoid layout jank; reduced-motion supported. Pre-existing: the app JS bundle is ~1.04 MB (~290 KB gzip) as one chunk (Vite chunk-size warning) — see M-2. The redesign's own additions are small (~6 light modules + 2 CSS files).

### 3.8 Error handling — PASS
Progress shows a real error + **Try again** when its parallel load rejects. Other screens degrade gracefully (data readers return empty rather than throwing). See L-4 (Today conflates score-read error with "no data yet").

### 3.9 Empty / first-run states — PASS
Today (no score → "Not yet" teaching copy), Train (default routine, program empty state, streak 0), Progress (momentum "Building", history/report empty copy), Coach (generic coach identity, warm "no guidance", gentle 0/0 consistency). No blank screens.

### 3.10 Subscription-expired / read-only — PASS
Today CTA → "Renew to continue" → Coach; attention card → expired/grace messaging; Train mounts the tracker `readOnly` (view, no logging/reset); Coach contact remains available; subscription pill reflects state. (Underlying enforcement caveat: H-1, pre-existing.)

---

## 4. Issues by severity

### Critical (blocks merge)
- **None.**

### High
- **H-A (pre-existing, NOT introduced by the redesign):** the subscription **write-gate is client-side only** — writable tables lack an RLS rule enforcing subscription state, so a determined expired client could still write via the API. Tracked in `PRODUCTION_READINESS_AUDIT.md` (item H-1). The redesign does not change this posture (it only adds presentation-layer read-only affordances). Does **not** block merging the redesign, but remains the top app-level hardening item.

### Medium
- **M-1 (pre-existing):** three vestigial `three@0.158.0/examples/js/{OrbitControls,GLTFLoader,DRACOLoader}.js` `<script defer>` tags 404 (those files were removed from three.js years ago). They are not used by the redesign (the hologram uses the bundled `src/` engine) and do not break anything, but they produce console 404 noise on every load. Cleanup candidate, unrelated to this redesign.
- **M-2 (pre-existing):** single ~1.04 MB JS bundle (Vite >500 KB chunk warning). Acceptable for current scale; a code-split/manualChunks pass is the eventual fix. Not introduced by the redesign.
- **M-3 (process):** this review is static + artifact-based; **no real mobile-device / browser smoke test** was possible in this environment. Recommend one manual pass on a real phone (iOS Safari + Android Chrome) covering the five tabs, hologram open/close, and the lapsed-subscription path before declaring the live deploy validated.

### Low
- **L-1:** the sidebar-footer **notification bell** (`#notif-bell`, no role gate) still routes desktop clients to the raw `notifications` section. Footer affordance, not a scoped nav item; shared with coach/admin. Recommend hiding it for clients on desktop (they have the Coach tab). (= DESIGN_QA N-1.)
- **L-2:** modal overlays (hologram, More sheet) trap focus but do not set `aria-hidden`/`inert` on sibling content.
- **L-3:** the Daily Routine custom checkbox (`role="checkbox"`) lacks Enter/Space activation (lives in the shared `dailyRoutine.js`).
- **L-4:** Today degrades a recovery-score read **error** to the same "Not yet" state as genuine no-data (acceptable, slightly conflated).
- **L-5:** F2/F6 (workout logging, request-alternative) sit two reveals deep in Train (reachable; discoverability could improve).

### Nice-to-have
- **N-1:** `/simplify` proposals — shared `disclosure` helper (S-1), `screenHeader` helper (S-2), CSS utility classes to replace repeated inline card/CTA styles (S-3). All presentation-layer; see `DESIGN_QA_CHECKLIST.md` §5.
- **N-2:** desktop client-only section header to visually group Today/Train/Progress/Coach (constrained by the shared `nav-dashboard` position).
- **N-3:** pause the 3D animation loop under `prefers-reduced-motion`.

---

## 5. What the redesign itself introduced vs. pre-existing

- **Introduced by S0–S6 + Phase 1:** no Critical/High/Medium defects. Only Low items (L-1…L-5) and Nice-to-haves. No dead code, no obsolete modules, no broken routes, no coach/admin impact, no backend/RLS/schema/edge/cron change.
- **Pre-existing (out of redesign scope, surfaced for completeness):** H-A (write-gate), M-1 (three.js 404s), M-2 (bundle size). These exist on `main` today and are not regressions.

---

## 6. Pre-merge / post-merge recommendations

**Before merge (optional, none blocking):**
- Run one real-device smoke test (M-3): five tabs, More sheet + deep-links, hologram open/close cycle, lapsed-subscription read-only, offline note.

**At merge:**
- Merge `claude/interesting-buck-452459` → `main` via PR. Pushing to `main` triggers the Pages deploy automatically; no manual deploy step. Confirm the Actions run is green and spot-check the live URL.

**After merge (follow-ups, not blockers):**
- L-1 bell gating (tiny); then optionally L-2/L-3 a11y; then the `/simplify` Nice-to-haves.
- Track H-A and M-1/M-2 in the existing audit backlog (independent of this redesign).

---

## 7. Final verdict

### READY WITH WARNINGS

The Client Mobile Redesign at `f453382` is **safe to merge to `main` and deploy.** It introduces **no Critical, High, or Medium defects**; all client routes resolve, F1–F7 remain accessible, coach/admin and RLS are provably unaffected, and the build/deploy artifact is complete and self-consistent. The "warnings" are not redesign blockers:

1. **No real-device smoke test was possible here (M-3)** — strongly recommended once before trusting the live deploy.
2. **Pre-existing H-A (client-side-only write-gate)** remains the top app-level hardening item, tracked separately; it is not a regression and not in this redesign's scope.
3. A short tail of **Low** UX/a11y items (L-1…L-5) and **Nice-to-haves**, none blocking.

If a real-device smoke test passes, this is effectively **READY FOR MAIN MERGE**. Feature 8 should not begin until after the merge decision.
