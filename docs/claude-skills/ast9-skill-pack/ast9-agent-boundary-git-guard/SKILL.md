---
name: ast9-agent-boundary-git-guard
description: "AST9/NeuCore guard for ALL git, branch, commit, push, PR, merge, and multi-agent work, plus the Claude-vs-Antigravity ownership split. Use whenever a branch/PR/merge/push/cleanup starts, before staging or committing, when deciding who owns a change (backend vs visual), or when two agents may touch the same files. Triggers: 'commit', 'push', 'open PR', 'merge', 'branch', 'git add', 'who should fix this', 'Antigravity', 'role boundary', 'direct to main', 'sync main'. Enforces no-direct-push-to-main, PR-only flow, explicit-path staging, and the strict backend(Claude)/frontend-visual(Antigravity) line. DO NOT USE for the auth-logic specifics (use ast9-auth-routing-guard) or file-deletion/worktree cleanup (use ast9-cleanup-archive-guard)."
---

# AST9 — Agent-Boundary & Git Safety Guard

Apply before any version-control action and whenever ownership of a change is in question. Parent: `AI_WORKFLOW_GUARDRAILS.md` §6 (Commit) and §7 (GitHub/Deploy). This skill makes the role split and the PR-only flow mechanical.

## Ownership split (ground truth)

- **Claude = backend / product-logic / auth / DB / RLS / security.** Owns: Supabase schema, migrations, RLS, RPCs, triggers, cron; edge functions + `_shared` CORS/auth + server-side authz; product/data contracts (auth, owner-only admin, billing/slots, subscription gating, client creation, program generation/publish JSON, workout/logging contracts, PDF logic, exercise-library data, appointments, community permissions); all DB/RLS/authz verification and backend prod smoke.
- **Antigravity = frontend visual / UI.** Owns: CSS, spacing, cards/buttons/forms/tables/modals/tabs/chips/badges, transitions, hover/focus, loading/empty states, layout, responsive appearance, visual review.
- **Off-limits to Claude unless explicitly asked:** `css/neucore-design-system.css`, `css/neucore-premium.css`, `css/styles.css`, `js/neucore-ui.js`. If a backend fix truly needs one of these, **STOP, report why, ask approval, coordinate with their branch.**
- **Owner-only admin** stays intact in every change: exactly one admin (the owner); coaches/clients never become admin; future Team Leader = team-scoped (team RLS), NOT `is_admin()`; never build an admin-creation UI or weaken admin RPCs.

## Core invariants

1. Claude does backend/product/auth/DB/RLS/security; Antigravity does frontend visual/UI/CSS/layout.
2. **No direct push to `main`.** Every change goes through a PR.
3. Always sync from latest `origin/main` before branching.
4. Always confirm current branch and the exact changed-file list before committing.
5. Never overwrite another agent's files; if file overlap is unavoidable, STOP and ask.
6. Never edit Antigravity CSS files unless explicitly approved.
7. Never let Antigravity touch backend/product logic.
8. Stage **explicitly by path** — never `git add .` / `git add -A`.
9. Never commit screenshots, smoke scripts, `node_modules`, `dist`, temp files, `.agents/`, `skills-lock.json`, or secrets (these are gitignored / out-of-scope by design).
10. The commit message states one logical phase using `feat/fix/chore/docs/security(scope): ...`.

## Anti-patterns — BLOCK these

```
git push origin <feature>:main      # pushing a feature ref straight onto main
any direct push to main             # main is production; PR + approval only
git add .  /  git add -A            # stage by explicit path instead
broad  git restore .                # never blanket-discard the working tree
git reset --hard                    # never without explicit approval
git clean (-fd/-fdx)               # never without explicit approval
unapproved git rm                   # deletions are approval-gated
unapproved worktree removal         # see ast9-cleanup-archive-guard
editing the wrong folder D:\ASThub instead of D:\ASThub-current
```

## Required pre-work checklist (start of any branch/PR work)

```
git status
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline --decorate -5
```
Then create a **scoped** branch named for the change (e.g. `fix/<topic>`), based on latest `origin/main`. In a worktree, branch from `origin/main` directly rather than checking out the shared `main` ref.

## Required pre-commit checklist

```
git status
git diff --stat
git diff --name-only
git diff --cached --name-only     # MUST equal the exact approved file list — if more, STOP
```
Confirm only the approved files are staged. Then commit one logical phase; do not merge/push/PR unless explicitly approved for that step.

## Checklist — after merge

- Merge only with explicit owner approval, build green, guards green, smoke acceptable, no Critical/High open.
- Hand the post-merge deployment proof to `ast9-production-verification-guard`.

## Required honesty

- State which files were changed, which were deliberately untouched, whether `main` was synced, whether another agent's active files were touched, and the guard results — every phase (AI_WORKFLOW_GUARDRAILS §10).
- If you did not actually sync `origin/main` or did not run the guards, say so plainly; never self-attest a check you skipped.
