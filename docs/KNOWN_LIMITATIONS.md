# AST9 Known Limitations

> Honest, current limitations. These are tracked deliberately — they are not
> hidden defects. Update as items are resolved.

---

## L1 — Authenticated write flows are not fully implemented
P3A-1 provides a production-blocked authenticated Playwright harness, and P3A-2A
adds deterministic local seed/verify/reset tooling for stable synthetic accounts.
P3A-2B adds a reviewed schema-only baseline and an offline, production-blocked
provisioning command emitter. P3A-2C provisioned the separate Free staging project
and verified authenticated role routing. P3A-2D0 expands the deterministic
baseline to five synthetic identities and 18 reset relations. End-to-end write
specs for subscription management, assessment save, and program draft/publish
remain pending. Workout completion additionally requires the database gate in
L12. See [RUNBOOK.md](RUNBOOK.md) and [ISSUE_LOG.md](ISSUE_LOG.md) #13.

## L2 — Automated browser visual smoke may fail (DevTools / localhost limits)
Automated visual smoke can fail for environment reasons (no authenticated session,
DevTools-localhost constraints) — this is an environment limitation, not an app
bug. UI changes are verified by owner visual review. See [NOT_A_BUG.md](NOT_A_BUG.md) #4.

## L3 — Legal text requires final lawyer review before launch
Terms / consent / disclaimer copy is not finalized and must be reviewed by a lawyer
before any public launch. Backend-persisted, versioned acceptance already exists
through `legal_documents`, append-only `legal_acceptances`, and the validated
`record_legal_acceptance()` RPC; lawyer approval of the actual document text and
version-release procedure remains outstanding.

## L4 — Payment integration not implemented (provider-neutral DB foundation laid)
Billing/packages exist as a foundation, and as of **P2B** a provider-neutral
payments DB foundation is in place (`payment_events` idempotency ledger,
provider-neutral columns on `coach_subscriptions`, and the service-role-only
`apply_paid_coach_package_period_system()` RPC). **No payment provider is live
yet** — no Paymob/Stripe code, SDK, Edge Function, or keys. Manual (admin-assign)
billing still works and remains the fallback. Payments are **webhook-authoritative**
by design: the frontend / a checkout redirect never grants access. Paymob
integration is the next phase (P2C/P2D) and needs an owner-created provider account.
See root `BUSINESS_MODEL_AUTH_BILLING_PLAN.md`.

## L5 — Athletic Performance is not production-ready
The Athletic lane is an admin-only locked preview (PR #72). It must not be exposed
to coaches/clients until fully smoked. See [DECISIONS.md](DECISIONS.md) D1/D6.

## L6 — Supabase Preview CI does not consume the staging-only baseline
The reviewed baseline intentionally sits outside `supabase/migrations/` so a
normal `db push` can never apply it to production. Automated Supabase Preview
therefore still cannot reconstruct the historic schema from the 10 no-op markers.
This remains non-blocking until a separate preview-safe provisioning design is
approved; do not move the baseline into the migration sequence to chase this
check green. See [NOT_A_BUG.md](NOT_A_BUG.md) #3.

## L7 — No markdown lint tooling in the repo
There is no markdownlint/prettier dev dependency. Docs are reviewed manually
against the `clean-code-guard` / documentation-quality standards rather than by
a linter.

## L8 — Authenticated staging is provisioned; write specs remain pending
The Playwright smoke net (P1F-1 — `tests/smoke/`, `.github/workflows/smoke-tests.yml`)
runs Chromium against the **built** bundle served at the production base `/AST9_HUB/`
(via `tests/smoke/serve-dist.mjs`), so dev-only (`vite serve`) breakage is out of
scope. **Public** specs (landing, boot router / PR#53 bounce guard, login screen,
the 6 legal pages, Sentry-boot safety) always run. **Authenticated** specs cover
admin, coach, active-client, inactive-client, and logout routing only when an
isolated staging target plus synthetic accounts are configured. The harness fails
closed on partial configuration, rejects the production project, and blocks
production Supabase HTTP and WebSocket endpoints. Authenticated CI artifacts are
not uploaded. P3A-2A adds production-blocked seed/verify/reset commands with
strict synthetic identities, typed project confirmation, scoped UUID deletion,
and stable auth users. P3A-2B adds the single-use schema baseline, 60-version
repair manifest, and offline guard. P3A-2C provisioned the isolated Free project;
P3A-2D0 added the unassigned authorization fixture and deterministic cleanup for
all currently planned write targets. The write-flow browser specs and the
video-modal regression remain pending.

## L9 — `v_client_subscription_state` has no `cancelled` branch (latent, currently unreachable)
The effective-state view (`20260530202308_subscription_grace.sql`) maps `pending`
and `expired` explicitly, then falls through to date logic. A subscription row with
`status='cancelled'` **and** a future `end_date` would therefore read as
`effective_status='active'` and retain write access. No supported write path sets
`cancelled`: the create/edit RPCs (`create_client_subscription` /
`update_client_subscription`, Phase A) reject it, `reactivate`/`activate` set
`active`, and `expireNow` sets `expired`. So the gap is **unreachable today**. If a
future feature needs a `cancelled` state, add a `WHEN status='cancelled'` branch
(→ `expired`/`none`) to the view **in the same change**. Surfaced by the Fable 5
secondary review of Phase A.

## L10 — Static authenticated-fixture limitation in Playwright visual verification
Visual screenshot verification of authenticated platform shells (such as the coach dashboard, objective assessment, and programs views) uses a DOM-only static fixture in Playwright tests (`loginScreen.classList.add('hidden')`, `appScreen.style.display = 'block'`, `body.nc-bright`) without invoking Supabase, auth APIs, or live backend endpoints. Live session state rendering and database-persisted save flows still require owner manual testing in the live application.

## L11 — Staging Edge Functions are not deployed
The repository contains 12 Edge Functions plus `_shared`, but P3A-2B provisions
database schema only. Role-routing and PostgREST smoke do not need those functions.
Program generation and other flows that invoke `generate-program` remain blocked
until a separate staging function-deployment plan defines function scope, synthetic
secrets, and proof that no production key is reused.

## L12 — Inactive-client write protection is frontend-only
The inactive-subscription takeover prevents protected workout actions through the
normal UI, but `workout_sessions_client_own` authorizes writes by client ownership
only. An authenticated inactive client could submit a direct PostgREST write.
P3A-2D4 workout-write coverage is blocked until a separately reviewed forward
migration adds database-level effective-subscription enforcement. Do not weaken
the test to assert only UI reachability and describe it as database security.
