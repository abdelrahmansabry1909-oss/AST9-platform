# NeuCore / AST9 — Production Readiness Audit (Read-Only)

**Date:** 2026-06-04
**Scope:** Full system — frontend (`js/`, `src/`, `app.html`), edge functions, Supabase DB (RLS, RPCs, triggers, cron, Vault), migrations, auth/subscription/coach/notification/workout flows.
**Mode:** READ-ONLY. No code, schema, data, migration, deployment, or remediation changes were made. All claims below are backed by live evidence gathered against project `byquokhcbagofshsclfy` and the deployed edge environment.
**HEAD:** `6af242f` · branch `claude/interesting-buck-452459`

---

## 0. Method & evidence base

This was run skeptically — every prior fix was re-checked against the **live** database/deployment, not assumed from commit history.

Evidence collected:
- **49 public tables** — all have RLS enabled; every table has ≥1 policy (no RLS-on/zero-policy gaps).
- **Live function source** pulled for `create-user` (deployed v3) and diffed against repo.
- **Live authz probes** against all 7 deployed functions (results in §2).
- **Function/trigger DDL** read live for `set_client_phase`, `enforce_profile_protected_columns`, `handle_new_user`, `tg_profile_phase_upgrade`, `notify`, `reactivate_subscription`, `check_subscription_expiry`, `verify_cron_secret`, `ensure_subscription_notifications`, `is_admin`, `get_my_role`.
- **EXECUTE grants** (`proacl`) enumerated for all SECURITY DEFINER functions.
- **Security + performance advisors** pulled fresh (223 perf lints, 19 security lints).
- **Migration registry** (33) vs **disk** (33) — aligned, latest `20260604064909`.

---

## 1. Prior security fixes — RE-VERIFIED EFFECTIVE (live)

| Fix | Mechanism (verified live) | Status |
|---|---|---|
| **C2** profiles privilege escalation | `tg_profiles_protect_columns` → `enforce_profile_protected_columns()`: blocks `role`/`assigned_coach` change unless `is_admin()`; blocks `current_phase` unless `neucore.allow_phase_change='on'`; service-role (auth.uid()=NULL) bypass only. | ✅ Effective |
| **C1** phase upgrade correctness | `set_client_phase()` SECURITY DEFINER: target must be client, caller must be admin OR assigned coach, phase must match `^Phase [1-9][0-9]*$`, no downgrade/same-phase; it is the *only* path that sets the `allow_phase_change` flag. UI (`dashboard.js:1067`) calls the RPC. | ✅ Effective |
| **H-1/S-2** signup role forgery | `handle_new_user()` hard-codes `role='client'`, ignores `raw_user_meta_data.role`; `on conflict do nothing`. No client-facing `signUp` exists in the app (`auth.js` only `signInWithPassword`). | ✅ Effective |
| **H-1/H-2** legacy RLS unification | subscriptions: admin-write only; coach/client reads scoped to `assigned_coach`/self. | ✅ Effective |
| **S1–S5/S8/S9** edge authz | `requireRole()` gates every privileged function before any service-role client is built. | ✅ Effective (probed, §2) |
| **S7** cron auth (Vault single-source) | `subscription-checker` v12 `verify_jwt=false` → `requireCron(req,sb)` → `verify_cron_secret()` RPC → Vault `cron_secret`; RPC granted to `service_role` only. pg_cron job 1 active, reads header from Vault. | ✅ Effective (probed, §2) |

**No prior fix has regressed.**

---

## 2. Live edge-function probes (deployed environment)

| Probe | Expected | Actual | Verdict |
|---|---|---|---|
| `create-user` w/ anon JWT | reject | **401 `Not authenticated`** | ✅ |
| `delete-user` w/ anon JWT | reject | **401 `Not authenticated`** | ✅ |
| `send-email` w/ anon JWT | reject | **401 `Not authenticated`** | ✅ |
| `generate-program` w/ anon JWT | reject | **401 `Not authenticated`** | ✅ |
| `rpm-ai-suggest` w/ anon JWT | reject | **401 `Not authenticated`** | ✅ |
| `create-user` no auth header | reject | **401 gateway** | ✅ |
| `subscription-checker` no `x-cron-secret` | reject | **401 `Forbidden`** | ✅ |
| `subscription-checker` wrong `x-cron-secret` | reject | **401 `Forbidden`** | ✅ |
| `visitor-survey` invalid email | 400, no insert | **400 `Invalid email`** | ✅ |

The core principle ("the public anon key is a valid JWT, so `verify_jwt:true` ≠ authorization") is correctly defended: the anon key reaches the function and is rejected by `requireRole`.

---

## 3. Findings

### CRITICAL — none
No critical security or data-integrity defects. All prior Criticals remain closed and verified live.

### HIGH

**H-1 · Subscription write-gate is enforced only in client JS (not at the DB).**
`SubscriptionService.canWrite()` (subscriptionService.js) is the only thing stopping an expired/lapsed client from writing. A policy scan found **no RLS policy on any writable table references subscription/grace/expiry state**. Login is likewise gated only in `auth.js`. Since the Supabase Auth endpoint issues a token regardless of subscription, a lapsed client with a still-valid JWT (or a direct `signInWithPassword` + REST call) can continue writing **their own** workout/progress data, bypassing the paywall.
- *Impact:* monetization/business-rule bypass. **Not** a confidentiality/integrity breach (own-data only).
- *Note:* the module's own header comment claims "expired → view only, login blocked" — that guarantee does not exist at the data layer.
- *Fix direction:* enforce the gate server-side — e.g. RLS `WITH CHECK` (or a BEFORE trigger) on `workout_logs`/`workout_sessions`/`progress_logs`/`daily_routine_logs` that consults `v_client_subscription_state.effective_status IN ('active','grace')` for the writing client.

**H-2 · Coach Subscriptions UI exposes admin-only write actions → silent false-success on delete.**
`app.html:169` marks the Subscriptions nav `role-coach-admin`, so **coaches see Create / Activate / Delete**. RLS allows subscription writes to **admins only** (`subscriptions_admin_write = is_admin()`). Create/Activate surface the RLS error (confusing but visible). But `Subscriptions.remove()` (subscriptions.js:254) issues `delete().eq('id',…)` with **no error check**; under RLS a coach's delete matches 0 rows and returns no error, so the UI **falsely toasts "Subscription deleted"** while the row persists.
- *Impact:* coach-facing core-workflow correctness + misleading success state. **Not** a security hole (RLS correctly blocks the write).
- *Fix direction:* either gate the Create/Activate/Delete controls to admins, or route them through SECURITY DEFINER RPCs that authorize assigned coaches (mirroring `reactivate_subscription`); and check the `delete()` result before toasting.

### MEDIUM

**M-1 · `notify()` trusts caller-supplied `p_actor_id` → cross-user notification injection.**
`notify()` (granted to `authenticated`) computes `v_actor := COALESCE(p_actor_id, auth.uid())` and authorizes on that value. Branch `v_actor = p_recipient_id` means any authenticated caller who sets `p_actor_id = p_recipient_id = <victim uuid>` can insert an arbitrary notification (title/body/type/severity/link) into **any** user's inbox, with a spoofable `actor_id`. `notifications` blocks all direct INSERT (`WITH CHECK false`), so `notify()` is the sole write path — and the hole.
- *Mitigating:* the inbox renderer **HTML-escapes** title/body (no stored XSS), `actor_id` is not displayed, and clients cannot enumerate other users' UUIDs via `profiles` RLS — so practical blast radius is limited to known UUIDs.
- *Fix direction:* require `v_actor = auth.uid() OR is_admin()`, and derive the recipient-relationship check from `auth.uid()` rather than `p_actor_id`.

**M-2 · `visitor_inquiries` open anon INSERT.**
Policy `visitor_inquiries_anon_insert` is `WITH CHECK (true)` and `visitor-survey` now writes with the public anon key — so anyone with the (public) anon key can insert rows directly, bypassing the edge function's validation + IP rate-limit. Spam/storage-growth vector. *Fix:* keep the public funnel but constrain (e.g., require insert via the function path / add a server-side throttle / captcha).

**M-3 · Edge CORS not unified / S10 not applied.**
`rpm-ai-suggest` and `visitor-survey` hardcode `Access-Control-Allow-Origin: *` and bypass the shared `ALLOWED_ORIGINS` allowlist; the other functions use the shared `corsHeaders` but `ALLOWED_ORIGINS` is unset so they currently echo `*` too. Low real risk for token-based auth (no credentialed CORS), but should be unified in the deferred **S10** pass.

**M-4 · RLS performance at scale.** Advisors: **45** `auth_rls_initplan` (un-wrapped `auth.uid()` re-evaluated per row) + **91** `multiple_permissive_policies`. Correctness-neutral; will degrade query latency as data grows. Pre-existing.

**M-5 · Auth: leaked-password protection disabled.** HaveIBeenPwned check is off in Auth config. Enable for credential hygiene.

### LOW

- **L-1 · Edge shared-code drift.** 6 of 7 deployed functions bundle a *stale, pre-S7* `_shared/auth.ts` (old env-based `requireCron`+`timingSafeEqual`). **Security-neutral** — `requireRole`/`corsHeaders`/`json`/`escapeHtml` are byte-identical and these functions never call `requireCron` — but they should be redeployed so the deployed bundles converge on the repo single-source.
- **L-2 · Index hygiene.** 14 unindexed FKs + 73 unused indexes (advisor INFO).
- **L-3 · `rpm_touch_updated_at` mutable `search_path`** (advisor 0011) — set `search_path=public`.
- **L-4 · Repo hygiene.** `deno.lock` and `supabase/.temp/` are untracked and not git-ignored.
- **L-5 · `visitor-survey` stale docstring** references `SUPABASE_SERVICE_ROLE_KEY`; it now uses the anon key (cosmetic).

---

## 4. Regression check (S0–S7)

**No regressions introduced.** The edge hardening was additive (`requireRole`/`requireCron` gates in front of existing logic); no RLS policy was loosened; `handle_new_user`, `set_client_phase`, and the profiles guard are intact and verified live. The only drift is L-1, which is benign. Migration registry↔disk is aligned (33↔33).

---

## 5. Production readiness verdict

| Dimension | Verdict |
|---|---|
| **Authentication / authorization** | ✅ Sound — verified live (§1, §2) |
| **RLS data isolation** | ✅ Sound — all tables RLS-on, policies scoped |
| **Edge function security** | ✅ Sound — all 7 probed |
| **Cron / secrets (Vault)** | ✅ Sound — single-source, gated |
| **Data confidentiality / integrity** | ✅ No cross-tenant or escalation paths found |
| **Monetization enforcement** | ⚠️ Gap — write-gate client-side only (H-1) |
| **Coach subscription UX** | ⚠️ Defect — silent false-success (H-2) |
| **Performance at scale** | ⚠️ Known tuning debt (M-4) |

**Security-wise: PRODUCTION-SAFE.** There are no Critical issues, no data-exposure paths, and no S0–S7 regressions.
**Commercially: not launch-ready until H-1 and H-2 are fixed** — the paywall is not DB-enforced and the coach subscription UI lies about deletions. These are isolated to the subscription module.

### Recommended fix order
1. **H-1** — DB-enforce the subscription write-gate (RLS/trigger). *(monetization integrity)*
2. **H-2** — gate/route coach subscription write actions + check `delete()` result. *(coach UX correctness)*
3. **M-1** — harden `notify()` against actor/recipient spoofing.
4. **M-2** — constrain `visitor_inquiries` anon insert.
5. **S10** (deferred) — unify CORS via `ALLOWED_ORIGINS`; redeploy to clear L-1 drift; git-ignore `deno.lock`/`supabase/.temp` (L-4).
6. **M-4 / M-5 / L-2 / L-3** — RLS `initplan` wrap, enable leaked-password protection, index cleanup, search_path.

---

## 6. Feature 7 verdict

# ✅ SAFE TO START FEATURE 7

**Evidence supporting the decision:**
- The auth/RLS/edge/cron foundation Feature 7 (Assessment / 3D Hologram) builds on is **verified sound and live** — zero Criticals, zero S0–S7 regressions.
- The edge-function gating condition the team set ("don't start Feature 7 until the edge layer is locked down") is **met**: S0–S9 + the S7 Vault single-source are complete and probed; only the non-blocking S10 CORS-hardening pass remains.
- The two open **High** items (H-1, H-2) are confined to the **subscription module** — orthogonal to the assessment/3D pipeline — so they do not block assessment development.

**Condition (not a blocker for dev, a blocker for paid launch):** H-1 and H-2 should be remediated as a parallel fast-follow before charging customers in production, since H-1 undermines the subscription paywall and H-2 misreports coach actions.
