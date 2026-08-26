# AST9 Repository Map

> Structural map of the repository. **Documentation only — the repo is not being
> reorganized.** Verified against the working tree (Phase R0, 2026-06-27).

---

## Top-level

| Path | Role |
|---|---|
| `app.html` | Authenticated single-page app shell (all coach/admin/client sections, modals, scoped styles). |
| `index.html` | Public landing page. |
| `css/` | Styles — NeuCore design system (`neucore-*.css`, `styles.css`, `neucore-premium.css`). **Antigravity-owned.** |
| `js/` | Frontend modules (IIFE `window.*` globals). See [TECH_STACK.md](TECH_STACK.md). |
| `js/dashboard.js` | Role routing, service switcher, section gating (incl. Athletic admin-only lock — PR #72). |
| `js/athleticService.js` | Athletic assessment/movement frontend module; **runtime-locked to admin** via dashboard gating. |
| `js/scoring.js` | Legacy movement scoring (classic IIFE). `readForm()` is the supply boundary — a field it does not deliver is invisible to every downstream engine. |
| `js/gaitEngine.js` | Legacy gait rules. Must stay level with `src/neucore/gait/GaitRules.js` — enforced by `tests/unit/gait-engine-parity.test.js`. |
| `js/integrationEngine.js` | Cross-region analysis: how one region's restriction is paid for by another. Neumann values pinned in-file; a missing input yields `not_assessed`, never a computed finding. |
| `js/panelFold.js` | Turns a panel's own header into a fold control (`window.PanelFold`). Used by the movement-analysis result panels. |
| `src/main.js` | Vite module entry pulled into `app.html`. |
| `src/neucore/gait/` | Gait analysis page, phase strip, and the ES-module gait rules that drive the simulation deficit cards. |
| `src/neucore/simulation/` | Activation data + charts. `MuscleActivationDB` is keyed to the seven gait phases; `ShoulderActivation*` is the upper-body axis (abduction angle), because upper-body muscles have no gait-phase profile. |
| `supabase/migrations/` | Forward DB migrations (timestamped). |
| `supabase/rollbacks/` | One of two historical locations for paired rollback scripts. |
| `supabase/migrations/rollbacks/` | Second historical location for paired rollback scripts. |
| `supabase/functions/` | Edge functions (Deno/TS) + `_shared/auth.ts`. |
| `docs/` | Project documentation — this control-baseline set. |
| `assets/`, `public/` | Static assets. |
| `dist/` | Vite build output (**gitignored**). |
| `node_modules/` | Dependencies (**gitignored**). |

## Documentation layout

- `docs/PROJECT_INDEX.md` — entry map.
- `docs/DEV_LOG.md` — chronological phase log.
- `docs/ISSUE_LOG.md` — bugs + handling.
- `docs/NOT_A_BUG.md` — intended behaviors.
- `docs/DECISIONS.md` — decisions of record.
- `docs/KNOWN_LIMITATIONS.md` — current limitations.
- `docs/DISASTER_RECOVERY.md` — unverified recovery inventory, proposed
  objectives, owner coverage checklist, and isolated-staging restore drill.
- `docs/TECH_STACK.md` — stack + file groupings.
- `docs/REPO_MAP.md` — this file.
- `docs/claude-skills/`, `docs/rehab-book/` — pre-existing reference subfolders.
- Repo-root `*.md` — canonical deep-dive feature/architecture docs (the detailed
  source of truth this set indexes).

## Scratch / tools (local-only, not committed)

Local verification scripts (Python structure/migration checks) and agent/skill
tooling artifacts live only on disk and are not committed. Untracked local tooling
dirs seen in the working tree — `.codex/`, `.github/skills/`, `.impeccable/` — are
**not** part of the app and must not be added to a commit. Git-ignored paths are
listed in [TECH_STACK.md](TECH_STACK.md) (Scratch / tools policy).

## What this map intentionally does **not** do

It does not propose moving, renaming, merging, or deleting any file. Repo
reorganization, if ever desired, is a separate approved phase.
