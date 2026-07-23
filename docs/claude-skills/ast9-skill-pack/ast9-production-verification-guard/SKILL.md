---
name: ast9-production-verification-guard
description: "AST9/NeuCore guard for post-merge, deploy, and production-verification reporting — and for telling real authenticated smoke apart from mocked/visual smoke. Use after a merge, after a GitHub Pages deploy, when verifying a PR shipped, when reporting test results, or when tempted to call something 'production-safe'. Triggers: 'after merge', 'deploy', 'GitHub Pages', 'production smoke', 'verify live', 'is it live', 'report results', 'production-safe', 'cache bust live'. Forces: live-asset verification, honest smoke labeling, and the required post-merge report. Prevents overclaiming. DO NOT USE for pre-merge git mechanics (use ast9-agent-boundary-git-guard)."
---

# AST9 — Production Verification & Honesty Guard

Apply after any merge/deploy and whenever reporting verification. Pushing to `main` **is** deploying (GitHub Pages → `https://abdelrahmansabry1909-oss.github.io/AST9_HUB/`). Parent: `AI_WORKFLOW_GUARDRAILS.md` §8.

## The mistakes this prevents

- Calling a change "verified" / "production-safe" when only a build + code-read happened — no real authenticated user flow was exercised.
- Reporting success before the GitHub Pages deploy finished, or before confirming the **live** asset actually carries the change (stale CDN / missing `?v=` bump).
- Overclaiming scope (e.g. "works for all roles") from a single-path check.

## Core invariants

1. Visual/markup smoke is **not** the same as real authenticated smoke.
2. If a mocked/offline Supabase or no-credential path was used, **say so explicitly.**
3. If real credentials were not used, state verbatim: **"Real authenticated smoke was not performed. Production verification was code/asset-level only."**
4. After merge, **wait** for the `Deploy to GitHub Pages` run to finish (success) before verifying.
5. Verify the **live** asset contains the expected change (fetch it; confirm new logic and bumped `?v=`; confirm the old token is gone).
6. Verify the latest `main` / merge commit hash.
7. Confirm no temp files / `dist` / `node_modules` / screenshots were committed.
8. Confirm the PR diff file list equals the approved set.
9. Report console errors honestly (don't omit them).
10. Do **not** claim production-safe until real owner/coach/client workflows are tested (by the owner if Claude has no credentials).

## Anti-patterns — BLOCK these

- "Tested and production-safe" with no authenticated run → relabel as code/asset-level only.
- Verifying before the deploy run succeeded.
- Trusting the repo/build artifact instead of fetching the **live** deployed asset.
- Hiding or glossing console errors / unhandled rejections.
- Generalizing one role's path to "all roles work."

## Required post-merge report

```
merge commit hash
latest main commit hash (origin/main)
deployment status (Deploy to GitHub Pages run + result)
live URL checked
live-asset verification (new logic present? old ?v= gone? new ?v= present?)
screens / flows tested
console errors (honestly)
backend unchanged (or what changed, with proof)
JS logic changed or unchanged
HTML changed or unchanged
temporary files excluded (no dist/node_modules/screenshots/temp committed)
real authenticated smoke status (performed? with whose credentials? or NOT performed)
known limitations
```

## Ownership / honesty

- Codex verifies backend/code/DB/RLS behavior, Antigravity verifies frontend assets and visual behavior, and Claude reviews the evidence. **Real device + real credential** owner/coach/client smoke is the owner's manual step when dedicated test credentials are unavailable — name it as pending, do not retrieve credentials or fake it.
- Never inspect `.env`, tokens, cookies, localStorage, sessionStorage, saved profiles, or credentials to "verify" — that is not permitted and not necessary for asset-level checks.
- A change is "done" only when its applicable checks are green **and** the honest smoke status is stated.
