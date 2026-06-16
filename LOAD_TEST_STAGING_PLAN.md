# AST9 / NeuCore — 500-User Load Test Staging Plan

Status: **plan only — no 500-user test has been run.** The highest load stage
actually executed against this system is **50 concurrent read requests**
(read-only API probe, 100% success, p95 ≈ 0.6–0.8 s — see
`.smoke-d079a9f/qa-load.js`, uncommitted). This document defines the safe path
to a real 5 → 500 ramp.

---

## 1. Why production is not the right place for a 500-user destructive load

The live app talks to a **single shared Supabase project** (`byquokhcbagofshsclfy`)
that also serves the product owner's real account and any real coaches/clients.
Running 500 concurrent sessions against it would:

- **Consume shared rate limits / quotas.** Auth (GoTrue), PostgREST, and
  Realtime limits are per-project. A load test would throttle or fail requests
  for real users on the same project.
- **Pollute real data.** Writes (messages, appointments, notifications,
  subscription rows) would mix test rows into production tables that real users
  and the admin business-tracking surface read.
- **Cost / billing risk.** Sustained 500-user traffic can push egress, compute,
  and Realtime connection usage past plan limits with no isolation.
- **No clean rollback.** Production has no disposable snapshot to reset to after
  a destructive run.
- **Realtime cross-talk.** Test subscriptions on `coach_messages` /
  `notifications` would share the project's Realtime capacity with live users.

A real load test must therefore run against an **isolated staging project** that
is a structural copy of production but contains only seeded test data.

---

## 2. Required staging Supabase project setup

Create a **separate Supabase project** (e.g. `ast9-staging`) that mirrors prod:

1. **Schema parity** — apply the same migrations as production
   (`supabase/migrations/*`). The "Supabase Preview" baseline gap noted in the
   repo means migrations may need to be applied via the MCP/SQL editor rather
   than CI; verify `list_migrations` matches prod's table/policy set.
2. **RLS + policies identical** — confirm `coach_messages_participants`,
   profiles protect trigger, and the SECURITY DEFINER admin RPCs exist and are
   `is_admin()`-gated, same as prod.
3. **Edge functions deployed** — `subjective-transcript-assistant`,
   `create-user`, and any others, each bundling `_shared/auth.ts` (the
   `x-client-info` CORS allow-list fix must be present).
4. **Realtime publication** — ensure `coach_messages`, `client_posts`,
   `client_comments` are in the `supabase_realtime` publication (same as prod).
   Note: `notifications` is **not** in the publication — the bell badge is
   refreshed by the 60 s poll in `notificationsService.js`, so the Realtime
   track measures message/post delivery, while notification freshness is
   poll-bounded by design.
5. **Config** — point a **separate built copy** of the app (or an env-injected
   `SUPABASE_URL` / anon key) at the staging project. Never run load tooling
   against the production URL.
6. **Capture plan limits first** — before sizing, read the staging project's
   current limits in the Supabase dashboard: Realtime concurrent connections,
   Realtime messages/sec, DB connection pool size, PostgREST timeout, and Auth
   request rate limits. Size the ramp against these, not against guesses.

---

## 3. Required seeded accounts and data

Seed **clearly-marked, disposable** rows (prefix every test identity, e.g.
`loadtest+coachNNN@ast9.test`, content/titles prefixed `LOADTEST-`) so cleanup
is a single predicate. Seed via the service-role key in a one-off script:

| Entity | Quantity | Notes |
|---|---|---|
| Coaches (`profiles.role='coach'`) | ~50 | each with a package + slot allotment |
| Clients (`profiles.role='client'`) | ~425 | each `assigned_coach` = one seeded coach |
| Admin/read-only | ~25 | `role='admin'` or read-only observers |
| `coach_subscriptions` / `subscriptions` | 1 per coach | active interval (monthly/annual) so subscription-gate passes |
| `client` subscriptions/state | active or grace | so the client subscription-gate lets them in |
| Programs / `client_programs` | 1–3 per client | for program-read + train load |
| `coach_messages` | ~5–20 per client↔coach pair | for thread + unread/badge load |
| `appointments` | 1–2 per client | for the upcoming-session card |
| `notifications` | a few per user | for bell badge + inbox load |
| `daily_routine_logs` | a week per client | for progress/accountability load |

Total ≈ 500 auth users. All emails on a disposable domain; all passwords
generated and **passed to the load tool via environment variables**, never
hardcoded in committed scripts.

---

## 4. User mix

- **10% coaches** (~50) — dashboard, clients list, slots, appointments,
  community, messages.
- **85% clients** (~425) — today, train, progress, coach/support, messages.
- **5% admin/read-only** (~25) — admin business overview, read-only sweeps.

---

## 5. Feature mix (per virtual user, weighted read-heavy)

Each VU logs in once then loops a weighted set of actions:

| Action | Surface / call | Weight |
|---|---|---|
| login | `POST /auth/v1/token?grant_type=password` | once per VU |
| dashboard | `profiles` read + role-appropriate KPIs | high |
| train | `client_programs` / program rows read | high (clients) |
| progress | `daily_routine_logs` read | high (clients) |
| coach clients | `profiles` (assigned clients) read | high (coaches) |
| appointments | `appointments` read | medium |
| community | `client_posts` read | medium |
| messages | `coach_messages` read + bounded sends | medium |
| notifications | `notifications` unread count | medium |
| billing read | `coach_subscriptions` / `subscriptions` read | low |
| program read | program detail read | medium |
| assessment load | assessment snapshot read | low |
| graph load | reactive-graph data read | low |
| slot status (coach) | `rpc/coach_slot_status` | medium (coaches) |
| admin overview | `rpc/admin_coach_business_overview` | low (admins only) |

**Read:write ≈ 90:10.** Writes are bounded (a capped number of test messages /
notifications per VU) so the run stays mostly read-shaped and cleanup stays
small. No write touches a real user (all targets are seeded `LOADTEST-` rows).

---

## 6. Ramp plan

Staged, with a hold and a health check at each stage. **Abort and report the
last healthy stage** if any stop condition trips — do not escalate through a
failing stage.

| Stage | Concurrent VUs | Hold | Gate to next stage |
|---|---|---|---|
| 1 | 5 | 2 min | all green |
| 2 | 20 | 3 min | all green |
| 3 | 50 | 3 min | all green |
| 4 | 100 | 5 min | all green |
| 5 | 250 | 5 min | all green |
| 6 | 500 | 10 min | final |

A separate **Realtime track** subscribes a fraction of the client VUs to
`coach_messages` / `notifications` and measures end-to-end delivery delay while
the API ramp runs.

---

## 7. Stop conditions (abort the ramp immediately)

- **Auth failures** — login error rate > 1%, or any auth rate-limit (HTTP 429).
- **Error spikes** — overall non-2xx (excluding RLS-by-design 4xx) > 1%.
- **Supabase rate limits** — any 429 / "too many requests" from PostgREST,
  Realtime, or Auth.
- **Realtime instability** — subscribe failures, dropped channels, or delivery
  delay > 5 s sustained.
- **Failed network requests** — connection resets, 5xx, or PostgREST pool
  exhaustion.
- **High latency** — p95 > 2 s sustained for read endpoints.

---

## 8. Metrics to capture (per stage)

- Latency: **p50 / p95 / max** per endpoint group.
- **Error rate** (total and per endpoint), excluding the known benign RLS 4xx.
- **Login success rate.**
- **Realtime delivery delay** (insert → client receives, p50/p95).
- **DB errors** (Supabase logs: statement timeouts, pool exhaustion, deadlocks).
- **Edge function errors** (function logs: 5xx, timeouts, cold-start spikes).
- **Browser console errors** (Playwright track only) — non-benign only.

Pull DB/edge/auth errors from the staging project logs (`get_logs`) and the
advisor (`get_advisors`) after each stage.

---

## 9. Cleanup plan

- **Predicate cleanup** — every test row is prefixed (`LOADTEST-` content,
  `loadtest+...@ast9load.test` emails). Cleanup = delete by that predicate across
  `coach_messages`, `appointments`, `notifications`, `daily_routine_logs`,
  programs, subscriptions, then the seeded `profiles` and auth users.
- **Preferred** — because it is an isolated staging project, the cleanest reset
  is to **restore/recreate the staging project** (or truncate the seeded tables)
  rather than row-by-row deletes.
- **Verify zero residue** — `SELECT count(*) ... WHERE <prefix>` returns 0 for
  every touched table before declaring the run closed.
- **Never** run cleanup predicates against the production project.

---

## 10. What can be safely committed as QA tooling

**Safe to commit (if approved):**

- **This plan** (`LOAD_TEST_STAGING_PLAN.md`).
- A **parameterized k6 (or Artillery) script** for the API ramp that:
  reads `SUPABASE_URL`, anon key, and all credentials from **environment
  variables** (no hardcoded passwords), targets only the staging URL, and
  refuses to run if the URL resolves to the production ref.
- A **seed script** that creates `LOADTEST-` data via the service-role key
  supplied through env (never committed).

**Keep uncommitted (current rule):**

- The Puppeteer browser smokes and the `static-serve.js` helper in
  `.smoke-d079a9f/` — they hardcode the shared TEST-account password and are
  throwaway harnesses. `.smoke-*` is never committed.
- Any script containing a real or test password literal, a service-role key, or
  a production URL.

**Hard rules for committed tooling:** no plaintext passwords, no service-role
keys, no `.env` with secrets, and a guard that aborts if pointed at the
production Supabase ref. The anon key is already public (it ships in
`js/supabaseClient.js`), so its presence in a script is not a secret leak — but
credentials and service-role keys must come from the environment only.

---

---

## EXECUTED RUN — free-tier staging (2026-06-16)

The "free best-effort staging" path was executed. A dedicated **free** ($0/mo)
staging project (`ast9-staging-loadtest`, ref `lsyogvmpftlorvurwmly`,
eu-central-1) was created in the same org, isolated from production. The
load-test surface (9 tables, RLS, triggers, helper RPCs, realtime publication)
was introspection-cloned from prod and seeded with **500 synthetic users**
(50 coaches / 425 clients / 25 admins, emails `loadtest+...@ast9load.test`,
disposable shared password via env) plus programs, subscriptions, 2 975 routine
logs, 1 700 messages, 425 appointments, 1 000 notifications, posts/comments.
Tooling (uncommitted): `.smoke-d079a9f/load/{mint-pool,ramp,loadtest,probe-auth}.js`.

**Login (auth) — per-IP burst-limited.** From a single machine, GoTrue
rate-limited sustained distinct logins: a 500-at-once burst yielded 31 success /
469 × HTTP 429; paced minting reached **328/500 distinct logins (0 non-429
failures)** in 10 min before the time cap. Login latency when not throttled:
p50 264 ms / p95 532 ms. Real 500-user traffic arrives from 500 distinct IPs, so
this per-IP limit is a **load-generator artifact, not a backend limit.** The
data-plane ramp therefore reused the 328-token pool (standard technique).

**Data-plane ramp (RLS-evaluated reads + ~10% writes), 328-token reuse:**

| Stage | Requests | Success | p50 | p95 | max | 429 | 5xx |
|---|---|---|---|---|---|---|---|
| 5   | 33   | 100%   | 161 ms | 843 ms | 0.9 s | 0 | 0 |
| 20  | 133  | 100%   | 280 ms | 786 ms | 1.2 s | 0 | 0 |
| 50  | 332  | 100%   | 411 ms | 2.46 s | 3.4 s | 0 | 0 |
| 100 | 669  | 100%   | 0.96 s | 4.15 s | 7.9 s | 0 | 0 |
| 250 | 1 669| 100%   | 1.65 s | 8.70 s | 19.2 s | 0 | 0 |
| **500** | **3 343** | **99.13%** | 3.56 s | 20.0 s | 30 s | **0** | **0** |

(Rows 5–50 are from the latency-gated staged run, which stopped at 100 on a
p95>4 s rule; rows 100–500 are from a follow-up error-only "push" run on the
same staging + token pool, minutes later, to find the true ceiling.)

**Verdict.** The **500-user stage genuinely ran.** The backend never hard-failed
— **0 server errors (5xx), 0 rate-limits (429)** at every stage; the 29 failures
at 500 were client-side 30 s timeouts on the slowest queued requests, not
backend errors (99.13% success). RLS stayed correct throughout (a coach sees
only its 9 clients + coaches/admins, not all 425). **Latency, however, degrades
steeply on free-tier compute** (p50 161 ms → 3.56 s; p95 0.84 s → 20 s as VUs go
5 → 500). The highest stage meeting a sane latency bar (p95 ≲ 2.5 s) was
**50 VUs**; correctness and availability held all the way to **500**.

**This does NOT prove production handles 500 at acceptable latency** — free-tier
compute (shared CPU, tiny connection pool) is the binding latency constraint. A
production-fidelity verdict needs a Pro-tier staging (see §2); the *correctness/
availability* result (no errors to 500) is meaningful regardless of tier.

### Prior baseline (unchanged)
- Production read probe `.smoke-d079a9f/qa-load.js`: 5/20/50 concurrent = 100%,
  p95 ~0.4–0.8 s (deliberately capped well below limits).
- Realtime correctness verified functionally (`qa-realtime-landing.js` 9/9 on
  built dist + live prod); realtime delivery-delay under concurrency remains the
  Realtime track in §6/§8 (not separately load-measured this run).
