# AI_WORKFLOW_GUARDRAILS.md

**Status:** Mandatory. This document defines the required development workflow for this project going forward. It applies to every contributor and every AI agent working in this repository.

**Purpose:** Make all future work **stable, guarded, testable, and production-safe**. The cost of a careless change to this codebase (auth, RLS, subscriptions, coach/client visibility, live GitHub Pages deploy) is high. These guardrails trade a little speed for predictability and safety.

**Project context (ground truth):**
- Static front end: vanilla-JS IIFE modules (`window.*` globals) + Supabase JS + Three.js + Chart.js, built with **Vite** (multi-page: `index.html` landing + `app.html` app).
- Build: `npm run build`. Syntax gate: `node --check <file>`.
- Deploy: pushing to **`main`** triggers `.github/workflows/deploy.yml` → GitHub Pages at `https://abdelrahmansabry1909-oss.github.io/AST9_HUB/`. There is no separate staging deploy.
- Backend: Supabase (Postgres + RLS + Edge Functions + pg_cron). Live verification is done against the project DB.
- Guard skills live in `.agents/skills/` (`clean-code-guard`, `docs-guard`, `test-guard`, `woo-guard`, `wp-guard`).
- In-repo verification includes Playwright smoke tests under `tests/smoke/` and
  Node unit tests under `tests/unit/`. Authenticated Playwright scenarios
  self-skip when the dedicated `AST9_E2E_*` secrets are unavailable.

---

## 1. Agent Ownership

| Role | Responsibility | Must not do |
|---|---|---|
| **Claude** | Audit, architecture planning, risk analysis, and revision review | Implement product code or silently approve its own assumptions |
| **Codex** | Backend, data contracts, product logic, auth, RLS, migrations, Edge Functions, payments, security, and backend tests | Edit frontend visual/layout files unless the owner explicitly reassigns that file |
| **Antigravity** | Frontend structure, CSS, responsive behavior, visual interaction, and browser visual QA | Edit backend, Supabase, auth, billing, RLS, security, or product-scoring logic |

Claude provides the plan and reviews evidence. Codex and Antigravity implement
only inside their assigned ownership. No agent may request or recover credentials,
tokens, browser storage, or broader filesystem access to bypass these boundaries.
Any cross-boundary dependency is reported to the owner and split into a separate
approved task.

---

## 2. Phase Discipline

Every task is handled as a **single phase**. For every phase, in order:

1. **Understand scope.** Restate the objective in your own words.
2. **Confirm affected files/modules.** Name them before editing.
3. **Make the smallest safe change** that satisfies the objective.
4. **Verify** (see §4).
5. **Run guard-skills** (see §5).
6. **Fix only real findings.**
7. **Commit** (see §7).
8. **Stop and wait for approval** before the next phase.

Rules:
- **No multi-feature batches.** One logical change per phase.
- **No silent scope expansion.** If you discover adjacent work, report it and ask — do not fold it in.

---

## 3. Before Coding

Before writing any implementation, **state explicitly**:

- **Objective** — what this phase delivers.
- **Files likely affected** — the modules/files you expect to touch.
- **Data / RLS / Edge impact** — any database, policy, or edge-function effect (or "none").
- **Risk level** — Low / Medium / High, with a one-line reason.
- **Verification plan** — exactly how §4 will be satisfied for this phase.

**Architecture-first gate.** If the task touches any of:
**database · RLS · Edge Functions · auth · subscriptions · payments · user roles · production security**

then:
- Present the **architecture/design first** (no implementation code).
- **Wait for explicit approval.**
- **No direct coding until approved.**

---

## 4. Required Verification After Every Phase

Always run the checks relevant to what changed:

- **`node --check`** on every changed JS file. *(always, if any JS changed)*
- **`npm run build`** must pass. *(always, for any front-end change)*
- **Route / regression check** relevant to the phase (e.g. loaders, nav links, exports intact, no orphaned routes).
- **Browser smoke test** if UI changed (drive the real module behavior; confirm zero console errors / unhandled rejections).
- **Live DB verification** if database/RLS behavior changed (query the live DB; confirm policies behave as intended for each role).
- **Edge-function probe** if edge functions changed (invoke and confirm auth gating + expected response).

A phase is not "done" until its applicable checks are green.

---

## 5. Mandatory Guard-Skills Review

After implementation and **before commit**, run the applicable guard-skills.

- **Always:** `clean-code-guard`.
- **When relevant:**
  - `docs-guard` — if documentation changed.
  - `test-guard` — when the changed behavior is covered by the in-repo
    Playwright or Node test suites, or when the phase adds/changes tests.
  - `wp-guard` / `woo-guard` — **not applicable** unless WordPress/WooCommerce is introduced.

**Order of application (strict):**
1. **Mechanical verification first** (§4 — `node --check`, build, smoke).
2. **Architecture / code review** (clean-code-guard: naming, functions, SOLID, DRY/KISS/YAGNI).
3. **AI-failure-mode review** (clean-code-guard: swallowed errors, defensive guards, premature abstraction, dead code, hallucinated APIs, mock/"success" fixtures, plausible-but-wrong code, speculative config).
4. **Docs review** (docs-guard) if relevant.

Discipline:
- **Only fix real findings.**
- **Do not invent cleanup work.**
- **Do not refactor stable code unnecessarily.**
- **Do not use guard-skills as an excuse to expand scope.**

---

## 6. Required Guard Prompt After Every Phase

Run this checklist verbatim after every implementation phase:

> **Phase implementation complete.**
>
> Before committing:
> 1. Run the applicable guard-skills review.
> 2. Use:
>    - `clean-code-guard`
>    - `docs-guard` if docs changed
> 3. Apply the guards properly:
>    - mechanical verification first
>    - then architectural / code review
>    - then AI-failure-mode review
> 4. Only fix **REAL** findings.
> 5. Do not invent cleanup work.
> 6. Do not refactor stable code unnecessarily.
> 7. Re-run:
>    - `node --check`
>    - `npm run build`
>    - smoke verification if needed
> 8. Then provide:
>    - findings by severity
>    - what was fixed
>    - what was intentionally left
>    - final readiness verdict
>
> **Do not start another feature until the phase is approved.**

---

## 7. Commit Rules

Every commit must be:
- **one logical phase**,
- **small enough to review**,
- **verified before commit**,
- **described clearly**.

**Commit message format:**
- `feat(scope): ...`
- `fix(scope): ...`
- `chore(scope): ...`
- `docs(scope): ...`
- `security(scope): ...`

**Never commit:**
- unrelated files,
- local temp files,
- generated artifacts (unless explicitly required),
- secret values,
- accidental tool files (e.g. `.agents/`, `skills-lock.json`, smoke harnesses, lockfiles for local tooling).

Stage files **explicitly by path** — never `git add .` / `git add -A` — so unrelated working-tree changes never slip into a commit.

---

## 8. GitHub / Deployment Rules

**Do not merge to `main` unless ALL hold:**
- build passes,
- guards pass,
- smoke test passes,
- **no Critical or High issues remain**,
- **user approves the merge**.

**After merge:**
- monitor the GitHub Pages deploy (`Deploy to GitHub Pages` workflow run),
- verify the deployed URL responds and serves the new build,
- run a production smoke check (app loads, login/landing loads, routes load, auth guard works, no new console errors),
- report the deployment result (deployed commit, run status, smoke verdict).

Pushing to `main` **is** deploying — treat every `main` merge as a production release.

---

## 9. Production Safety Rules

Work involving any of the following requires **extra caution**:
**auth · user roles · subscriptions · RLS · Edge Functions · database migrations · cron jobs · payments · messaging permissions · coach/client visibility.**

For these:
- **architecture first** (design + approval before code),
- **live verification after** (prove the behavior against the real DB / function per role),
- **rollback plan required** (know how to revert: migration down-path, previous deploy, or feature toggle),
- **no assumptions** — confirm RLS/role behavior empirically; never infer it.

---

## 10. Documentation Rules

Update documentation when any of these change:
- architecture,
- workflow,
- security behavior,
- user-facing navigation,
- deployment process.

If docs changed in a phase, **run `docs-guard`** (verify every referenced symbol/flag/endpoint/path against the source; fix drift in the same phase).

---

## 11. Final Phase Report

After every phase, report:
- **files changed**,
- **verification results** (§4 outcomes),
- **guard-skills findings** (by severity),
- **what was fixed**,
- **what was intentionally left** (with reason),
- **commit hash**,
- **remaining risks**,
- **next recommended step**.

---

## AST9 Claude Skills Pack

In addition to the general guard skills in §5, this repo has a **project-specific** AST9 Claude
skills pack that encodes the real regressions and process mistakes already hit during AST9
development: client-login landing bounce, mobile Sign-In reachability, realtime smoke testing,
cleanup/worktree safety, agent boundaries, and production verification.

- **Runtime (active) location:** `.claude/skills/` — auto-discovered by Claude Code, but **gitignored** (local-only).
- **Canonical tracked copy:** [`docs/claude-skills/ast9-skill-pack/`](docs/claude-skills/ast9-skill-pack/) — the version-controlled source of truth. Its `README.md` lists the six skills, what each one prevents, and how to reinstall them into `.claude/skills/`.

Keep the runtime and canonical copies in sync when a skill changes. Installing or copying skills must never edit production app code.

---

## Standing constraints

- **Do not start Feature 8.**
- **Do not implement referrals** (design-only until explicitly approved).
- No product/behavior changes outside an approved phase.
- One focused commit per phase; stop and wait for approval between phases.
