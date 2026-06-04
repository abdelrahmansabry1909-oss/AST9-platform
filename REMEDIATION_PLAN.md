# NeuCore / AST9 — Remediation Plan

Derived from **SYSTEM_REVIEW.md**; verification gates reference **TEST_MATRIX.md**.
**This is a plan only — no fixes are implemented.** Awaiting approval before any code/schema/edge-function change. Sequenced by severity; each phase is independently shippable and independently verifiable. Proposed to honor the project's locked rules: architecture-first, one tight commit per logical fix, verify live before proceeding, no scope drift.

Legend: **Effort** S/M/L · **Risk** = blast radius of the change itself.

---

## Phase 0 — VERIFY (do first, no code)

| # | Action | Why |
|---|---|---|
| V-1 | Check GoTrue **signup-enabled** setting (Dashboard → Auth → Providers / `DISABLE_SIGNUP`). | Determines whether **H-1** is High or Critical (anonymous admin self-signup). |
| V-2 | Confirm the intended **subscription-management authority**: admin-only, or coaches too? | Decides the shape of the **H-2** fix (gate UI vs. add RPCs). |
| V-3 | Inventory which client roles are allowed to call `create-user` (coach self-serve onboarding vs admin-only). | Decides the authz rule for **C-1**. |

Output: a one-paragraph decision note. No commits.

---

## Phase 1 — CRITICAL: lock the edge-function tier (C-1, C-2, H-4)

> The edge functions run with the **service role** and therefore bypass all RLS. They are the top risk. All three share the same defect: presence-of-header ≠ authorization.

**R-1 (C-1) — Authorize `create-user`.** *Effort M · Risk M.*
- **Approach:** Inside the function, resolve the caller from the JWT (create a request-scoped client with the caller's `Authorization` header, `auth.getUser()`), look up their `profiles.role`, and **reject unless admin** (or admin/coach per V-3). Additionally **forbid `role` values the caller may not grant** (a coach, if allowed, may create only `client`; only an admin may create `coach`/`admin`). Keep the service-role client only for the actual `admin.createUser`/profile upsert after the check passes.
- **Scope:** `create-user/index.ts` (and commit it to `supabase/functions/` — see R-5).
- **Verify:** SEC-EDGE-01 (CLIENT→403, no account), plus an ADMIN happy-path INT.
- **Risk note:** must not break `clients.js` admin flow — keep request/response shape identical.

**R-2 (C-2) — Authorize `delete-user`.** *Effort S · Risk M.*
- **Approach:** Same caller-role resolution; **admin-only**. Consider also blocking self-delete and last-admin-delete.
- **Verify:** SEC-EDGE-02 (CLIENT→403; ADMIN→ok).

**R-3 (H-4) — Authorize + sanitize `send-email`.** *Effort S · Risk L.*
- **Approach:** Require admin/coach caller; if coach, restrict `client_id` to their assigned clients. HTML-escape `message` before interpolation. Tighten CORS (R-6).
- **Verify:** SEC-EDGE-03.

**R-4 (H-1) — Stop trusting client `role` on signup.** *Effort S · Risk M (touches auth).*
- **Approach (depends on V-1):** If signup should be closed, disable it in GoTrue. **Regardless**, change `handle_new_user` to **ignore `raw_user_meta_data->>'role'` and always insert `role='client'`** (privileged roles are assigned only by an admin path afterward). This makes the trigger safe even if signup is later opened.
- **Scope:** one migration (`handle_new_user` CREATE OR REPLACE). Coordinate with R-1 (create-user passes role in metadata → if the trigger ignores it, create-user must set role via its own upsert, which it already does `on conflict do nothing` — verify the upsert wins / adjust ordering).
- **Verify:** SEC-SIGNUP-01.

**Phase-1 gate:** SEC-EDGE-01/02/03 + SEC-SIGNUP-01 all pass; `clients.js` admin create/delete still works. One commit per function + one for the trigger.

---

## Phase 2 — HIGH: drift + subscription write path (H-3, H-2)

**R-5 (H-3) — End edge-function drift.** *Effort M · Risk L.*
- **Approach:** Pull the current deployed source of all 5 functions into `supabase/functions/<slug>/index.ts` (committing the **post-R1..R3 hardened** versions), add `deno.json`/import maps where used, and remove or clearly mark the two orphaned on-disk functions (`rpm-ai-suggest`, `visitor-survey`) as deployed-or-not. Document deploy via `supabase functions deploy` going forward.
- **Verify:** repo has all 5; `ezbr_sha256` of redeployed == repo build; no behavior change to callers.
- **Risk note:** redeploy is the only mutating step — do it deliberately, one function at a time.

**R-6 — Tighten edge CORS (SEC-CORS-01).** *Effort S · Risk L.* Replace `Access-Control-Allow-Origin: *` on privileged functions with the app origin allow-list. Bundle with R-1..R3.

**R-7 (H-2) — Single subscription write path.** *Effort M · Risk M.*
- **Approach (depends on V-2):**
  - *If admin-only:* gate the `submit`/`activate`/`remove` controls in `subscriptions.js` to admins, and add rows-affected checks so they never toast success on 0 rows.
  - *If coaches too:* add guarded SECURITY DEFINER RPCs (`create_subscription`, `set_subscription_status`, `delete_subscription`) mirroring `reactivate_subscription`'s authz, and route `subscriptions.js` through `SubscriptionService` for all four operations (eliminating direct table writes). Keep `subscriptions_admin_write` for admin/break-glass.
- **Scope:** `subscriptions.js`, `subscriptionService.js`, (optionally) one RPC migration.
- **Verify:** SEC-RLS-02, REG-SUB-01.

**Phase-2 gate:** REG-SUB-01 + SEC-RLS-02 pass; repo↔deploy parity for edge functions; no coach-facing silent failures.

---

## Phase 3 — MEDIUM: performance, parity, UX correctness

**R-8 (M-1) — Wrap RLS `auth.uid()`/`is_admin()` in `(SELECT …)`.** *Effort M · Risk M (touches many policies).*
- **Approach:** One migration that `CREATE OR REPLACE`s policy predicates to the `(SELECT auth.uid())` / `(SELECT public.is_admin())` form. Mechanical; preserves logic. Re-run advisor.
- **Verify:** REG-RLS-INITPLAN-01 (count drops); SEC-RLS-01/02/03 still pass (no authz change).

**R-9 (M-2) — Consolidate multiple permissive policies.** *Effort M · Risk M.* Where a SELECT is fully covered by an ALL policy's USING, drop the redundant SELECT (or vice-versa) so each action has one permissive policy. Verify isolation tests unchanged. *Can be folded into R-8's migration.*

**R-10 (M-3) — Index the 14 unindexed FKs.** *Effort S · Risk L.* `CREATE INDEX CONCURRENTLY` (or plain in a migration) on each FK column the advisor lists. Re-run advisor. Low risk, clear win for joins + cascade deletes.

**R-11 (M-4) — Rebuild-from-zero parity.** *Effort M · Risk L.* Run `supabase db pull --schema public` once against production to produce a consolidated baseline, replace the 10 stub migrations with it, keep the post-2026-05-15 migrations layered on top. Verify a fresh `supabase preview` boots the full schema. (Coordinate so the registry stays 1-to-1 — REG-MIG-01.)

**R-12 (M-5) — Persist workout media/substitution context after Start.** *Effort S · Risk L.*
- **Approach:** Have `renderClientProgram` stash `host._workouts` and the resolved `libMap` (and the `_substitutedFrom`/`_substituteResponse` markers) on the program host; `mountWorkouts`/`_renderTrackerSlot` re-render path should reuse them instead of falling back to `[workout]` with no `libMap`.
- **Verify:** REG-WORKOUT-MEDIA-01.

**R-13 (M-6) — Rate-limit `visitor_inquiries` anon insert.** *Effort S · Risk L.* Add captcha/turnstile or an edge rate-limiter in front of the public form; optionally narrow the `WITH CHECK`. Verify SEC-VISITOR-01.

**R-14 (M-7) — Make auth fail-closed (or explicit).** *Effort S · Risk M.* Decide policy: if `SubscriptionService` is missing, treat clients as **view-only** rather than active, OR hard-require the service to be loaded before the gate runs. Verify U-AUTH-02.

---

## Phase 4 — LOW: hygiene

| # | Finding | Action | Effort |
|---|---|---|---|
| R-15 | L-1 | Set `search_path` on `rpm_touch_updated_at`. | S |
| R-16 | L-2 | Enable GoTrue leaked-password protection. | S |
| R-17 | L-3 | Re-confirm anon `is_*()` execute is intentional (required by RLS); leave or scope. | S |
| R-18 | L-4 | Add `dist/` to `.gitignore` (confirm) and delete stale local copies, or wire a real build step. | S |
| R-19 | L-5 | Resolve `coach_id` server-side when a coach starts a session on a client's behalf. | S |
| R-20 | L-6 | Collapse duplicate expiry logic — keep DB `check_subscription_expiry()` as source; have `subscription-checker` call it + add email idempotency. | M |
| R-21 | L-7 | Replace `rpm/graph-viewer.js` localStorage view-state with in-memory or DB, per the single-source principle. | S |
| R-22 | L-8 | Normalize `?v=` cache-busters (single build version). | S |
| R-23 | L-9 | Deduplicate `is_admin_or_coach` / `is_coach_or_admin` to one helper. | S |

---

## Sequencing summary

```
Phase 0  VERIFY (V-1..V-3)                      ← no code
Phase 1  C-1 R-1 · C-2 R-2 · H-4 R-3 · H-1 R-4  ← CRITICAL, gate on SEC-EDGE-*/SEC-SIGNUP-01
Phase 2  H-3 R-5 · CORS R-6 · H-2 R-7           ← HIGH, gate on REG-SUB-01/SEC-RLS-02
Phase 3  M-1 R-8 · M-2 R-9 · M-3 R-10 · M-4 R-11 · M-5 R-12 · M-6 R-13 · M-7 R-14
Phase 4  LOW R-15..R-23
```

**Commit discipline (proposed):** one commit per R-item (or per function for R-1..R3); apply DB changes via `apply_migration` then write the registry-matched migration file (preserve 30↔30 alignment); verify the cited TEST_MATRIX cases live before moving on; do not bundle phases.

**Do-not-start gate for new features:** Phase 1 complete + green (SEC-EDGE-01/02/03, SEC-SIGNUP-01) and Phase 2 H-2 resolved. Until then the edge tier re-opens the tenant-compromise class the C2 fix closed.

---

*Plan only. No code, schema, data, migrations, or edge functions were modified in producing this document. Implementation awaits explicit approval and a chosen phase.*
