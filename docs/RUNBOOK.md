# AST9 Ops Runbook (quick reference)

> Fast command cheat-sheet for routine ops checks. For full incident procedure,
> severity levels, and rollback steps see [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
> **Never** paste secret values, tokens, or user health data into notes.

- **Production Supabase ref:** `byquokhcbagofshsclfy`
- **Live site:** `https://abdelrahmansabry1909-oss.github.io/AST9_HUB/`

---

## Cron / edge health (owner-only)

Run in the Supabase SQL editor (or via MCP) as the owner/admin:

```sql
select public.ops_health_snapshot();
```

Returns jsonb:

```jsonc
{
  "generated_at": "…",
  "overall_healthy": true,
  "jobs": [
    {
      "jobname": "subscription-checker-daily",
      "present": true, "active": true, "schedule": "0 0 * * *",
      "expected_interval_min": 1440,
      "last_run_at": "…", "last_run_status": "succeeded",
      "minutes_since_last": 120, "stale": false,
      "healthy": true, "reason": "ok"
    }
    // pulse-alerts-daily, expire-stale-workouts-hourly …
  ],
  "edge_http": {
    "available": true,
    "last_status": 200, "last_at": "…",
    "non_2xx_last_24h": 0, "timed_out_last_24h": 0,
    "note": "Global pg_net responses (cron + app edge calls); best-effort, short retention."
  }
}
```

**How to read it**
- `overall_healthy: false` → inspect the offending `jobs[].reason`.
- A job `stale` or `present:false` / `active:false` → the schedule stopped; re-apply
  its migration (owner-approved).
- `edge_http.non_2xx_last_24h > 0` or `last_status` non-2xx → an **edge function**
  is returning errors even if cron dispatch "succeeded" (the S7 pattern). Check
  Supabase Edge logs; do not print secrets.
- `edge_http.available:false` or nulls → usually just pg_net's short retention
  (daily responses already pruned), not necessarily a problem.

**Expected jobs:** `subscription-checker-daily` (0 0 * * *), `pulse-alerts-daily`
(0 5 * * *), `expire-stale-workouts-hourly` (0 * * * *).

**Privacy:** the snapshot returns only job names, schedules, timings, status codes,
and counts — **no** headers, bodies, tokens, Vault values, or user data.

---

## Deploy check

```bash
gh run list --workflow="Deploy to GitHub Pages" --limit 3
```
Confirm the latest run's `headSha` == `origin/main` and `conclusion = success`.

## Live asset verification (after any frontend change)

```bash
curl -fsSL "https://abdelrahmansabry1909-oss.github.io/AST9_HUB/app.html" | grep 'js/<module>.js?v='
```
Confirm the expected `?v=` token is live (stale token = CDN/browser cache; see
[ISSUE_LOG.md](ISSUE_LOG.md) #5).

---

## Automated cron health-check (P1C edge function built; P1D Action pending)

An automated schedule that calls the health snapshot and alerts on failure is
built in two safe layers so a GitHub Action never holds the Supabase
`service_role` key or an admin JWT.

**Layer 1 — edge function `ops-health` (P1C, built):** `supabase/functions/ops-health/index.ts`.
- Deploy with `verify_jwt = false` (server-to-server; the header secret is the gate).
- Requires header `x-ops-health-secret`, validated in-DB against the Vault secret
  `ops_health_secret` via `verify_ops_health_secret()` (never plaintext here).
- Reads the safe snapshot via the service-role-only `ops_health_snapshot_system()`
  (the admin `ops_health_snapshot()` is never called) and returns only compact,
  safe JSON: `{ ok, overall_healthy, generated_at, hard_fails[], warnings[] }`.
- Never logs/echoes/returns the secret, `service_role` key, headers, bodies, Vault
  values, cron commands, or user/health data.

**Layer 2 — scheduled GitHub Action (P1D, built):** `.github/workflows/ops-health.yml`
(`Ops Health Check`). Runs every 6h (`0 */6 * * *`) + `workflow_dispatch`; least
privilege (`permissions: contents: read`). Holds **only** `OPS_HEALTH_SECRET` as a
repo secret (never `service_role`, never an admin JWT), sends it as the
`x-ops-health-secret` header, and **fails the run** (native GitHub email) when the
endpoint is unreachable, non-200, returns invalid JSON, reports `ok != true`, or
lists any `hard_fails`. The secret is never echoed; only safe summaries print.
Scheduled/manual runs activate after the file is on `main`; the **first run also
proves** the GitHub↔Vault secret pair matches (200 = match; 401 = re-sync).

**Why edge-function-wrapper over direct RPC from CI:** the admin RPC needs an admin
identity; minting/storing an admin JWT in CI is unsafe. The dedicated secret-gated
edge function keeps CI's credential to a single-purpose, revocable token.

**Secret names (values live only in Vault + GitHub, never in the repo):**
`ops_health_secret` (Supabase Vault) and `OPS_HEALTH_SECRET` (GitHub Actions repo
secret) must hold the same value. Reuses the existing Vault pattern; no new
`service_role` exposure.

---

## Frontend error monitoring (Sentry) — P1E-3 / P1E-4

A frontend **errors-only** Sentry shell lives in `js/monitoring.js`, loaded from
`app.html` via a pinned, SRI-locked bundle from `browser.sentry-cdn.com`. As of
**P1E-4 the DSN is LIVE** — `window.SENTRY_DSN` holds the real `ast9-frontend`
**EU** browser DSN, so the shell now sends scrubbed error events. Setting
`window.SENTRY_DSN = ''` reverts it to fully **inert** (zero ingest calls). The
`environment` tag is hostname-derived: `production` only on
`abdelrahmansabry1909-oss.github.io`, `development` on localhost/127.0.0.1,
`preview` otherwise.

**Design (do not weaken without owner + privacy review):**
- Pinned `@sentry/browser` **10.63.0** errors-only bundle, `integrity=` (SRI) +
  `crossorigin`. **No** Sentry Loader (the Loader bakes the DSN into its URL and
  cannot ship inert). **No** Session Replay / tracing / profiling — that code is
  not even in the bundle.
- **Fail-open:** a blocked/failed CDN, an undefined `Sentry`, or an init error
  never breaks boot. Adblockers commonly block `browser.sentry-cdn.com` and
  `*.ingest.sentry.io` — expected and harmless; **never** read "no Sentry events"
  as "no errors" (ops-health remains the uptime source of truth).
- **No user identity:** never `setUser`; no id/email. Tags limited to
  `{ role, feature_area, app_version }`.
- **All breadcrumbs off** (console/dom/fetch/xhr/history) + `maxBreadcrumbs:0`.
- **`beforeSend` scrubber** deletes `user`/`extra`/request headers/cookies/data/
  query_string, strips query+hash from the request URL and every stack-frame URL,
  allow-lists tags, and redacts emails/phones/UUIDs/JWTs/tokens/`Key(…)=(…)`/
  `DETAIL:`/PostgREST `eq.<val>` filters **before** truncating. If the scrubber
  throws it returns `null` (drops the event) — never leaks raw.
- **Server-side** Sentry scrubbing (Prevent-Store-IP, sensitive fields, Allowed
  Domains) is a **required second net**, not optional.

**Live (P1E-4, owner-approved):** `window.SENTRY_DSN` in `app.html` holds the real
EU browser DSN (public by design), the `js/monitoring.js?v=` token is bumped to
`20260702b`, and `ignoreErrors` includes the SDK-v10 `Object captured as promise
rejection` wording. **Run the raw-envelope smoke (below) after every deploy** and
verify the live `?v=` token actually updated before trusting Sentry. Edge Sentry
remains deferred.

**Kill switches:**
- **Emergency / instant (zero-deploy):** disable the DSN **client key** in the
  Sentry UI (Settings → Client Keys). Ingest rejects immediately; the SDK fails
  silently; the app is unaffected (fail-open).
- **Repo-level:** set `window.SENTRY_DSN = ''` — goes inert, but needs a PR +
  Pages deploy + page **reload** (already-open tabs keep their client until
  reload). Use the UI key-disable for anything urgent.

Do **not** claim HIPAA/GDPR compliance anywhere.

### Smoke checklist (seeded disposable account; inspect the RAW envelope, not the Sentry UI)

Grep the **raw outbound envelope** (network payload, or a temporary `beforeSend`
console-mirror) — the Sentry UI applies its own server-side scrubbing and hides
what you actually sent. Every "absent" check must first assert **the envelope
exists** (adblock → zero envelopes → vacuous green).

1. DSN blank → app boots; **zero** requests to any `*.ingest.sentry.io` host and
   zero envelopes.
2. Sentry CDN/script blocked → app boots (fail-open; `typeof Sentry` guard).
3. DSN set → a synthetic thrown `Error` is captured (envelope exists).
4. Envelope-exists precondition asserted before every absence check below.
5. Seeded email / UUID / name **absent** from the envelope.
6. Redaction markers **present**: `[email]`, `[uuid]`, `DETAIL: [redacted]`.
7. `Key (email)=(seed@x.test)` → redacted.
8. `DETAIL: …` text → redacted.
9. Request URL query/hash stripped.
10. Stack-frame `filename`/`abs_path` query/hash stripped.
11. `event.user` absent.
12. `event.extra` absent.
13. Breadcrumbs empty/absent.
14. No `Authorization` / `apikey` / `sb-` / `access_token` / `refresh_token`.
15. `#access_token=fake.jwt.value` in the URL hash does **not** appear.
16. Object-reason unhandled rejection → **dropped** by `ignoreErrors`
    ('Non-Error promise rejection captured'), OR if forced via
    `Sentry.captureException(obj)`, no object fields present.
17. Adblocker blocks Sentry → app still boots. Remove the synthetic trigger after
    testing. Re-run this whole checklist whenever `js/monitoring.js` or the pinned
    SDK version changes — with no test framework, this checklist **is** the
    regression suite. A DSN-blank run should show only the static bundle fetch and
    **no** ingest traffic.

---

## Browser smoke tests (Playwright) — P1F-1

A minimal Chromium smoke net lives in `tests/smoke/` (`@playwright/test`). It runs
against the **built** bundle served at the production base `/AST9_HUB/` by a
dependency-free static server (`tests/smoke/serve-dist.mjs` — `vite preview` can't
serve the base, which is only set on `build`).

```bash
npm run test:smoke          # all projects (authenticated self-skip without creds)
npm run test:smoke:public   # public project only (no credentials needed)
```

**Public project** (always runs, no creds): landing loads + brand; boot router
(bare `app.html` → redirects to landing; `app.html?login=1` → stays — the PR#53
bounce guard); login screen renders + overlay clears; all 6 legal pages 200; Sentry
shell initializes without breaking boot. A console/`pageerror` guard fails on any
uncaught error or non-benign `console.error` (tight allow-list: favicon, Sentry
ingest — which is also route-stubbed).

**Authenticated staging project** (P3A-1, credential-gated): admin, coach, active
client, and inactive-client routing tests run only when an isolated Supabase
staging project is configured. The harness rewrites the local built copy of
`js/supabaseClient.js` and `js/visitor.js` in memory, blocks production Supabase
HTTP and WebSocket endpoints, requires the locally built frontend, and rejects
any staging URL that resolves to production ref
`byquokhcbagofshsclfy`. Test emails must contain the configured synthetic identity
marker. Partial configuration fails closed before login; a completely absent
configuration skips the authenticated project cleanly.

Repository **Variables**:

- `AST9_E2E_STAGING_SUPABASE_URL` — `https://<staging-ref>.supabase.co`
- `AST9_E2E_IDENTITY_MARKER` — marker present in every disposable test email

Repository **Secrets**:

- `AST9_E2E_STAGING_SUPABASE_ANON_KEY`
- `AST9_E2E_ADMIN_EMAIL`, `AST9_E2E_ADMIN_PASSWORD`
- `AST9_E2E_COACH_EMAIL`, `AST9_E2E_COACH_PASSWORD`
- `AST9_E2E_CLIENT_EMAIL`, `AST9_E2E_CLIENT_PASSWORD`
- `AST9_E2E_INACTIVE_CLIENT_EMAIL`, `AST9_E2E_INACTIVE_CLIENT_PASSWORD`

The active admin/coach/client fixtures must have accepted current legal versions.
The active client must resolve to `active` or `grace`; the inactive client must
resolve to `expired`, `pending`, or `none`. Use disposable synthetic data only.
Never configure production credentials. The authenticated Playwright project keeps
trace/screenshot/video OFF and never persists `storageState`. CI does not upload
Playwright reports or `test-results`; failure context remains ephemeral on the
runner.

```bash
npm run test:unit:staging-safety  # production-target and rewrite guard tests
npm run test:smoke:staging       # staging role-routing smoke (gated)
```

### Deterministic staging fixtures (P3A-2A)

The repository now includes guarded local tooling for four stable synthetic
fixtures: admin, coach, active client, and inactive client. The tooling never
deletes auth users. `reset` removes only write-test rows anchored to the two
validated fixture client UUIDs, then reconciles the same users and verifies the
baseline.

This repository does **not** contain a complete historical baseline schema.
Creating a fresh Supabase project from `supabase/migrations/` alone will leave
required tables missing. Before using these commands, the owner must create an
isolated staging project with a schema cloned from the current application schema.
The tools probe required tables and fail clearly when the staging schema is
incomplete.

Use a local, ignored environment file or temporary shell environment. Never put a
staging service-role key in GitHub Actions, a PR body, a committed file, agent
chat, browser storage, or frontend code. In addition to the P3A-1 variables and
secrets above, local mutation commands require:

- `AST9_E2E_STAGING_SERVICE_ROLE_KEY` — isolated staging service-role key
- `AST9_STAGING_SEED_CONFIRM` — exact staging project ref, typed as confirmation

The synthetic identity marker must contain at least six characters and must
appear in the local part of every fixture email. All four emails must be distinct.

```bash
npm run staging:validate  # offline configuration/safety validation; no connection
npm run staging:seed      # create/reconcile stable users and deterministic baseline
npm run staging:verify    # read-only verification of roles, legal state, and access state
npm run staging:reset     # scoped write-artifact cleanup, reseed, and verification
```

Run `staging:validate` first. Then run `staging:seed` once, followed by
`staging:verify`. Use `staging:reset` before and after authenticated write-flow
tests. Output contains role labels only; fixture emails, passwords, URLs, anon
keys, and service-role keys are not printed.

The current reset contract covers the P3A-2 write targets only: subscriptions,
rehab assessments, RPM graphs, program versions, and workout sessions. It does
not reset appointments, community, notifications, daily routines, progress
snapshots, or Athletic Performance records. Add a UUID-scoped, dependency-ordered
reset step before extending authenticated write tests to any of those modules.

P3A-1 covers role routing, inactive takeover, and real logout. P3A-2A supplies
the seed/reset safety foundation, but no staging project has been provisioned or
contacted by this implementation. P3A-2 browser write flows (subscription changes,
assessment save, program draft/publish, workout completion) remain pending until
the owner provisions the isolated schema, runs the fixture commands, and configures
the credential-gated authenticated smoke.

**CI:** `.github/workflows/smoke-tests.yml` (`workflow_dispatch` + PRs to `main`;
`permissions: contents: read`). The Sentry **privacy** raw-envelope smoke above is a
separate check (it verifies scrubbing, not app boot) and stays owner/harness-run.

---

## Payments — provider-neutral DB foundation (P2B)

The payments lane is **DB-foundation only** so far. **No payment provider is live**
— no Paymob/Stripe code, SDK, Edge Function, or keys. Manual (admin-assign) billing
via `admin_set_coach_package()` still works and remains the fallback.

**What P2B added (migration `20260702000000_provider_neutral_payments_foundation`):**
- `public.payment_events` — idempotency + audit ledger. `UNIQUE(provider,
  provider_event_id)` is the idempotency key. Stores a **scrubbed summary only** —
  never the raw webhook body, card data, tokens, or secrets. Admin-read via RLS;
  writes come from the service role (webhook/RPC), which bypasses RLS.
- `coach_subscriptions` provider-neutral columns: `provider` (`manual`|`paymob`|
  `stripe`, default `manual`), `provider_customer_id`, `provider_subscription_id`,
  `current_period_end`, `cancel_at_period_end`, `last_payment_status`,
  `billing_currency`.
- `public.apply_paid_coach_package_period_system(...)` — **service-role-only**
  RPC (SECURITY DEFINER, search_path pinned, EXECUTE revoked from
  public/anon/authenticated). The future verified webhook calls it to apply a paid
  coach-package period; idempotent via `payment_events`.

**Design invariants (do not weaken):**
- **Webhook-authoritative.** Access is granted ONLY by a verified provider webhook
  (which calls the service-role RPC) or by an admin RPC. The frontend / a Checkout
  **redirect never activates access.**
- **HMAC verification** happens in the (future) edge function BEFORE the RPC is
  called; the RPC itself handles no secrets.
- **Idempotent.** Replayed webhooks (same `provider, provider_event_id`) are a
  no-op — the period is never extended twice.
- **No raw payloads / card data** stored anywhere; only a scrubbed summary.
- No HIPAA / GDPR / PCI compliance is claimed.

**Apply / rollback (owner-approved separate phase — NOT applied by the PR):**
apply via MCP `apply_migration` (name `provider_neutral_payments_foundation`);
rollback = `supabase/migrations/rollbacks/20260702000000_provider_neutral_payments_foundation_down.sql`.
Next: **P2C** (Paymob webhook edge fn) / **P2D** (checkout UI) — both need an
owner-created Paymob account first.
