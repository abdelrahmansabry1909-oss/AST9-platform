# Edge Function Finalization — Pre-Implementation Spec

**Mode:** Security Stabilization — Edge Function Finalization. **No code yet — awaiting approval.**
No new features, no UI, no schema changes except the one strictly required for auth enforcement (`handle_new_user`). Builds on `EDGE_FUNCTION_SECURITY_MODEL.md`, `EDGE_FUNCTION_REWRITE_PLAN.md`, `PHASE0_VERIFICATION.md`.

This document is the five required outputs:
1. Final security model (architecture) · 2. Function-by-function security table · 3. Drift resolution plan · 4. Execution order · 5. Risk checklist.

---

## 1. Final Edge Function Security Model (architecture)

**Axiom:** `verify_jwt:true` proves a *valid token is present* — and the **public anon key is a valid token**. It is **not** authorization. Authorization is decided **inside** the function from the **caller's DB role**, never from token presence or client-supplied metadata.

**Two shared primitives** live in a new `supabase/functions/_shared/auth.ts` (imported by every function — the single source of the guard):

```ts
// USER-BEARING functions (admin/coach/client contexts)
export async function requireRole(req, allowed: Role[]): Promise<{ user, role }> {
  const jwt = bearer(req);                       // strip "Bearer "
  if (!jwt) throw new HttpError(401, 'Missing authorization');
  const userClient = createClient(URL, ANON, {   // identity = caller's token
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) throw new HttpError(401, 'Not authenticated');   // anon key → no user → rejected
  const { data: role } = await userClient.rpc('get_my_role'); // role from DB, not metadata
  if (!allowed.includes(role)) throw new HttpError(403, 'Forbidden');
  return { user, role };
}

// SYSTEM/cron context (no user). 'system' is NOT a profiles.role — it is this gate.
export function requireCron(req): void {
  const got = req.headers.get('x-cron-secret');
  if (!got || got !== Deno.env.get('CRON_SECRET')) throw new HttpError(401, 'Forbidden');
}

export function corsHeaders(origin): {...}   // app-origin allow-list, not '*'
export function escapeHtml(s): string        // for any echoed string
export function rateLimit(key, max, windowMs): boolean   // per-user/IP in-memory window
```

**Roles:** `admin`, `coach`, `client` (from `profiles.role` via the existing `get_my_role()` SECURITY DEFINER RPC); `system` = the cron-secret context (no DB role).

**Service-role containment (key principle):** the `SERVICE_ROLE_KEY` client is constructed **only after** `requireRole`/`requireCron` passes, used **only** for the one privileged op, and given **only** parameters validated against the caller's authority. **Public-safe functions must never hold the service role.** Staff functions that only read RLS-readable data should use the **caller-scoped** client and skip service role entirely.

**Centralized role-granting:** elevation to `coach`/`admin` happens **only** through the authorized `create-user`. `handle_new_user` must force `role='client'` so open signup cannot self-elevate (Phase 0 Q4/Q5).

**Transport hardening:** CORS restricted to app origin(s) on all privileged functions; caller-supplied HTML escaped; AI endpoints rate-limited and input-capped; cron not browser-reachable.

---

## 2. Function-by-function security table

| Function | Allowed roles | Execution context | Service-role usage |
|---|---|---|---|
| `create-user` | **admin** (any non-admin role); **coach** → `client` only, `assigned_coach` pinned to self; `admin` role never grantable | Browser (staff) | **Yes** — required for `auth.admin.createUser`, after authz + payload validation |
| `delete-user` | **admin** only (block self-delete; recommend block last-admin) | Browser (admin) | **Yes** — required for `auth.admin.deleteUser`, after authz |
| `send-email` | **admin** (any client) · **coach** (own assigned clients only) | Browser (staff) | **No** — caller-scoped client reads the profile (RLS-permitted); Resend key from env. Drops service role. |
| `generate-program` | **coach · admin** | Browser (staff) | **No** — only calls Gemini with env key; no DB |
| `rpm-ai-suggest` | **coach · admin** | Browser (staff) | **No** — exercise-library read is RLS-readable via caller-scoped/anon client |
| `subscription-checker` | **system** (cron secret) | Cron / scheduler | **Yes** — bulk expire + cross-client read, by design; never browser-reachable |
| `visitor-survey` | **public** (anonymous) | Public landing | **No** — anon insert into `visitor_inquiries` (table already allows anon insert); public functions hold no service role |

> Net: only the two account-management functions and the cron retain the service role. `send-email`, `generate-program`, `rpm-ai-suggest`, `visitor-survey` are de-privileged.

---

## 3. Drift resolution plan (single source of truth)

**Source of truth = the repository** (`supabase/functions/`). Deploy exclusively via `supabase functions deploy <slug>` from repo. No out-of-band edits to deployed functions, ever.

Steps:
1. **Adopt** the 5 currently-deployed functions into the repo as their **hardened** versions (not the current insecure source).
2. **Reconcile repo-only functions:** deploy `visitor-survey` (the public survey in `js/visitor.js` 404s without it); for `rpm-ai-suggest`, **deploy** (if RPM AI suggest is intended live) or **remove the client call** in `js/rpm/graph-builder.js` to kill the dead 404 path — decision required.
3. **Record** each function's post-deploy `ezbr_sha256`; assert `list_edge_functions` set == `supabase/functions/*` set.
4. **Verify** no client reference points at an undeployed slug.

End state: deployed set ≡ repo set, all hardened, all versioned/reviewable.

---

## 4. Execution order (deterministic, one function per commit)

```
S0  _shared/auth.ts  (requireRole + requireCron + cors + escapeHtml + rateLimit)   [commit; no deploy effect alone]
S1  create-user   → admin (+coach→client, role whitelist, assigned_coach pin)      [commit+deploy] gate SEC-EDGE-01
S2  handle_new_user migration → force role='client'                                 [commit+apply]  gate SEC-SIGNUP-01
S3  delete-user   → admin only (+ self/last-admin guard)                            [commit+deploy] gate SEC-EDGE-02
S4  send-email    → staff + coach-scope + escape + drop service role                [commit+deploy] gate SEC-EDGE-03
S5  generate-program → staff + rate-limit + prompt cap                              [commit+deploy] gate AI authz/rate
S6  CRON_SECRET set in project secrets + scheduled job                              [config]
S7  subscription-checker → requireCron, verify_jwt=false, idempotent emails         [commit+deploy] gate cron-secret
S8  rpm-ai-suggest → staff + rate-limit; deploy-or-delete decision                  [commit+deploy/remove]
S9  visitor-survey → deploy + CORS tighten                                          [commit+deploy]
S10 Final reconciliation: repo==deployed (sha recorded); CORS tightened everywhere  [verify] gate SEC-CORS-01
```

Rationale: shared guard first (foundation); the two anon-level account hijacks (S1, S3) earliest; `handle_new_user` paired with `create-user` so role-granting is centralized and the signup vector closes together; `CRON_SECRET` provisioned **before** S7 flips the gate (so the cron doesn't break).

**Per-function procedure (strict, no batching):** (1) patch → (2) local test with mocked auth + role → (3) safe live verification (anon→401, wrong-role→403, right-role→200, using non-mutating inputs where possible) → (4) separate commit. One security change per commit.

---

## 5. Risk checklist (must pass before each deploy)

Per function:
- [ ] Anon-key call (no user) → **401** (`getUser()` returns null).
- [ ] Authenticated wrong-role → **403**.
- [ ] Correct role → **200** (happy path intact).
- [ ] Role read from **DB** (`get_my_role`), never from JWT claims or `user_metadata`.
- [ ] Service-role client constructed **only after** authz; absent entirely where table marked "No".
- [ ] Caller-supplied privileged params validated: `create-user` role whitelist (no `admin`) + coach `assigned_coach` pin; `send-email` `client_id` scoped to coach; `delete-user` self/last-admin guard.
- [ ] CORS origin restricted (no `*` on privileged functions).
- [ ] Any echoed string HTML-escaped (`send-email.message`).
- [ ] AI functions rate-limited + input-capped.

System/cron:
- [ ] `subscription-checker` rejects without `x-cron-secret`; not browser-reachable; emails idempotent.

Global / drift:
- [ ] `handle_new_user` forces `client`; signup cannot set role (SEC-SIGNUP-01).
- [ ] `list_edge_functions` set == repo `supabase/functions/*`; no client call to an undeployed slug.
- [ ] Existing happy-paths still pass: `clients.js` admin add-client/add-coach, **coach** add-client, `dashboard.js` phase-upgrade email, `subscriptions.js` activation email.
- [ ] `CRON_SECRET` present in project secrets + scheduled job before S7.

---

## Decision required before implementation

**Coach client-creation:** keep the **coach → create `client`** path (server-validated: `role` forced to `client`, `assigned_coach` pinned to the caller)? The current product lets coaches add their own clients (`#section-clients` is `role-coach-admin`), so **removing it would break the coach workflow** — recommended to keep. Alternative: make all user creation **admin-only**. *(Affects only `create-user` in S1.)*

---

*Design only. No edge function, schema, data, or config modified. On approval I will execute S0→S10 one function per commit, verifying live (non-destructively) between each, and will not proceed to Feature 7 or any product work until all functions are secured, authZ is consistent, drift is resolved, and service-role access is contained.*
