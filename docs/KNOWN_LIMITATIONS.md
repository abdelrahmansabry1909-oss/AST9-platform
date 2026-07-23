# AST9 Known Limitations

> Honest, current limitations. These are tracked deliberately — they are not
> hidden defects. Update as items are resolved.

---

## L1 — Real authenticated save smoke requires owner manual testing
The agent/build environment cannot run a real authenticated browser session, so
end-to-end save flows (especially the Athletic Story / assessment saves) are
verified at the backend layer (impersonated, rolled-back SQL) and then require an
**owner manual save smoke** in the live app to confirm end-to-end. See
[ISSUE_LOG.md](ISSUE_LOG.md) #1–#2.

## L2 — Automated browser visual smoke may fail (DevTools / localhost limits)
Automated visual smoke can fail for environment reasons (no authenticated session,
DevTools-localhost constraints) — this is an environment limitation, not an app
bug. UI changes are verified by owner visual review. See [NOT_A_BUG.md](NOT_A_BUG.md) #4.

## L3 — Legal text requires final lawyer review before launch
Terms / consent / disclaimer copy is not finalized and must be reviewed by a lawyer
before any public launch. Backend persistence **is implemented**:
`legal_documents` stores version metadata, `legal_acceptances` is append-only, and
`has_accepted_current_legal()` / `record_legal_acceptance()` enforce the current
required versions server-side. This is an auditable technical foundation, not a
claim that the legal text or the product is GDPR/CCPA compliant.

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

## L8 — Browser smoke suite covers public flows only (built output)
The Playwright smoke net (P1F-1 — `tests/smoke/`, `.github/workflows/smoke-tests.yml`)
runs Chromium against the **built** bundle served at the production base `/AST9_HUB/`
(via `tests/smoke/serve-dist.mjs`), so dev-only (`vite serve`) breakage is out of
scope. **Public** specs (landing, boot router / PR#53 bounce guard, login screen,
the 6 legal pages, Sentry-boot safety) always run. **Authenticated** specs
(coach/client login) self-skip unless the `AST9_E2E_*` secrets are configured
(see [NOT_A_BUG.md](NOT_A_BUG.md) #4). Deeper scenarios — the **inactive-client
subscription gate** and the **video-modal close regression** — are deliberately NOT
automated yet: they couple to mutable/real prod data and would make CI cry wolf, so
they remain **manual smoke** until a staging-backed seeded account (non-real data)
exists.

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

## L10 — Free-tier capacity does not satisfy high-concurrency latency targets
The real staging load test reached 500 virtual users without observed 5xx/429
responses, but p95 latency rose to roughly 20 seconds at that level. Acceptable
latency was observed only around the 50-user stage. This proves functional
survival, not production scalability. Capacity work needs a paid-tier baseline,
query profiling, explicit SLOs, and a repeatable load-test gate before making
concurrency claims.

## L11 — Rate limiting, recovery, and retention controls are incomplete
Several Edge Functions use best-effort in-memory rate limits. Those counters are
per instance, so they are not a durable distributed abuse-control boundary.
Incident response and rollback runbooks exist, but there is no documented restore
drill, approved RTO/RPO, or complete data-retention/deletion schedule. These are
production-hardening gaps, not hidden completed work.

## L12 — No centralized runtime feature-flag system
The Sentry DSN has a documented kill switch, but the product has no general
feature-flag service for safely disabling risky features without a deploy. Any
future feature-flag system must be authorization-safe and must not replace
server-side access control.
