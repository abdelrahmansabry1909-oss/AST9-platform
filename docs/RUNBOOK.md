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

**Authenticated project** (credential-gated): coach + client login reach the app
without a landing bounce. **Skips cleanly** unless these env/secrets are set:
`AST9_E2E_COACH_EMAIL`, `AST9_E2E_COACH_PASSWORD`, `AST9_E2E_CLIENT_EMAIL`,
`AST9_E2E_CLIENT_PASSWORD`. This project runs with **trace/screenshot/video OFF**
so the login password (auth POST body) and post-login client data never reach disk;
CI uploads artifacts only on failure (public project only). Not covered here (manual
until a staging seeded account exists): inactive-client subscription gate,
video-modal close regression — see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) #L8.

**CI:** `.github/workflows/smoke-tests.yml` (`workflow_dispatch` + PRs to `main`;
`permissions: contents: read`). The Sentry **privacy** raw-envelope smoke above is a
separate check (it verifies scrubbing, not app boot) and stays owner/harness-run.
