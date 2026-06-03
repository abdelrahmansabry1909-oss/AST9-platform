# Edge Function Rewrite Plan

**Phase 1 — design only. No implementation, no redeploy, no Feature 7, no product work.** Builds on **EDGE_FUNCTION_SECURITY_MODEL.md**. Verification gates reference **TEST_MATRIX.md**. Each item is independently shippable and independently verifiable; proposed as one commit per function (+ one for the `handle_new_user` coordination + one for drift alignment).

---

## 1. Mapping table — function → allowed actor → required fix

| Function | Allowed actor (target) | Required fix |
|---|---|---|
| **create-user** | **Admin** → create `client`/`coach`; **Coach** → create `client` **only**, `assigned_coach` forced to self. **Never** create `admin`. | Add `requireRole(['admin','coach'])`; if caller=coach reject `role!=='client'` and override `assigned_coach=caller.id`; reject `role==='admin'` for everyone; validate inputs; restrict CORS; commit to repo + redeploy. *(Closes C-1.)* |
| **delete-user** | **Admin only** | Add `requireRole(['admin'])`; block self-delete; (recommended) block deleting the last admin; verify `profiles`/data cascade on auth-user delete; restrict CORS; commit + redeploy. *(Closes C-2.)* |
| **send-email** | **Admin** (any client) · **Coach** (assigned clients only) · **system** | Add `requireRole(['admin','coach'])`; if coach, assert target `client_id` is assigned to caller; HTML-escape `message`; whitelist `type`; restrict CORS; commit + redeploy. *(Closes H-4.)* |
| **generate-program** | **Coach · Admin** | Add `requireRole(['coach','admin'])`; per-user rate limit; cap `prompt` length; restrict CORS; commit + redeploy. *(Closes H-5.)* |
| **subscription-checker** | **Scheduler only (internal)** | Require `x-cron-secret === CRON_SECRET`; set `verify_jwt=false` + secret gate (not browser-reachable); make emails idempotent; delegate expiry to `check_subscription_expiry()` DB fn (dedupe L-6); commit + redeploy. |
| **rpm-ai-suggest** | **Coach · Admin** | Add `requireRole(['coach','admin'])` (currently relies on verify_jwt); keep clamps/fallback; per-user rate limit; **decide deploy-or-delete** (see §3); if kept, deploy + keep repo as source of truth. |
| **visitor-survey** | **Anonymous (public)** | Keep as-is (validation + rate-limit + escaping are correct); tighten CORS to marketing origin; **deploy** (`--no-verify-jwt`) so `js/visitor.js` works; repo already the source. |
| **`handle_new_user` (DB trigger — coordinated)** | n/a | Force `role='client'`; ignore `raw_user_meta_data->>'role'` so `create-user` is the only role-granting path. *(Closes H-1.)* |

---

## 2. Per-function rewrite spec

### create-user *(admin-only + coach→client exception)* — closes C-1
- **Add:** `const { user, role } = await requireRole(req, ['admin','coach'])`.
- **Authorize the payload, not just the caller:**
  - `if (role === 'coach')`: force `body.role = 'client'` (reject otherwise) and force `assigned_coach = user.id` (ignore client-supplied value).
  - `if (body.role === 'admin')`: reject `403` for all callers (admins are provisioned out-of-band).
  - `if (role === 'admin')`: may create `client` or `coach`; `assigned_coach` must reference a real coach (validate).
- **Then** instantiate service-role client and `admin.createUser` + profile upsert.
- **Unauthorized responses:** anon/client → `401`/`403` with no account created.
- **Verify:** `SEC-EDGE-01` (CLIENT→403, no account; anon→401); INT admin happy-path; coach-creates-client happy-path; `role:'admin'` always rejected.

### delete-user *(admin-only)* — closes C-2
- **Add:** `requireRole(req, ['admin'])`.
- **Guards:** reject `user_id === caller.id` (self-delete); recommended reject if target is the last `admin`.
- **Verify:** `SEC-EDGE-02` (CLIENT→403; ADMIN→ok); self-delete blocked.

### send-email *(staff-only + scoped + escaped)* — closes H-4
- **Add:** `requireRole(req, ['admin','coach'])`.
- **Scope:** if coach, assert `EXISTS(profiles where id=client_id and assigned_coach=caller.id)` else `403`.
- **Harden:** `escapeHtml(message)`; whitelist `type ∈ {phase_upgrade, subscription_activated}`; restrict CORS.
- **Verify:** `SEC-EDGE-03` (client→403; coach cross-client→403; `message` escaped).

### generate-program *(staff-only + rate-limited)* — closes H-5
- **Add:** `requireRole(req, ['coach','admin'])`.
- **Harden:** per-user rate limit (in-memory window, like `visitor-survey`); cap `prompt` length (e.g. ≤ 8 KB); keep key server-side.
- **Verify:** client/anon→403; coach→200; oversized prompt→400; rapid calls→429.

### subscription-checker *(internal/cron)*
- **Change:** set `verify_jwt=false`; require header `x-cron-secret === Deno.env.get('CRON_SECRET')` else `401`; configure the scheduled job to send it.
- **Harden:** idempotent "expiring soon" email (track per-window, mirror `ensure_subscription_notifications`); reuse `check_subscription_expiry()` for the status flip.
- **Verify:** call without secret→401; scheduled call→runs; no duplicate emails within window.

### rpm-ai-suggest *(staff-only — deploy decision)*
- **Add:** `requireRole(req, ['coach','admin'])`; per-user rate limit. Keep the clamps + graceful fallback (already good).
- **Deploy decision (§3).**

### visitor-survey *(public-safe)*
- **Keep** validation/rate-limit/escaping. Tighten CORS. **Deploy** so the public survey functions.

### handle_new_user *(DB, coordinated with create-user)* — closes H-1
- `CREATE OR REPLACE` to insert `role='client'` unconditionally (drop the `raw_user_meta_data->>'role'` read). One migration; apply via MCP then write the registry-matched file. Re-verify `SEC-SIGNUP-01`.

---

## 3. Drift remediation (D-1) — make repo the source of truth

1. **Adopt deployed source into repo:** add `supabase/functions/{create-user,delete-user,send-email,generate-program,subscription-checker}/index.ts` containing the **hardened** versions above (not the current insecure ones).
2. **Resolve repo-only functions:** **deploy** `visitor-survey` (public flow depends on it) and decide `rpm-ai-suggest` (deploy if the RPM AI suggest UI is intended live; otherwise remove the client call in `js/rpm/graph-builder.js` to kill the 404 path).
3. **Going forward:** deploy only via `supabase functions deploy <slug>` from the repo; never edit a deployed function out-of-band. Record expected `ezbr_sha256` post-deploy.
4. **Verify:** `list_edge_functions` set == repo `supabase/functions/*` set; client function references all resolve to deployed slugs (no 404 paths).

---

## 4. Sequencing & gates

```
Step 1  create-user (R-1)      → gate SEC-EDGE-01      ┐ CRITICAL
Step 2  delete-user (R-2)      → gate SEC-EDGE-02      │  (one commit each;
Step 3  handle_new_user (R-4)  → gate SEC-SIGNUP-01    │   apply + verify live
Step 4  send-email (R-3)       → gate SEC-EDGE-03      ┘   before next)
Step 5  generate-program (H-5) → gate AI authz/rate tests
Step 6  subscription-checker   → gate cron-secret test
Step 7  rpm-ai-suggest + visitor-survey + drift align (D-1) → gate list==repo, no 404 paths
Step 8  CORS tighten across privileged fns → gate SEC-CORS-01
```

**Order rationale:** the two anon-level account hijacks (create/delete) first; `handle_new_user` immediately after `create-user` so role-granting is centralized and the signup vector closes together; then email, AI cost, cron, drift, CORS.

**Do-not-proceed gate (to any product/Feature-7 work):** Steps 1–4 implemented and green on `SEC-EDGE-01/02` + `SEC-SIGNUP-01`. Until then the edge tier remains an anon-level admin-takeover surface.

**Cross-impact to watch:**
- After R-1, `clients.js` admin "Add Client/Coach" and coach "Add Client" must still pass — keep request/response shape; coach-create must send `role:'client'` (it already does) and may omit/!trust `assigned_coach` (function will pin it).
- After R-3, `dashboard.js` phase-upgrade email and `subscriptions.js` activation email are coach/admin callers → unaffected; a client never calls them.
- `CRON_SECRET` must be added to project secrets + the scheduled job before R-6 flips the gate (avoid breaking the cron).

---

*Plan only. No edge functions, schema, data, or config were modified. Implementation, redeploy, and the `handle_new_user` migration await explicit approval. No Feature 7 or product work performed.*
