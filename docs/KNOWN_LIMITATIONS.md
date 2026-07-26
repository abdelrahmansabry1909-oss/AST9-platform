# AST9 Known Limitations

> Honest, current limitations. These are tracked deliberately — they are not
> hidden defects. Update as items are resolved.

---

## L1 — Authenticated write smoke still requires staging provisioning
P3A-1 provides a production-blocked authenticated Playwright harness, and P3A-2A
adds deterministic local seed/verify/reset tooling for four stable synthetic
accounts. The separate Supabase staging project is not provisioned or configured
yet, and this repository lacks a complete historical baseline schema for creating
one from migrations alone. End-to-end write flows (assessment save, subscription
management, program draft/publish, workout completion) still require owner manual
smoke or backend impersonation until the owner clones the current schema into an
isolated project and runs the fixture tooling. See [RUNBOOK.md](RUNBOOK.md) and
[ISSUE_LOG.md](ISSUE_LOG.md) #1–#2.

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

## L6 — Supabase Preview CI check always fails (baseline gap)
Non-blocking and expected; do not chase it green. See [NOT_A_BUG.md](NOT_A_BUG.md) #3.

## L7 — No markdown lint tooling in the repo
`package.json` defines only Vite scripts (`dev`/`build`/`preview`); there is no
markdownlint/prettier dev dependency. Docs are reviewed manually against the
`clean-code-guard` / documentation-quality standards rather than by a linter.

## L8 — Authenticated staging tooling exists but is not provisioned
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
and stable auth users. No staging environment was contacted during implementation.
P3A-2 write workflows and the video-modal regression remain pending until the
owner provisions the isolated schema and fixtures.

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
