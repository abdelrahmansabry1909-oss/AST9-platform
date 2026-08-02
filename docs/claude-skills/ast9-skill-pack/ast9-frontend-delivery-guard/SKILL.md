---
name: ast9-frontend-delivery-guard
description: "AST9/NeuCore guard for delivering and reporting FRONTEND changes (js/*.js, css/*, app.html markup). Use whenever implementing or reviewing a frontend task, and whenever reading an implementation report before landing it. Triggers: 'Antigravity report', 'frontend fix', 'the delegate says', 'PASS (Code Verified)', 'implementation report', reviewing a js/ or css/ diff, or landing a UI change. Encodes the 2026-08-02 failures: an undeclared `_allClients` that threw ReferenceError on every call and regressed working admin delete while being reported as PASS; a `#billing-catalog` scroll target that never existed; a `PACKAGE_EXPIRED` server code that is never sent; a dropped `padding:16px`; a panel docked 35% below the fold; and changes reported as done that were absent from the diff twice. DO NOT USE for backend/SQL/edge-function work (that is Claude's lane) or for mobile Sign-In reachability (use ast9-frontend-launch-guard)."
---

# AST9 — Frontend Delivery & Report-Trust Guard

Apply when writing a frontend change, and again when reading an implementation report before
landing it. Parent: [`AI_WORKFLOW_GUARDRAILS.md`](../../../../AI_WORKFLOW_GUARDRAILS.md) §3
(verification) and §6 (commit).

## The regressions this prevents

All observed on 2026-08-02, across four rounds on the payments/clients UI. Every one passed
`npm run test:unit` (142/142) and `npm run build`. **The gates cannot catch any of them.**

1. **Invented identifier → ReferenceError.** `removeClient()` read `_allClients`, which exists
   nowhere in the repo, on a line **outside** the `try` block. Reading an undeclared identifier
   throws, so the function died on every call — **including the admin delete that was working in
   production**. Reported as "PASS (Code Verified)".
2. **Invented element id.** A "Renew Package Below ↓" button scrolled to `#billing-catalog`,
   which did not exist. The `if (el)` guard swallowed it: the user clicks, nothing moves.
3. **Invented server contract.** UI branched on a `PACKAGE_EXPIRED` code. `create-user` returns
   exactly one code — `SLOT_LIMIT_REACHED` — so the branch was dead on arrival.
4. **Silent drop while rewriting a block.** `padding: 16px` disappeared when a modal's `cssText`
   was rewritten, and no CSS rule replaces it → every control flush against the border.
5. **Untested geometry.** A panel docked under a 560px canvas put 35% of itself below the fold at
   1366×768, taking the **Save button** off-screen.
6. **Explicit instruction ignored.** A constructor argument was requested; a consumer's DOM id was
   hardcoded inside a generic base class instead.
7. **Reported work absent from the diff.** The same `_showSlotLimit` change was claimed as done in
   **two consecutive rounds** and was in neither.

## Core invariants

1. **Every identifier you reference must be proven to exist first.** Before referencing a
   variable, element id, CSS class, global, or server error code — grep for it. `grep -rn "_allClients" js/`
   takes seconds and would have prevented failures 1–3.
2. **`|| []` and `?.` do not rescue an undeclared variable.** `(_undeclared || [])` throws.
   Only `typeof x === 'undefined'` is safe for a name that may not exist.
3. **Edit minimally; never retype a block you meant to modify.** When changing one property of a
   `cssText`/style string, change that property. Rewriting the whole string is how `padding`
   vanished.
4. **Match the app's existing convention rather than inventing a second one.** Modals: overlay is
   `.modal-overlay hidden` toggled via **`.hidden`**; the card is **`.modal`**; the close button is
   **`.btn-icon`**. `.modal-card` and `.modal-close` have **zero** CSS rules in this repo.
5. **`js/*.js` is served static with no content hashing.** Any change to a `js/` file **requires**
   bumping its `?v=` token in `app.html`, or users keep the broken copy. `css/*` and `src/**` are
   Vite-hashed and self-bust — do not add `?v=` there.
6. **Never `display: … !important` on anything JS toggles.** Four production regressions. Use `.hidden`.
7. **Frontend only.** Never edit `supabase/migrations/*`, `supabase/functions/*`, or any SQL. If the
   fix appears to need one, stop and report.
8. **Never modify production data to manufacture a test condition.** Not `coach_subscriptions`, not
   `package_prices`, not anything. Ask for a test account or report the check as not run.
9. **A deviation from the brief must be surfaced, not silently substituted.** If the brief asks for a
   constructor argument and you choose otherwise, say so and why.

## Anti-patterns — BLOCK these

- Writing **"PASS (Code Verified)"**. Reading code does not execute it; a `ReferenceError` is
  invisible to reading. Either it ran or it did not.
- Reporting a check as passed when the data required for it **does not exist** (e.g. "the coach saw
  an active purchase button" while the database holds zero active price rows).
- Reporting a change that is not in the diff. Before writing the report, re-read your own
  `git diff` and describe only what is in it.
- Marking auth-gated checks (coach session, owner queue, client dashboard) as passed when no sign-in
  was performed.
- Treating a green `npm run test:unit` / `npm run build` as behavioural evidence. Nothing in the
  suite loads `js/clients.js` or clicks anything.
- Adding a defensive guard (`if (el)`, `catch {}`) around a target you never confirmed exists — it
  converts a loud failure into a silent one.

## Required tests

Run the changed code in a browser. For a `js/*.js` module this needs no sign-in: serve the repo,
stub `sb` / `Auth` / `Dashboard`, load the real file, and call the real function.

```
call every changed function at least once — confirm it does not throw
exercise every branch of any permission/ownership check (allowed AND denied)
confirm the denied path did NOT perform the action, not merely that a message appeared
click every control you added — confirm the target element exists and responds
layout checked at 1366x768 and 1280x800, not just a maximised window
confirm no control lands below the fold
console: zero errors
?v= token bumped in app.html for every changed js/*.js
npm run test:unit && npm run build
```

## Required honesty

- If a check was not run, write **NOT RUN** and one line saying why. That costs nothing.
  A false PASS costs a full review round and, once, shipped a regression to production.
- Distinguish "I read the code and it looks right" from "I ran it and observed X". Only the second
  is verification.
- State any deviation from the brief, any file you touched that the brief did not name, and anything
  you could not finish.
- The reviewer re-derives every claim against the repo and the production database. An honest
  "not tested" is always cheaper than a claim that does not survive checking.
