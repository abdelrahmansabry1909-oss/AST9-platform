# Edge Function Security Model

**Phase 1 — design & classification only. No implementation.** Companion: **EDGE_FUNCTION_REWRITE_PLAN.md** (per-function fixes + actor mapping). Verification specs: **TEST_MATRIX.md** `SEC-EDGE-*`, `SEC-SIGNUP-*`, `SEC-CORS-*`. Evidence base: **PHASE0_VERIFICATION.md** (live-confirmed) + full source of all 7 functions.

---

## 1. Core principle (the root cause to design around)

> **`verify_jwt: true` is authentication of *a* token, not authorization of *the caller*.**

The project's **public anon key** (shipped in `js/supabaseClient.js` to every browser) is a *valid* JWT. So `verify_jwt:true` admits anonymous traffic. Every deployed function then performs only `if (!authHeader) 401` and proceeds with the **service-role key**, which **bypasses RLS entirely**. Phase 0 confirmed live (HTTP 400/404 on anon-key calls) that `create-user`, `delete-user`, `send-email`, `generate-program` all reach their privileged code path with nothing but the public anon key.

**Design rule:** authorization must be enforced **inside the function body**, by resolving the *caller's identity and role* from their token — never by the mere presence of a token. The service-role client may be constructed **only after** authorization passes, and may act **only** on parameters validated against the caller's authority.

Secondary root cause: `handle_new_user` trusts `raw_user_meta_data->>'role'`, and self-signup is open (Phase 0 Q4). Role-granting must be centralized in `create-user` (authorized) and the trigger must force `role='client'`.

---

## 2. Trust classes

| Class | Definition | Auth requirement | Service role? | CORS |
|---|---|---|---|---|
| **public-safe** | No privileged data exposure; safe for anonymous callers. | None (no JWT). | Only for a narrow, validated write (e.g. insert one inquiry). | App origin (may be broad if truly public). |
| **staff-only** | Acts on coach/admin workflows; may touch client data or paid APIs. | Real user **and** `role ∈ {coach, admin}`; coach scoped to own clients. | After authz; only for the specific op. | App origin allow-list. |
| **admin-only** | Creates/destroys accounts or other tenant-wide effects. | Real user **and** `role = admin` (with narrow, explicit coach exceptions). | After authz; parameters validated against caller authority. | App origin allow-list. |
| **internal / service-only** | Scheduled/automation; never called by a browser. | Shared **cron secret** header (and/or service-role bearer); no user context. | Yes, by definition. | None (not browser-reachable). |

---

## 3. Classification of every function

| Function | Deployed | In repo | Privileged effect | Current authz | **Target class** | **Allowed actor (intent)** |
|---|---|---|---|---|---|---|
| `create-user` | ✅ | ❌ | service-role: create auth user + profile, **any role** | none (anon passes) | **admin-only** (coach exception) | Admin → any non-admin role; **Coach → role=`client` only, `assigned_coach=self`**; never `role=admin` |
| `delete-user` | ✅ | ❌ | service-role: delete auth user | none | **admin-only** | Admin only |
| `send-email` | ✅ | ❌ | service-role: read any profile + send email; `message` unescaped | none | **staff-only** | Admin (any client) · Coach (own clients) · system |
| `generate-program` | ✅ | ❌ | Gemini call on project key (cost) | none | **staff-only** (rate-limited) | Coach · Admin |
| `subscription-checker` | ✅ | ❌ | service-role: bulk expire subs + email | none (ignores request) | **internal/cron** | Scheduler only |
| `rpm-ai-suggest` | ❌ (repo only) | ✅ | service-role: read `exercises`; Anthropic call (cost) | relies on verify_jwt | **staff-only** (rate-limited) | Coach · Admin |
| `visitor-survey` | ❌ (repo only) | ✅ | service-role: insert `visitor_inquiries` + email | **none by design** (`--no-verify-jwt`) | **public-safe** | Anonymous (public landing) |

**Risk-confirmed today:** `create-user` (**C-1**), `delete-user` (**C-2**), `send-email` (**H-4**), `generate-program` (**H-5, new** — open LLM proxy / cost abuse) are exploitable at **anon-key level**. `rpm-ai-suggest` would share the staff-only gap **if deployed** (currently inert). `visitor-survey` is the correctly-built reference (validation + rate-limit + escaping) — but is also undeployed.

**Drift (D-1):** bidirectional. The 5 deployed functions have **no repo source** (unversioned, unreviewed — incl. service-role user management). The 2 repo functions are **not deployed**, yet the client calls them (`js/visitor.js` → `visitor-survey`, `js/rpm/graph-builder.js` → `rpm-ai-suggest`) → those calls **404 at runtime** (public survey broken; RPM suggest falls back to client defaults). The repo cannot rebuild or review the live edge tier.

---

## 4. The authorization standard (pattern every privileged function must adopt)

Conceptual shared helper (design pseudocode — not yet implemented):

```ts
// Resolve and authorize the CALLER (not just the token).
async function requireRole(req, allowed /* e.g. ['admin'] | ['coach','admin'] */) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, 'Missing authorization');

  // User-scoped client: identity comes from the caller's token.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) throw new HttpError(401, 'Not authenticated');   // ← anon key yields NO user → rejected here

  const { data: me } = await userClient.from('profiles').select('role').eq('id', user.id).single();
  const role = me?.role ?? 'client';
  if (!allowed.includes(role)) throw new HttpError(403, 'Forbidden');

  return { user, role };                                      // service-role client built ONLY after this returns
}
```

Why this closes the hole: `auth.getUser()` on the **anon key** returns **no user** (the anon JWT has no `sub`), so anonymous callers are rejected at step "Not authenticated" — before any service-role action. A real coach/client token resolves to a user whose `role` is then checked.

**Service-role rule:** instantiate the `SERVICE_ROLE_KEY` client **only after** `requireRole` succeeds, and pass it **only** parameters the caller is authorized for (e.g. `create-user` must reject `role='admin'`, and force `assigned_coach=caller.id` when the caller is a coach).

**CORS rule:** privileged functions set `Access-Control-Allow-Origin` to the known app origin(s), not `*`.

**Cron rule:** internal functions take no user input for authorization; require `x-cron-secret === Deno.env.get('CRON_SECRET')` (set on the scheduled job), reject otherwise, and prefer delegating the actual work to a DB function (dedupe with `check_subscription_expiry()`).

**Output rule:** any caller-supplied string interpolated into HTML/email must be escaped (the `visitor-survey` `escapeHtml` is the model; `send-email` currently violates this for `message`).

---

## 5. Per-class requirements summary

- **public-safe (`visitor-survey`):** keep validation + rate-limit + escaping; tighten CORS to the marketing origin; service role used only for the single `visitor_inquiries` insert; **must be deployed** (`--no-verify-jwt`) for the public flow to work.
- **staff-only (`send-email`, `generate-program`, `rpm-ai-suggest`):** `requireRole(['coach','admin'])`; coach scoped to own clients when a `client_id` is supplied; rate-limit the AI callers (per-user) and cap input size; escape any echoed HTML.
- **admin-only (`create-user`, `delete-user`):** `requireRole(['admin'])` (plus the documented coach→client-create exception for `create-user`); `create-user` must whitelist grantable roles (never `admin`) and pin `assigned_coach` for coach callers; `delete-user` must block self-delete and (recommended) last-admin-delete, and confirm `profiles` cascades on auth-user delete.
- **internal/cron (`subscription-checker`):** cron-secret gate; not browser-reachable; idempotent emails; logic consolidated with the DB expiry function.

---

## 6. Coordinated DB change (in-scope for this phase's correctness)

`handle_new_user` must **ignore client-supplied `role`** and always insert `role='client'`. This makes `create-user` (post-fix) the **only** path that can grant `coach`/`admin`, and that path is authorized. Without this, the open-signup vector (Phase 0 Q4/Q5, finding **H-1**) bypasses the entire edge-function model.

---

*Design only. No function, schema, or config was modified. Proceed to EDGE_FUNCTION_REWRITE_PLAN.md for the per-function fix specification and actor-mapping table; implementation awaits explicit approval.*
