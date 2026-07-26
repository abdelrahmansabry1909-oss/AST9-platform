# AST9 Claude Skills Pack — canonical tracked copy

This folder is the **durable, version-controlled source of truth** for the AST9 project-specific
Claude guard skills. The skills run from `.claude/skills/`, but that path is gitignored
(see the repo `.gitignore` — `.claude/`, `.agents/`, and `skills-lock.json` are all ignored),
so the runtime copy is local-only and would be lost if the worktree is removed. This tracked
copy under `docs/` preserves them and lets anyone reinstall or review them.

Parent workflow doc: [`AI_WORKFLOW_GUARDRAILS.md`](../../../AI_WORKFLOW_GUARDRAILS.md). These six
skills are the project-specific extension of those mandatory guardrails.

## 1. What the AST9 skills pack is

A set of six project-authored Claude skills that encode the **real regressions and process
mistakes already hit during AST9/NeuCore development**, and force the correct checklist before
similar changes are made again. Each skill is a directory containing a `SKILL.md` with YAML
frontmatter (`name`, `description`) whose `description` is a trigger paragraph that lets Claude
Code auto-activate the skill on relevant work.

These are **separate** from the general-purpose marketplace guard skills already installed
(`clean-code-guard`, `docs-guard`, `test-guard`, `woo-guard`, `wp-guard`), which were installed
from `amElnagdy/guard-skills` and are tracked by `skills-lock.json`. The AST9 pack is
project-specific and authored in-repo.

## 2. The six skills

| Skill | Scope |
|---|---|
| `ast9-auth-routing-guard` | Auth/session/client-login routing, the client subscription gate, the `SIGNED_OUT` listener, boot routing, cache-bust tokens. |
| `ast9-agent-boundary-git-guard` | Git/branch/PR/merge flow + Claude(audit), Codex(backend), and Antigravity(frontend) ownership boundaries. |
| `ast9-frontend-launch-guard` | Landing page, mobile nav, Sign-In reachability, public/auth entry visibility. |
| `ast9-realtime-smoke-guard` | Realtime / no-refresh behavior and how to test the *subscribed* state honestly. |
| `ast9-cleanup-archive-guard` | File/folder deletion, archiving, and `git worktree` retirement safety. |
| `ast9-production-verification-guard` | Post-merge/deploy verification and honest smoke labeling (no overclaiming). |

## 3. Which AST9 failure each skill prevents

- **`ast9-auth-routing-guard`** — the client-login **landing-bounce** bug (PR #53): the subscription
  gate's `sb.auth.signOut()` fired `SIGNED_OUT`, whose global listener redirected to `index.html`,
  so a gated client landed on the marketing page instead of the subscription-inactive screen; the
  subscription read also failed **closed** to `none` and a 4-second boot timeout raced a slower
  `Auth.init()`. Enforces: gate-signout suppression, an `unknown` sentinel (not `none`), a boot
  timeout that does not bounce, unchanged owner/coach routing + owner-only admin, and cache-bust bumps.
- **`ast9-agent-boundary-git-guard`** — direct-push-to-main, cross-agent file overwrites, accidental
  staging of tooling/`dist`/`node_modules`/screenshots/secrets, and wrong-folder edits.
- **`ast9-frontend-launch-guard`** — the **mobile launch blocker** (PR #52): at ≤900px the landing hid
  the Sign-In button behind a hamburger that had no handler and no menu, leaving no path to login.
  Also enforces the CSS-reachability (Antigravity) vs post-login-bounce (Claude) classification.
- **`ast9-realtime-smoke-guard`** — the **false "realtime broken"** conclusion caused by testing a view
  whose channel was never subscribed (the thread was never opened), plus duplicate-channel and
  over-scoped-load mistakes.
- **`ast9-cleanup-archive-guard`** — destroying unpushed/local-only work during cleanup; manual deletion
  of `.claude` worktrees; unapproved `git clean` / `reset --hard`; the `D:\ASThub-current` (current) vs
  `D:\ASThub` (legacy) mix-up.
- **`ast9-production-verification-guard`** — calling a change "production-safe" from a build-only check,
  verifying before the GitHub Pages deploy finished, or trusting the repo artifact instead of the live asset.

## 4. Active runtime location

Claude Code discovers and auto-activates project skills from:

```
.claude/skills/<skill-name>/SKILL.md
```

The six AST9 skills are installed there now and register automatically on load. **That path is
gitignored**, so it is the *runtime* copy, not the canonical source.

## 5. This folder is the durable canonical copy

```
docs/claude-skills/ast9-skill-pack/<skill-name>/SKILL.md
```

This `docs/` tree **is** tracked by git, so it survives worktree removal, can be reviewed in PRs, and
can be re-installed at any time. Keep it in sync with `.claude/skills/` whenever a skill changes
(edit one, copy to the other).

## 6. Reinstall / copy into the runtime location

From the repo root, mirror the canonical copy into the active runtime path:

```bash
for s in docs/claude-skills/ast9-skill-pack/ast9-*/; do
  name=$(basename "$s")
  mkdir -p ".claude/skills/$name"
  cp "$s/SKILL.md" ".claude/skills/$name/SKILL.md"
done
```

(To go the other direction — refresh this canonical copy from a runtime edit — swap source and
destination.) No package manager is required for these to work; `.claude/skills/` is read directly.
If the team later prefers managed installs, these can instead be published to a git repo and added
via the same skills manager that produced `skills-lock.json`.

## 7. Installing skills must not touch production app code

Copying skill files only ever writes under `.claude/skills/` (runtime) and
`docs/claude-skills/ast9-skill-pack/` (canonical). **Never** edit `app.html`, `index.html`, `js/*`,
`css/*`, `supabase/*`, `package.json`, `.github/workflows/*`, or `.env*` as part of installing,
copying, or updating skills. Skills are instructions for the agent — not application code.
