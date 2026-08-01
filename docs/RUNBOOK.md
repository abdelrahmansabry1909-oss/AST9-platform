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

Every Pages deploy is gated on the `verify` job. After `npm ci`, it runs these
four gates in order:

```bash
npm run audit:ci
npm run test:unit
npx playwright install --with-deps chromium
npm run test:smoke:public
```

`audit:ci` is `npm audit --omit=dev --audit-level=high`. It fails the build on a
**high or critical** advisory in **production** dependencies. Dev-only advisories
do not block a deploy of a static bundle, and failing on every moderate
transitive advisory with no fix available would create a broken-build treadmill —
Dependabot (`.github/dependabot.yml`) surfaces those without blocking.

If `audit:ci` fails: run `npm audit` locally to see the advisory, then
`npm audit fix --package-lock-only` if a fix exists. If none exists, assess the
actual exposure before reaching for `--force`, which can introduce breaking major
bumps. Record the decision rather than silently lowering the threshold.

Only a successful `verify` starts `build`; only a successful `build` starts
`deploy`. If the gate fails, open the workflow run, select the `Verify` job, and
read the first failed step and its log. `Build` and `Deploy` should show as
skipped. Fix the reported unit-suite, Chromium-install, or public-smoke failure,
then rerun the workflow or push the correction.

For the equivalent complete local gate (full unit suite, production build, then
public smoke), run:

```bash
npm test
```

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

## Automated cron health-check (P1C edge function built; P1D Action built)

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

The repository now includes guarded local tooling for five stable synthetic
fixtures: admin, coach, active client, inactive client, and an unassigned client
used for authorization-denial tests. The tooling never deletes auth users.
`reset` removes only write-test rows anchored to the three validated fixture
client UUIDs, then reconciles the same users and verifies the baseline.

This repository does **not** contain a complete historical baseline schema.
Creating a fresh Supabase project from `supabase/migrations/` alone will leave
required tables missing. Before using these commands, the owner must create an
isolated staging project with a schema cloned from the current application schema.
The tools probe required tables and fail clearly when the staging schema is
incomplete.

Use a local, ignored environment file or temporary shell environment. Never put a
staging service-role key in a PR body, committed file, agent chat, browser
storage, or frontend code. In CI, configure it only as the repository secret
documented below. In addition to the P3A-1 variables and secrets above, local
mutation commands require:

- `AST9_E2E_STAGING_SERVICE_ROLE_KEY` — isolated staging service-role key
- `AST9_STAGING_SEED_CONFIRM` — exact staging project ref, typed as confirmation
- `AST9_E2E_UNASSIGNED_CLIENT_EMAIL`,
  `AST9_E2E_UNASSIGNED_CLIENT_PASSWORD` — local fixture-tooling credentials;
  browser smoke does not consume them until P3A-2D1

The synthetic identity marker must contain at least six characters and must
appear in the local part of every fixture email. All five emails must be distinct.

```bash
npm run staging:validate  # offline configuration/safety validation; no connection
npm run staging:seed      # create/reconcile stable users and deterministic baseline
npm run staging:verify    # read-only verification of roles, legal state, and access state
npm run staging:reset     # scoped write-artifact cleanup, reseed, and verification
npm run staging:authz-subscriptions  # subscription write authorization matrix (P3A-2D1)
npm run staging:authz-system-rpcs    # system-only RPC execution boundaries (P3A-2D1)
npm run staging:authz-workout-writes # inactive-client workout write gate (L12)
npm run staging:authz-client-writes  # residual client-write authorization matrix
```

Run `staging:validate` first. Then run `staging:seed` once, followed by
`staging:verify`. Use `staging:reset` before and after authenticated write-flow
tests. Output contains role labels and case names only; fixture emails,
passwords, URLs, anon keys, service-role keys, and server payloads are not
printed.

### Isolated staging authorization CI (CI-1)

The manually dispatched `Isolated Staging Authorization` workflow runs the
fixture validation, seed, baseline verification, and all four authorization
matrices against the isolated staging project, then always resets the fixtures.
It is not a pull-request, push, deploy, or required-status workflow.

Before dispatching it, the repository owner must configure these exact
repository **variables**:

- `AST9_E2E_STAGING_SUPABASE_URL`
- `AST9_E2E_IDENTITY_MARKER`

The owner must also configure these exact repository **secrets**:

- `AST9_E2E_STAGING_SUPABASE_ANON_KEY`
- `AST9_E2E_STAGING_SERVICE_ROLE_KEY`
- `AST9_STAGING_SEED_CONFIRM`
- `AST9_E2E_ADMIN_EMAIL`
- `AST9_E2E_ADMIN_PASSWORD`
- `AST9_E2E_COACH_EMAIL`
- `AST9_E2E_COACH_PASSWORD`
- `AST9_E2E_CLIENT_EMAIL`
- `AST9_E2E_CLIENT_PASSWORD`
- `AST9_E2E_INACTIVE_CLIENT_EMAIL`
- `AST9_E2E_INACTIVE_CLIENT_PASSWORD`
- `AST9_E2E_UNASSIGNED_CLIENT_EMAIL`
- `AST9_E2E_UNASSIGNED_CLIENT_PASSWORD`

Every fixture email's local part must contain the configured identity marker;
the fixture contract enforces this. `AST9_STAGING_SEED_CONFIRM` must exactly
equal the staging project ref, and the service-role key must not equal the anon
key. The contract refuses to run against the production project ref.

To run the suite, open the repository's **Actions** tab, select **Isolated
Staging Authorization**, choose **Run workflow**, select the intended trusted
branch, and dispatch it. Open the resulting run and read the first failed step:
validation failures identify missing or rejected configuration; seed, verify,
or matrix failures identify the phase that did not satisfy its contract. The
final **Reset staging fixtures** step runs even after a prior failure. Inspect
that step separately to confirm cleanup succeeded; do not treat the run as clean
if reset also failed.

### Subscription write authorization (P3A-2D1)

`staging:authz-subscriptions` proves the subscription write rules at the
**database** layer. It signs each fixture role in with the **anon** key and calls
`create_client_subscription` / `update_client_subscription` over PostgREST — the
same path the browser uses. It never uses the service-role key for an actor,
because a service-role client bypasses RLS and SECURITY DEFINER authorization
entirely and would report every case as allowed.

The first isolated-staging run passed 22 of 23 cases and exposed an ACL drift:
the signed-out call was denied by the RPC's internal authorization, but reached
the SECURITY DEFINER function because `anon` retained `EXECUTE`. Do not weaken
the expected `permission denied for function` assertion. After the audited
forward migration was applied, the corrected subscription matrix passed 24/24.

`staging:authz-system-rpcs` permanently checks that both `anon` and an
authenticated fixture receive function-permission denial from
`apply_paid_coach_package_period_system` and
`expire_stale_workout_sessions_all`. The paid-package calls use an invalid
provider that fails before any write if the ACL regresses. The zero-argument
global-expiry RPC has no intrinsically non-mutating call, so the suite always
runs fixture reset afterward, including on failure.

Supabase Preview was **skipped** on the corrected PR head despite the migration,
so CI did not validate this ACL against a preview database. This is separate from
the L6 historical-baseline reconstruction gap. The evidence for this correction
is the audited migration, offline ACL guards, isolated-staging apply, 24/24
subscription matrix, and 4/4 system-RPC matrix.

It runs 24 ordered cases covering: admin and assigned-coach writes succeed; a
coach is refused on an unassigned client; a client cannot self-provision or edit
their own access; a signed-out caller cannot reach either RPC; `cancelled` is
refused on both RPCs (see L9); only an admin may expire; and every documented
range check (months, dates, plan-name length, notes length, grace days). Each
denial asserts the **specific** server message, so a case cannot pass on an
unrelated failure.

The suite creates extra subscription rows on purpose and therefore always runs
`reset` afterwards, including after a failure. Run `staging:verify` before it to
confirm the baseline, and expect the baseline restored when it finishes. Do not
run it against a project that holds real client data — the mutation boundary and
typed project confirmation must both pass first.

Browser-level subscription UI coverage is deliberately **not** part of this
suite. Authorization is proven above, at the layer that enforces it; a UI spec
would only show what the interface exposes. `AUTH_CREDENTIAL_KEYS` in
`tests/smoke/staging-target.mjs` still lists four roles, so the unassigned
fixture is local-tooling only until a browser spec needs it.

### Inactive-client workout write gate (L12)

`20260728010000_workout_write_subscription_gate.sql` adds
`client_has_write_access()` and **RESTRICTIVE** INSERT/UPDATE/DELETE policies on
`workout_sessions` and `workout_exercise_logs`. Restrictive matters: PostgreSQL
ANDs those policies with the existing permissive ones, so no coach or admin path
is modified. A permissive policy here would be OR'd instead and would block
nothing — the offline suite fails if `AS RESTRICTIVE` is ever dropped.

`SELECT` is deliberately not gated. The locked rule is active/grace → write,
expired/pending/none → **view only**, so a lapsed client must keep read access to
their own history; the suite asserts that too.

Apply order, isolated staging only:

```bash
npm run staging:reset                # deterministic clean fixture baseline
npm run staging:verify               # baseline intact before the change
# apply 20260728010000_workout_write_subscription_gate.sql
npm run staging:authz-workout-writes # 7 cases; must pass before production
npm run staging:verify               # baseline restored
```

`staging:authz-workout-writes` proves the block (a lapsed client refused on both
tables), that nothing else regressed (active client writes, coach and admin write
for a lapsed client), and that read access survives. Denials must report
`violates row-level security policy` — do not accept a generic error, and do not
substitute a UI-reachability assertion. Every case writes real rows, so the suite
always resets fixtures before the matrix and afterwards, including after a case
failure.

The gate covers direct table writes and normal workout creation/logging. The
existing authenticated `expire_my_stale_workout_sessions()` SECURITY DEFINER RPC
remains a deliberate narrow exception: it can only abandon already-stale sessions
owned by or manageable by the caller. It cannot create sessions or logs. Do not
report that maintenance transition as an L12 bypass without distinguishing it
from paid workout writes.

**Staging evidence (2026-07-28):** migration `20260728010000` is registered on
the isolated project. `staging:authz-workout-writes` passed all 7 cases
(5 allowed, 2 denied), and the subsequent fixture verification passed for all
five roles.

**Production evidence (2026-07-28):** applied under explicit owner approval and
registered as version `20260728010000`. Verified: version row exactly 1; helper
SECURITY DEFINER, STABLE, `search_path=public, pg_temp`; `anon` cannot execute it
while `authenticated` and `service_role` can; 6 RESTRICTIVE and 5 pre-existing
PERMISSIVE policies with 0 RESTRICTIVE `SELECT`/`ALL`. Impersonation probes in
rolled-back transactions denied the lapsed client on both tables with SQLSTATE
`42501`, preserved their read access, and allowed active-client and assigned-coach
writes. Row counts were unchanged and no probe row persisted. No new ERROR-level
security advisor. **Real authenticated smoke was not performed; this is
database-level verification only.**

> **Do not apply production migrations with `supabase db push` or
> `supabase migration up`.** Migration history was reconciled on 2026-07-29:
> production now represents all 64 repository versions, while retaining the 25
> differently versioned historical production rows, for 89 registry rows total.
> The prior missing-version replay hazard is resolved. These commands remain
> unapproved for production until their target selection, pending-version
> behavior, transaction model, rollback behavior, and full end-to-end procedure
> are separately validated. See [ISSUE_LOG.md](ISSUE_LOG.md) #18 and
> [MIGRATION_HISTORY_RECONCILIATION.md](MIGRATION_HISTORY_RECONCILIATION.md).

The L12 Management-API apply was an exceptional, separately audited operation,
not a generic migration procedure. Do not copy it for another migration. Before
any future production DDL:

1. confirm the production registry remains reconciled and contains no unexpected
   pending repository version;
2. prove that the selected channel applies exactly one reviewed file;
3. prove how that channel records the file's exact version;
4. stop if either guarantee is unavailable; and
5. run migration-specific structural, behavioral, and rollback verification.

Do not hand-write a migration-history row from a template or use
`ON CONFLICT DO NOTHING` to suppress a version collision. Either can make the
registry claim a state that was not actually applied. L12's exact-version record
was verified after its one-off apply; that evidence does not authorize repeating
the mechanism.

Roll back with `supabase/rollbacks/20260728010000_workout_write_subscription_gate_down.sql`,
which drops only what the migration adds and drops the policies before the
function they depend on, so it is safe even after a partial apply. Rolling back
restores the frontend-only protection described in L12 — record why if you do.
Roll back immediately if an active client's write is denied, a coach or admin
write regresses, `SELECT` becomes restricted, `anon` gains execute on the helper,
the policy counts differ from 6 restrictive plus 5 permissive, or a new
ERROR-level security advisor appears.

The current reset contract covers the P3A-2 write targets only. Its 18 probed
relations cover workout sessions/logs; program versions, revisions, current
programs, routines, and alternative requests; RPM graphs/phases/exercises;
assessment, objective, gait, body-map, subjective, progress-snapshot, and legacy
session rows; plus fixture-recipient notifications. Cleanup is UUID-scoped and
dependency ordered. It does not reset appointments, community, daily routines,
or Athletic Performance records. Add a separately reviewed scoped reset step
before extending authenticated write tests to any other module.

P3A-1 covers role routing, inactive takeover, and real logout. P3A-2A supplies
the seed/reset safety foundation. P3A-2C provisioned a separate Free Nano staging
project in Frankfurt, applied the reviewed baseline plus the two forward
migrations, and seeded and verified the initial four synthetic routing roles.
P3A-2D0 added the unassigned authorization fixture and verified all five fixtures
across three consecutive reset cycles. P3A-2D1 adds the database-layer
subscription write authorization matrix described above. Credentials remain
Windows-user encrypted outside the repository. Remaining P3A-2 write flows
(assessment save, program draft/publish, workout completion) and all browser-level
write specs remain pending.

### Isolated staging schema baseline (P3A-2B)

The reviewed, schema-only production baseline is stored at
`supabase/baseline/production_public_schema.sql`, outside the migration directory.
Its reviewed SHA-256 is:

`a057aee18df15bdb05cb6e0bbc2fcb03e6dad99c6cdbee4d717111ffa5fd220f`

It contains no exported rows, credentials, production project ref, auth/storage
schema, or health data. It is **single-use and empty-database-only**. Never move
it under `supabase/migrations/`, run it against production, or reapply it.

Prerequisites for owner-run provisioning:

- brand-new isolated Supabase project;
- Supabase CLI installed from the pinned project dependency;
- PostgreSQL `psql` client available;
- repository linked to that isolated project with
  `npx supabase link --project-ref <staging-ref>`;
- `AST9_STAGING_SEED_CONFIRM` exactly matching the isolated staging project ref.

The command emitter is offline and executes nothing:

```powershell
$env:AST9_STAGING_SEED_CONFIRM = "<staging-ref>"
npm run staging:provision-check -- --ref <staging-ref>
```

Review its output, then run one command at a time. The first emitted `psql`
command uses one transaction to refuse any existing object in `public` before
applying the baseline. Its host is derived from the validated staging ref; `psql`
prompts for the database password without storing it in the repository or command
output. This direct path requires the derived database hostname to resolve and
accept TCP connections on port 5432. The emitted guard command is safe to paste
in PowerShell, Git Bash, or a POSIX shell. If that endpoint is unavailable, use
the linked Supabase Management API fallback documented below; submit the
empty-schema guard and baseline together in one explicit transaction, never as
separate best-effort statements. The next 60 commands mark the retained historical
versions as applied.
The final `db push` must report only these two new forward migrations:

- `20260727000000_auth_user_trigger.sql`
- `20260727000100_legal_documents_reference_data.sql`

Stop if any historical migration is pending. A partial or failed baseline is
rolled back by deleting and recreating the disposable staging project, not by
reapplying the dump.

`pg_cron`, `pg_net`, and `supabase_vault` are optional for P3A-2B because the
baseline disables function-body validation while creating the four ops-health
functions that reference them. Enable them later for parity if those functions
will be tested. Staging must contain **zero cron jobs**; scheduled expiry work can
mutate fixture state between seed and smoke.

The repository contains Edge Functions that are not deployed by this phase.
Role-routing and PostgREST smoke do not require them. Program generation and
publish flows that invoke `generate-program` remain blocked until a separately
reviewed staging function-deployment phase.

### Isolated staging provisioning (P3A-2C)

The isolated project is under a separate staging organization, uses the Free Nano
compute size in Frankfurt, and was created without a billing or payment step.
PostgreSQL 17 client tools are installed locally. The reviewed baseline was
applied to an empty `public` schema in one explicit transaction through the
linked Supabase Management API because the direct database hostname was not
resolvable from the provisioning network. The same SQL payload executed the
empty-schema refusal guard before any baseline statement, so the fallback
preserved the emitter's fail-closed precondition rather than relying only on the
project being newly created.

Post-provision checks confirmed:

- all 60 historical versions repaired as applied;
- only the two P3A-2B forward migrations pushed;
- 62 total migration-history rows;
- all fixture and reset-contract relations present;
- exactly one enabled `auth.users` profile trigger;
- six current legal-document metadata rows, four required;
- `pg_cron` disabled, therefore zero scheduled jobs;
- deterministic admin, coach, active-client, and inactive-client fixtures seeded
  and verified.

No project ref, URL, API key, database password, fixture email, or fixture
password is committed. Keys and passwords were not printed. Local secrets are
Windows-user encrypted outside the repository. Production was not linked,
queried, or mutated.

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
