---
name: ast9-auth-routing-guard
description: "AST9/NeuCore guard for authentication, session, and client login-routing work. Use BEFORE editing or reviewing js/auth.js, js/subscriptionService.js, js/supabaseClient.js, the app.html auth boot/IIFE code, the SIGNED_OUT auth-state listener, the client subscription gate, role routing, the client dashboard boot, mobile login, session persistence, or cache-bust script tags. Triggers: 'login bounces to landing', 'client can't log in', 'mobile login', 'subscription gate', 'inactive client', 'SIGNED_OUT', 'Auth.init', 'getSession', 'redirect to index.html', 'cache bust', 'app.html?login=1'. Encodes the real PR #53 landing-bounce regression so it never recurs. DO NOT USE for CSS-only Sign-In reachability (use ast9-frontend-launch-guard) or pure git/PR mechanics (use ast9-agent-boundary-git-guard)."
---

# AST9 — Auth / Session / Client-Login Routing Guard

Apply this as a guard pass whenever auth, session, role-routing, or the client subscription gate is touched or reviewed. This skill exists because a real high-severity production bug shipped to a near-onboarded client (fixed in **PR #53**, merge `8ea94cd`, file refs below). Parent workflow: `AI_WORKFLOW_GUARDRAILS.md` (this is the auth-specific extension of §9 Production Safety).

## The regression this prevents (what actually happened)

1. The **client subscription gate** in `js/auth.js` (`login()` and `init()`, runs only for `role === 'client'`) called a plain `sb.auth.signOut()` when a client wasn't `active`/`grace`.
2. That sign-out fired `onAuthStateChange('SIGNED_OUT')`.
3. The global listener in `app.html` did `window.location.href = 'index.html'`.
4. Result: a gated client was **hard-redirected to the marketing landing page** instead of seeing the `#screen-subscription-inactive` (contact-coach) screen.
5. Compounding cause: `SubscriptionService.getEffectiveState` **failed closed** — any read error/throw/timeout returned `effective_status: 'none'`, so a *valid active* client on a flaky/cold-Supabase mobile network was gated by a false inactive state.
6. Compounding cause: the boot IIFE raced `Auth.init()` against a 4s timeout resolving to `null`, so a slow returning session was treated as logged-out and bounced.
7. The fix: gate-signout suppression (`_gateSignOut` + one-shot `consumeGateSignout`), an `unknown` sentinel instead of `none`, a `TIMED_OUT` boot sentinel with a longer window, and cache-bust bumps.

## Core invariants (non-negotiable)

1. **Active** client login enters the app.
2. **Inactive** client login shows the subscription-inactive / contact-coach screen — **never** the landing page.
3. A **transient** subscription-state read failure resolves to `unknown`, **not** `none`.
4. `unknown` must **not** immediately sign out a valid client (login → retry message on the login screen; returning session → stay in app read-only via `canWrite()`).
5. A **gate** sign-out must **not** trigger the global `SIGNED_OUT → index.html` redirect (suppress via `consumeGateSignout()` one-shot).
6. A **real user logout** must still redirect safely to `index.html`.
7. A **boot timeout** is not a definite logged-out state — show login, do not `_bounceToLanding()`.
8. Owner/coach routing stays unchanged (the gate is `role === 'client'` only).
9. Owner-only admin rule stays unchanged — exactly one admin (owner); coaches/clients never become admin; a future Team Leader is team-scoped, NOT global admin; never weaken admin RPCs or add an admin-creation surface.
10. When a `?v=`-tokened JS file changes, its `?v=` in `app.html` must be bumped in the same change.

## Anti-patterns — BLOCK these

- Returning `none` (or any "inactive") for a subscription-state **read error/throw/timeout**. Use the `unknown` sentinel.
- Calling plain `sb.auth.signOut()` inside the subscription gate **without** arming the SIGNED_OUT-redirect suppression.
- Letting **every** `SIGNED_OUT` event redirect to `index.html` (must honor the gate-signout consume check).
- Treating an `Auth.init()` **timeout** as a real logged-out state and bouncing to landing.
- Changing owner/admin role logic, or any admin RPC, while fixing client login.
- Changing backend/RLS/schema/edge functions to "fix" a client-routing bug **without proof** it is a data/RLS cause.
- Editing CSS / Antigravity files (`css/*`, `js/neucore-ui.js`) for an auth-routing bug.
- Forgetting the `?v=` cache-bust bump after editing a tokened JS file → GitHub Pages serves the stale bundle.

## Ownership classification

- **Codex owns implementation.** Auth, session, role routing, subscription gating, Supabase client, server-side authz — backend/product/security. Claude audits and reviews the plan and result.
- A *visible* Sign-In button being missing on mobile is **CSS** (Antigravity / `ast9-frontend-launch-guard`). A bounce **after** a visible Sign-In is **auth routing** (Codex / this skill). Classify before touching anything.

## Checklist — before implementation (read-only)

- Restate objective + name exact files. Confirm it is auth-routing, not CSS reachability.
- `git fetch origin`; branch from latest `origin/main`; confirm no overlapping Antigravity branch.
- Trace every `window.location` write to `index.html` and every `SIGNED_OUT`/`signOut()` path before editing.
- Classify backend impact: state "Data/RLS/Edge impact: none" unless proven necessary (then design-first + approval per AI_WORKFLOW_GUARDRAILS §9).

## Checklist — before commit

```
node --check js/auth.js
node --check js/subscriptionService.js
npm run build
git diff --name-only          # exactly the approved files
git diff --cached --name-only # exactly the approved files
```
Behavioral trace / smoke:
```
active client login (desktop)
active client login (mobile / incognito)
inactive client login (desktop + mobile) → inactive screen, stays on app.html
temporary subscription read failure → retry (login) / read-only (returning session)
returning-session boot timeout → login or app, never landing
owner login (unchanged)
coach login (unchanged)
real logout → redirects to index.html
app.html?login=1 opens the login screen
no landing bounce unless truly logged out
cache-bust ?v= tokens bumped for every changed tokened JS file
```
Run `clean-code-guard` (mechanical → architecture → AI-failure-mode). Fix only real findings.

## Checklist — after merge

- Wait for the `Deploy to GitHub Pages` run to finish (success).
- Verify the **live** `app.html` carries the new `?v=` and the live JS contains the new logic (e.g. `consumeGateSignout`, `effective_status: 'unknown'`, the boot sentinel).
- Hand off to `ast9-production-verification-guard` for the full post-merge report.

## Required honesty

- A static code-path trace + `node --check` + build is **not** authenticated smoke. If real owner/coach/client/logout/inactive flows were not exercised with real credentials, state: **"Real authenticated smoke was not performed. Production verification was code/asset-level only."**
- If a client still bounces on **desktop**, suspect an un-activated subscription (coach/owner data action) or an RLS denial reading the client's own `v_client_subscription_state` row — a separate, proof-gated backend matter, not a JS reflex fix.
