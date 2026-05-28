# AST9 Health Hub — Development Guide

A working guide for engineers contributing to the platform: onboarding,
critical files, debugging entry points, common workflows, and the
honest list of technical debt.

For the project overview and quick-start see [`README.md`](./README.md).
For system architecture and internals see [`Documentation.md`](./Documentation.md).

---

## Table of Contents

- [1 · First Hour Onboarding](#1--first-hour-onboarding)
- [2 · Where to Start Reading the Code](#2--where-to-start-reading-the-code)
- [3 · Critical Files](#3--critical-files)
- [4 · Typical Debugging Entry Points](#4--typical-debugging-entry-points)
- [5 · Common Workflows](#5--common-workflows)
- [6 · Local Dev Tips](#6--local-dev-tips)
- [7 · Coding Conventions](#7--coding-conventions)
- [8 · Performance Notes](#8--performance-notes)
- [9 · Technical Debt Register](#9--technical-debt-register)
- [10 · Suggested Refactor Targets](#10--suggested-refactor-targets)

---

## 1 · First Hour Onboarding

```bash
git clone https://github.com/abdelrahmansabry1909-oss/AST9-platform.git
cd AST9-platform
npm install
npm run dev          # → http://localhost:5173
```

Then, in order:

1. Read [`README.md`](./README.md) → high-level orientation (10 min).
2. Read [§2](#2--where-to-start-reading-the-code) below → know which 5
   files matter (15 min).
3. Read [`Documentation.md`](./Documentation.md) §2 *The Two-Layer
   Browser Stack* → understand the duplicate-name trap (10 min).
4. Open `app.html?login=1` → click through every sidebar item with the
   browser DevTools network + console panels open (20 min).
5. Pick a small task from [§9](#9--technical-debt-register) → ship it.

> **The fastest way to get lost** is to open a random `js/*.js` file and
> start refactoring without reading
> [`Documentation.md`](./Documentation.md) §2. The duplicate
> `GaitEngine` / `ScoringEngine` names will burn you.

---

## 2 · Where to Start Reading the Code

A reading order that minimises confusion:

| Step | File                                                          | Why                                                                            |
|------|---------------------------------------------------------------|--------------------------------------------------------------------------------|
| 1    | `package.json`                                                | 4 dependencies, no test runner, Vite. Sets your expectations.                  |
| 2    | `app.html` (skim, ~2 000 lines)                               | The SPA shell. Every section lives here.                                       |
| 3    | `js/supabaseClient.js`                                        | The single `window.sb`.                                                        |
| 4    | `js/auth.js`                                                  | Role + subscription gating.                                                    |
| 5    | `js/dashboard.js` (focus: `showSection`, `generateProgram`)   | The routing + program-generation orchestrator.                                 |
| 6    | `src/main.js`                                                 | The ES module entry. Wires the 3D skeleton + the Generate-page capture listener. |
| 7    | `src/neucore/gait/GaitAnalysisPage.js`                        | The most complex single module.                                                |
| 8    | `supabase/migrations/*.sql`                                   | The data model + RLS, in chronological order.                                  |

After step 8 you have the complete mental model.

---

## 3 · Critical Files

Touching any of these has wide blast radius — change with care.

| File                                              | Why it's critical                                                                                                  |
|---------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| `app.html`                                        | The DOM contract: every section ID, every `nav-item`, every tab. Most JS modules look up elements here.            |
| `js/supabaseClient.js`                            | The single Supabase client. Touching auth options breaks every page.                                               |
| `js/auth.js`                                      | Role + subscription gating. A bug here lets clients in past expiry, or locks out coaches.                          |
| `js/dashboard.js`                                 | Section routing (`showSection`), role visibility, the Generate flow orchestrator. ~1 000 lines.                    |
| `src/main.js`                                     | Boot order for the 3D stack; sets `THREE.Cache.enabled`; wires the Generate-page capture listener.                 |
| `src/neucore/skeleton/GLBSkeleton.js`             | Loads the 3.3 MB GLB, applies shaders, mirrors axial bones, builds the joint hotspots. Wrong assumptions here break the dashboard skeleton AND the gait page. |
| `src/neucore/gait/GaitAnalysisPage.js`            | Combines skeleton, simulator, chart, score panel, phase overlay, retry UI.                                         |
| `src/neucore/core/ObjectiveSync.js`               | Declarative form ↔ 3D bindings. Add a new ROM field here, not by sprinkling listeners.                              |
| `js/rpm/approval.js`                              | The coach decision loop (approve / modify / reject). Drives the Approvals badge poller too.                         |
| `js/communityUI.js`                               | Renders 6 community sub-tabs and the admin case-study approval panel.                                              |
| `supabase/migrations/20260523_case_study_approval.sql` | Reference for adding a status column + RLS + EXECUTE grants on helper functions.                              |
| `supabase/functions/rpm-ai-suggest/index.ts`      | The pattern for an AI-backed edge function with deterministic fallback.                                            |

---

## 4 · Typical Debugging Entry Points

| Symptom                                            | First place to look                                                                                  |
|----------------------------------------------------|------------------------------------------------------------------------------------------------------|
| Sidebar item missing for a user                    | `js/dashboard.js` ≈ L40–55 (role visibility) → check the element's `role-*` class in `app.html`.     |
| Section opens but is blank                         | `js/dashboard.js` `showSection()` → confirm the loader entry; check `console.warn` lines.            |
| Gait *"3D anatomy failed to load"*                 | `src/neucore/gait/GaitAnalysisPage.js` `_initSimulation` catch block (now shows the real error).      |
| Generate button does nothing                       | `src/main.js` `_initGenerateButton` (capture listener) + `Dashboard.generateProgram` (`onclick`).    |
| Score panel says "Score unavailable"               | `src/neucore/gait/GaitAnalysisPage.js` `_buildScoreSummary` catch. Empty assessment is expected.     |
| Login times out                                    | `js/auth.js` `login()` — Supabase project likely paused. Wake it from the dashboard.                 |
| `permission denied for function ...`               | RLS policy references a `public.is_*()` function without EXECUTE for the calling role. Grant it.     |
| Coach can't see a case study they submitted        | `case_shares_read` RLS — confirm `auth.uid() = coach_id` branch matches.                             |
| Approvals badge stuck at 0                         | `app.html` `_refreshApprovalsBadge` — confirm `RPMApproval.pendingCount()` returns and admin branch fires. |
| Realtime message never arrives                     | `js/community.js` `subscribeToMessages` — channel name includes both uids; confirm filter matches.   |
| Case study carousel always shows marketing cards   | No `case_shares.status = 'approved'` rows exist for the calling role's RLS view. Approve one.        |
| Visitor survey returns 401                         | Function deployed without `--no-verify-jwt` — redeploy it that way.                                  |

### Useful DevTools incantations

```js
// Who am I?
Auth.getProfile(); Auth.getRole();

// Force-render an admin panel without RLS noise
CommunityUI.renderCaseApprovals();

// Inspect the live gait page state
document.getElementById('neucore-gait-container').querySelector('canvas');

// Replay the Generate capture listener without the AI call
document.getElementById('generate-btn').dispatchEvent(
  new MouseEvent('click', { bubbles: false })
);

// Confirm the asset cache is on
THREE.Cache.enabled;
```

---

## 5 · Common Workflows

### 5.1 · Add a new sidebar section

1. **`app.html`** — add `<div class="nav-item role-..." id="nav-foo"
   onclick="Dashboard.showSection('foo')">` to the sidebar.
2. **`app.html`** — add `<div class="section" id="section-foo">…</div>`
   inside `<main>`.
3. **`js/dashboard.js`** — add a loader in `showSection()`:
   ```js
   'foo': () => (typeof Foo !== 'undefined' && Foo.init?.()),
   ```
4. Create the module (`js/foo.js` for legacy IIFE, or
   `src/neucore/foo/Foo.js` for an ES module wired through `src/main.js`).
5. Add the `<script>` tag in `app.html` (legacy modules only — the ES
   modules are wired through `src/main.js`).

### 5.2 · Add a database table + RLS

1. Create `supabase/migrations/<YYYYMMDD>_<short_name>.sql`. Use
   `CREATE TABLE IF NOT EXISTS` and `IF NOT EXISTS` everywhere.
2. Enable RLS: `ALTER TABLE foo ENABLE ROW LEVEL SECURITY;`.
3. Add policies — prefer **named per-operation** policies over
   `FOR ALL`:
   ```sql
   CREATE POLICY foo_read   ON foo FOR SELECT USING (...);
   CREATE POLICY foo_insert ON foo FOR INSERT WITH CHECK (...);
   CREATE POLICY foo_update ON foo FOR UPDATE USING (...) WITH CHECK (...);
   CREATE POLICY foo_delete ON foo FOR DELETE USING (...);
   ```
4. If any policy references a `public.is_*()` helper, add
   `GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;`
   for the function — otherwise anon queries error with
   `permission denied for function is_admin`.
5. Apply: `supabase db push` (CLI) or paste into the dashboard SQL
   editor. The Supabase MCP `apply_migration` tool also works for
   interactive use.

### 5.3 · Add an edge function

1. Create `supabase/functions/<name>/index.ts`. Follow the header
   convention used by the two existing functions — list every required
   secret in the comment block.
2. Use `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` for
   server-side writes (the platform auto-populates both).
3. CORS: copy the `CORS` constant from `visitor-survey/index.ts`. In
   production, replace `"*"` with your real origin.
4. Deploy:
   ```bash
   supabase functions deploy <name>                # JWT required
   supabase functions deploy <name> --no-verify-jwt # public endpoint
   ```
5. Set secrets in the Supabase dashboard: *Edge Functions → Secrets*.

### 5.4 · Add a new assessment field

1. Add the input to `app.html` under the appropriate tab in
   `section-new-session` with an `id="ns-<short-name>"`.
2. If the field maps to a joint on the body map, add a binding in
   `src/neucore/core/ObjectiveSync.js` — this gives you the form ↔ 3D
   sync for free.
3. If the field feeds the scorer, add it to `js/scoring.js`
   `readForm()` and update the relevant `_*Score()` method.
4. If the field affects gait, add a rule in
   `src/neucore/gait/GaitRules.js` and (if it changes kinematics) in
   `src/neucore/simulation/MovementSimulator.js`
   `_computeClientKinematics()`.
5. If the field should persist, add a column to
   `rehab_objective_assessments` (migration).

---

## 6 · Local Dev Tips

### Vite + dual-page setup

- The dev server serves both `index.html` (landing, root path) and
  `app.html` (SPA, `/app.html`).
- The boot script in `app.html` redirects unauthenticated requests to
  the landing page. **Use `?login=1` to land on the login screen
  directly** without bouncing.

### Working without a real Supabase login

The SPA gates everything on `Auth.init()`. To inspect a section without
a session:

```js
document.getElementById('screen-login').classList.add('hidden');
document.getElementById('screen-app').style.display = 'block';
document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
document.getElementById('section-case-studies').classList.add('active');
await PlatformExtras.initCaseStudiesCarousel();
```

Most queries will return empty (RLS) but you can validate DOM,
listeners, and the 3D stack.

### Skipping rebuilds

Vite has HMR. Edits to `src/**` reload modules; edits to `js/**` or
`app.html` reload the page. There is no build step in dev.

---

## 7 · Coding Conventions

### Legacy IIFE pattern (`js/*.js`)

```js
const FeatureName = (() => {
  // private state
  async function publicThing() { /* ... */ }
  return { publicThing };
})();
window.FeatureName = FeatureName;
```

- Always assign to `window.FeatureName` so it's discoverable via
  DevTools.
- Use the shared `window.sb` Supabase client; do **not** instantiate a
  second one.
- Use `Dashboard.toast(message, kind)` for user feedback.

### ES module pattern (`src/neucore/**/*.js`)

```js
import * as THREE from 'three';
import { bus } from '../core/JointBus.js';

export class Foo { /* ... */ }
```

- Relative imports only — no aliases configured.
- The single `import * as THREE from 'three'` in `src/main.js` is what
  populates `window.THREE` for the legacy layer. Don't re-import
  `three` outside of modules.

### SQL migrations

- Filename: `supabase/migrations/<YYYYMMDD>_<short_snake_case>.sql`.
- Always idempotent: `IF NOT EXISTS`, `DROP POLICY IF EXISTS ...`.
- Comment heavily. Migration files are a primary design document in this repo.

### CSS

- Three layers: `landing.css` (public site), `styles.css` (app),
  `styles_holographic.css` (NeuCore-specific overrides),
  `neucore-design-system.css` (design tokens).
- Use the token variables (`var(--nc-teal)`, `var(--sp-4)`, …) — they
  define the visual system.

---

## 8 · Performance Notes

| Area                         | What's expensive                                                                                  | Mitigation in place                                                              |
|------------------------------|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------|
| GLB load                     | 3.3 MB fetch + parse on first visit                                                               | `THREE.Cache.enabled = true` in `src/main.js` so the second load is a memory hit. |
| GaitAnalysisPage rebuild     | Each Generate click creates a new `BodyCanvas` + `GLBSkeleton`.                                   | `_buildToken` + `_disposed` invalidate stale in-flight builds; `destroy()` cascades to renderer + skeleton. |
| WebGL contexts               | Each `BodyCanvas` allocates a context. Browsers cap at ~16.                                       | `bodyCanvas.destroy()` calls `renderer.dispose()` and the cascade. *Verify on long sessions.* |
| Sidebar Approvals badge poll | `setInterval(60_000)` calls `RPMApproval.pendingCount` + `Community.getPendingCaseShareCount`.    | Gated on `!document.hidden` to skip when tab inactive.                           |
| Realtime channels            | One channel per open thread + one for the client feed.                                            | Both are explicitly unsubscribed on navigation (`unsubscribeMessages`, `unsubscribePosts`). |
| ScoringEngine / RuleEngine   | Pure CPU; runs in < 5 ms on a representative assessment.                                          | Not a concern.                                                                   |

---

## 9 · Technical Debt Register

Honest list, ordered roughly by impact.

| #  | Item                                                                                                  | Impact   | Suggested fix                                                                                   |
|----|-------------------------------------------------------------------------------------------------------|----------|-------------------------------------------------------------------------------------------------|
| 1  | **`Dashboard.generateProgram()` calls `api.anthropic.com` directly without an API key header.**       | High     | Move behind a `claude-narrative` edge function that injects `ANTHROPIC_API_KEY`. Mirror `rpm-ai-suggest`. |
| 2  | **`visitor-survey` CORS is `Access-Control-Allow-Origin: *`.**                                        | High     | Replace `*` with the production origin(s). The TODO is already in the source.                   |
| 3  | **Supabase anon key is committed in `js/supabaseClient.js`.**                                         | Medium   | The anon key is meant to be public, but the project URL is hard-coded too — move both to a small `config.js` that's swapped per environment. |
| 4  | **No automated tests.**                                                                               | Medium   | Start with Vitest for `src/neucore/scoring/ScoringEngine.js` and `src/neucore/gait/GaitRules.js` — pure functions, highest value. |
| 5  | **Two `GaitEngine`s + two `ScoringEngine`s — namespace collision.**                                   | Medium   | Rename the NeuCore modules (e.g. `NeuCoreScoring`, `NeuCoreGait`) to remove the shadow.         |
| 6  | **`AST9_Phase3_Migrations.sql` is a single 500-line standalone file, not in `supabase/migrations/`.** | Medium   | Split into the `supabase/migrations/` convention with a date prefix. Note the helper functions were created in `public`, not the `Auth` schema the file's text claims. |
| 7  | **No retry / resubscribe on dropped realtime channels.**                                              | Low      | Wrap `Community.subscribeTo*` in a reconnect loop.                                              |
| 8  | **`public/` (containing the GLB) is git-untracked.**                                                  | Low      | Either commit it (LFS for the 3.3 MB asset) or add a `bootstrap` script that downloads it.      |
| 9  | **The `gait` sidebar section is a placeholder.**                                                      | Low      | `js/dashboard.js` L91 — `'gait': () => { /* placeholder — wired in future phase */ }`.          |
| 10 | **The Dashboard `_origGenerate` reference is captured but never used.**                                | Low      | Dead code in `app.html` L1788. Remove.                                                          |

---

## 10 · Suggested Refactor Targets

In priority order, with the smallest first:

1. **Extract the Supabase config to `js/config.js`** (debt #3) — tiny
   change, big environment-portability win.
2. **Proxy the Generate-page AI call** (debt #1) — replaces a known-broken
   fetch with a working one. Reuse the `rpm-ai-suggest` shape.
3. **Lock down visitor-survey CORS** (debt #2) — one-line change before any
   public marketing push.
4. **Introduce Vitest with scoring + gait rule tests** (debt #4) — these
   are pure, fully covered by the clinical spec, and high-leverage.
5. **Reorganise migrations** (debt #6) — move `AST9_Phase3_Migrations.sql`
   into `supabase/migrations/` so `supabase db push` becomes the single
   source of truth.
6. **Rename the NeuCore engines to remove the shadow** (debt #5) — touch
   `GaitAnalysisPage.js`, `MovementSimulator.js`, the import statements.
   Don't touch `js/dashboard.js` (it intentionally uses the legacy
   global).

When you take any of these, update this register so the next
contributor sees the same accurate picture.
