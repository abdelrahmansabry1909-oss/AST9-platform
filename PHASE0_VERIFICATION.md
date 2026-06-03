# Phase 0 — Verification Report (read-only, no fixes)

**Objective:** Conclusively confirm or refute the Critical/High edge-function & signup findings with live evidence before any remediation.
**Method:** Live probes against `https://byquokhcbagofshsclfy.supabase.co` using only the **public anon key** (shipped in `js/supabaseClient.js`). All edge-function probes used **deliberately incomplete / nonexistent inputs** so each call fails at field-validation or row-not-found **after** the authorization check — proving invocability and the absence of an authz gate **without creating, deleting, or emailing anything.** No state was mutated. No fixes applied.

**Bottom line:** Every Critical/High finding is **CONFIRMED**, and two are **more severe than first reported**: `create-user` / `delete-user` are reachable with the **public anon key alone** (effectively unauthenticated), because `verify_jwt:true` accepts the anon key as a valid JWT and the function code performs no role check. Nothing is downgraded.

---

## Evidence log (raw)

```
GET /auth/v1/settings  (anon apikey)  → 200
  {"external":{...,"github":true,...,"email":true,...},
   "disable_signup":false,"mailer_autoconfirm":false,"saml_enabled":false}

POST /functions/v1/create-user   (no Authorization header)        → 401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}
POST /functions/v1/create-user   (Authorization: Bearer <ANON>, body {full_name,role:client})
                                                                  → 400 {"error":"email, password, full_name, and role are required"}
POST /functions/v1/delete-user   (Authorization: Bearer <ANON>, body {})
                                                                  → 400 {"error":"user_id is required"}
POST /functions/v1/send-email    (Authorization: Bearer <ANON>, body {type:phase_upgrade, client_id:<nil-uuid>})
                                                                  → 404 {"error":"Client not found"}
```

The `400`/`404` (not `401`) on the anon-bearer calls is the proof: the request passed the platform `verify_jwt` gate **and** the function's `if (!authHeader)` check, instantiated the **service-role** client, and reached validation/DB logic — i.e. **no role-based authorization exists** anywhere in these functions.

---

## Q1 — Can a normal client invoke `create-user`?  ✅ CONFIRMED (worse: anon-level)

- **Evidence:** Anon-key bearer reached field-validation (`HTTP 400 "…required"`). With *no* header → `401`. So the **only** gate is "a valid JWT is present"; the public anon key satisfies it. A logged-in client's token trivially satisfies it too.
- **Reproduction path:** `POST /functions/v1/create-user` with `apikey:<anon>` + `Authorization: Bearer <anon-or-any-user-jwt>` and a complete body.
- **Actual risk:** Any browser visitor (anon key is public) can invoke the service-role user-creation function.
- **Confidence:** **Conclusive (High).** Live 400 + deployed source (`create-user/index.ts` has only `if (!authHeader)`).

## Q2 — Can a normal client create an **admin** account?  ✅ CONFIRMED

- **Evidence:** (a) Q1 proves there is no authz gate before account creation; (b) deployed source passes the caller-supplied `role` straight into `auth.admin.createUser({user_metadata:{role}})` **and** `profiles.upsert({role})` with **no validation/whitelist**; (c) the `handle_new_user` trigger also stamps `role` from `user_metadata`. Nothing restricts `role` to `client`.
- **Reproduction path:** the Q1 call with body `{"email":"attacker@x.com","password":"…","full_name":"x","role":"admin","assigned_coach":null}` → returns `200` with an **admin** profile.
- **Actual risk:** Full tenant compromise (anyone → admin). This re-opens, one layer above RLS, the exact escalation the signed-off **C2** fix closed.
- **Confidence:** **High.** The mutating final step was **deliberately not executed** (it would create a real admin account); confirmation rests on the proven absence of authz + unrestricted `role` passthrough in source.

## Q3 — Can a normal client invoke `delete-user`?  ✅ CONFIRMED (worse: anon-level)

- **Evidence:** Anon-key bearer + empty body → `HTTP 400 "user_id is required"` (reached validation past the absent authz). Source then calls `auth.admin.deleteUser(user_id)` with the service role.
- **Reproduction path:** same call with `{"user_id":"<any account id>"}` → deletes that account.
- **Actual risk:** Anyone can delete any account (admin, coaches, clients) → data loss / DoS / takeover (delete admin, recreate via Q2).
- **Confidence:** **Conclusive (High).** Live 400 + source. Mutating step not executed.

## Q4 — Is anonymous signup enabled?  ✅ CONFIRMED ENABLED

- **Evidence:** `GET /auth/v1/settings` → `disable_signup:false`, `email:true`, `external.github:true`, `mailer_autoconfirm:false`.
- **Reproduction path:** `POST /auth/v1/signup` (anon apikey) is open for email + GitHub OAuth. (Not executed — would create a user.)
- **Actual risk:** Public registration is open. Email signups require email confirmation (`mailer_autoconfirm:false`) before a session is issued — but an attacker controls their own inbox, so this is not a barrier. GitHub OAuth users are provider-confirmed.
- **Confidence:** **Conclusive (High)** — direct live config read.

## Q5 — Can `raw_user_meta_data.role` set the stored profile role at signup?  ✅ CONFIRMED (by code + config)

- **Evidence:** `handle_new_user()` (live DB definition): `role := coalesce(raw_user_meta_data->>'role','client')`, inserted into `public.profiles` on every `auth.users` insert. GoTrue maps the signup `data` object into `raw_user_meta_data`. Q4 confirms signup is open.
- **Reproduction path:** `POST /auth/v1/signup` with `{"email","password","data":{"role":"admin"}}` → trigger writes `profiles.role='admin'`; after the attacker confirms their own email and logs in, `is_admin()` is true for them.
- **Actual risk:** Anonymous self-provisioning to admin (independent of the create-user hole). This is **finding H-1** and is **practically exploitable**.
- **Confidence:** **High.** Conclusive from the trigger source + open-signup config. A live signup was **deliberately withheld** (it creates a real admin-roled account).

## Q6 — Intended actors (design intent, from UI role-gating + call sites)

Grounded in `app.html` nav/section gating and `clients.js`/`subscriptions.js`/`dashboard.js` call sites:

| Capability | Intended actor(s) | Evidence |
|---|---|---|
| **Create user — client** | Coach (own client; `assigned_coach` required) + Admin | `submitAddClient` role:`client`; "+ Add Client" in `#section-clients` (`role-coach-admin`) |
| **Create user — coach** | **Admin only** | `submitAddCoach` role:`coach`; "+ Add Coach" in `#section-coaches` (`role-admin-only`) |
| **Create user — admin** | **No one via the app** (out-of-band only) | No UI path sets role:`admin` |
| **Delete user** | **Admin only** | `removeCoach`→`delete-user` lives in `#section-coaches` (`role-admin-only`) |
| **Send email** | Coach + Admin (+ system cron) | `phase_upgrade` from coach/admin phase-upgrade; `subscription_activated` from coach/admin; `subscription-checker` cron |
| **Manage subscriptions** | Coach (own clients) + Admin | `#section-subscriptions` (`role-coach-admin`); renew via `reactivate_subscription` RPC (admin/assigned-coach) |

- **Confidence:** **High** for client/coach/delete/subscriptions (explicit role classes); **High** for "admin role never created via app" (no such code path).
- **Gap vs. reality:** Every one of these is currently callable by **anyone with the public anon key**, with **no** role enforcement — the widest possible deviation from intent.

---

## Severity disposition (per instruction)

| ID | Finding | Pre-Phase-0 | Post-Phase-0 | Reproducible? |
|---|---|---|---|---|
| **C-1** | `create-user` unauthorized → create admin | 🔴 Critical | 🔴 **Critical (escalated: anon-key/unauthenticated)** | Yes — live 400 proof; full exploit withheld |
| **C-2** | `delete-user` unauthorized → delete anyone | 🔴 Critical | 🔴 **Critical (escalated: anon-key/unauthenticated)** | Yes — live 400 proof; full exploit withheld |
| **H-1** | Signup trusts `metadata.role` → self-admin | 🟠 High (VERIFY) | 🟠 **High → treat as Critical** (signup confirmed open) | Yes — config live; signup withheld |
| **H-4** | `send-email` unauthorized + unescaped HTML | 🟠 High | 🟠 **High (escalated: anon-key)** | Yes — live 404 proof (reached service-role read) |

**Nothing downgraded.** Two findings escalated from "any authenticated user" to "anyone with the public anon key (effectively unauthenticated)" because `verify_jwt:true` accepts the public anon JWT and the functions perform no role check. H-1 is confirmed practically exploitable now that open signup is verified.

**Root cause (single):** the edge-function tier treats *presence of any valid JWT* as authorization. The public anon key is a valid JWT. Authorization (caller role + allowed target role) must be enforced **inside** each function (and `handle_new_user` must stop trusting client-supplied `role`).

---

*Read-only verification complete. No accounts created/deleted, no emails sent, no signups performed, no code/schema/data/migrations/edge functions modified. Stopping here as instructed — awaiting approval to begin Phase 1 remediation (R-1…R-4).*
