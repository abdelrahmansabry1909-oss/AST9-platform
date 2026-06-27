# AST9 Tech Stack & Language Index

> Languages and technologies in use, plus how files are grouped. Verified against
> `package.json`, the `js/` tree, and `supabase/` (Phase R0).

---

## Languages & core technologies

| Layer | Technology |
|---|---|
| Markup | **HTML** (`index.html` landing, `app.html` authenticated shell) |
| Styling | **CSS** (`css/` — NeuCore design system, premium surfaces) |
| App logic | **JavaScript** — vanilla ES, IIFE modules exposing `window.*` globals (no framework) |
| Build | **Vite 5** (multi-page: `index.html` + `app.html`; entry `src/main.js`) |
| Backend / DB | **Supabase** → **Postgres 17.6** (prod ref `byquokhcbagofshsclfy`, eu-central-1) |
| Authorization | **Row-Level Security (RLS)** policies + `SECURITY DEFINER` helper fns (`is_admin()`, `is_coach_or_admin()`) |
| Serverless | **Supabase Edge Functions** (Deno/TypeScript) under `supabase/functions/`, shared `_shared/auth.ts` CORS |
| Charts | **Chart.js 4.4** (`js/charts.js`) |
| 3D | **Three.js 0.158** (`js/bodyMap3D.v2.js`, NeuCore skeleton placeholder) |
| Hosting | **GitHub Pages** (static deploy on push to `main`) |
| Client libs | `@supabase/supabase-js ^2.39` |
| Verification scratch | **Python** scripts — local migration/structure checks only, never shipped (see [REPO_MAP.md](REPO_MAP.md)) |

## Frontend files (`js/` — selected; not exhaustive)

- **Shell / routing:** `dashboard.js` (role routing + service switcher + section
  gating), `auth.js`, `supabaseClient.js`, `landing.js`, `visitor.js`, `tour.js`.
- **Coach/admin:** `clients.js`, `coachProfile.js`, `adminBusiness.js`,
  `packages.js`, `billing.js`, `appointments.js`, `community.js`/`communityUI.js`,
  `exerciseLibrary.js`/`exerciseUI.js`/`exercisePicker.js`,
  `programGenerator.js`/`programPublish.js`/`progressionEngine.js`.
- **Client:** `clientDashboard.js`, `clientShell.js`, `clientProgram.js`,
  `clientTrain.js`, `clientProgress.js`, `clientCoach.js`, `dailyRoutine.js`,
  `workoutSession.js`.
- **Athletic lane:** `athleticService.js` (assessment + movement save module;
  admin-only at runtime via dashboard gating).
- **Assessment / engines:** `gaitEngine.js`, `scoring.js`, `assessmentSnapshot.js`,
  `progressReport.js`, `charts.js`, `rpm/` (graph builder/viewer/approval).
- **Other:** `notificationsService.js`, `subscriptionService.js`/`subscriptions.js`,
  `transcriptAssistant.js`, `altExerciseRequest.js`, `pdfExport.js`,
  `exerciseInstructions.js`, `platformExtras.js`, `lib/`.

## Backend / migration files

- `supabase/migrations/` — forward migrations (timestamped, applied to prod via MCP).
- `supabase/rollbacks/` — paired rollback scripts, kept **outside** `migrations/` so
  they are never auto-applied as forward migrations.
- `supabase/functions/` — edge functions (Deno/TS) + `_shared/auth.ts`.

## Docs

- `docs/` — this control-baseline set (Phase R0).
- Repo-root `*.md` — canonical deep-dive feature/architecture docs (see
  [PROJECT_INDEX.md](PROJECT_INDEX.md) §7).

## Scratch / tools policy

Local verification scripts (e.g., Python structure/migration checks) and agent/skill
tooling artifacts are **local-only and never committed**. `.gitignore` excludes
`node_modules/`, `dist/`, `.env*`, `.claude/`, `.agents/`, `skills-lock.json`,
`.pr-body.md`, `deno.lock`, `supabase/.temp/`. Untracked local tooling dirs
(`.codex/`, `.github/skills/`, `.impeccable/`) must **not** be committed.
