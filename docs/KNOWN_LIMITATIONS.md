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
baseline to five synthetic identities and 18 reset relations. P3A-2D1 adds a
database-layer subscription write authorization matrix (`staging:authz-subscriptions`),
whose first staging run exposed an `anon` EXECUTE grant drift. After the forward
ACL-hardening migration, the corrected matrix passed 24/24 and both system-only
RPC boundaries rejected `anon` and authenticated probes. Durable system-RPC
execution coverage is prepared in the current P3A-2D1 branch but remains
unmerged. Write specs for assessment save and program draft/publish remain
pending, as does all
browser-level write coverage. Workout completion additionally requires the
database gate in L12. See [RUNBOOK.md](RUNBOOK.md) and
[ISSUE_LOG.md](ISSUE_LOG.md) #13–#15.

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

## L4 — Manual payment approval exists; no payment provider is live
The provider-neutral P2B foundation now has a repository-only **P2C-1** manual
InstaPay request/approval layer above it. A coach may request a package and mark
an external transfer sent, but neither action grants access. The owner must
independently verify receipt and approve before the existing paid-period function
activates the package. This is a human step with **no automated verification**.

**No payment provider is live** — there is no Paymob/Stripe integration, SDK,
Edge Function, or provider key. The P2C-1 migration is **applied to no database**,
so even the manual request/approval layer is not live. Payments remain
webhook-authoritative in architecture, with owner approval standing in for a
future verified webhook. See root `BUSINESS_MODEL_AUTH_BILLING_PLAN.md`.

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
all currently planned write targets; P3A-2D1 added the subscription write
authorization matrix at the database layer. Its first live run denied every
unauthorized write but exposed that signed-out callers could enter the
subscription SECURITY DEFINER RPC before its internal role check. The ACL
hardening is applied to staging; the 24/24 rerun and four system-RPC boundary
probes passed. The durable system-RPC command remains unmerged. The write-flow
browser specs and the video-modal regression remain pending.

The isolated staging project lives in a **separate Supabase organization** from
production. That isolation is deliberate, but it means staging execution evidence
is owner-attested only: any agent or tool connected to the production
organization cannot see, reach, or verify the staging project. Treat reported
staging results as reported, never as independently confirmed.

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
`canWrite` in `js/subscriptionService.js` mirrors the same gap, which
`tests/unit/subscription-write-rule.test.js` pins.

## L10 — Static authenticated-fixture limitation in Playwright visual verification
Visual screenshot verification of authenticated platform shells (such as the coach dashboard, objective assessment, and programs views) uses a DOM-only static fixture in Playwright tests (`loginScreen.classList.add('hidden')`, `appScreen.style.display = 'block'`, `body.nc-bright`) without invoking Supabase, auth APIs, or live backend endpoints. Live session state rendering and database-persisted save flows still require owner manual testing in the live application.

## L11 — Staging Edge Functions are not deployed
The repository contains 11 Edge Functions plus `_shared`, but P3A-2B provisions
database schema only. Role-routing and PostgREST smoke do not need those functions.
Program generation and other flows that invoke `generate-program` remain blocked
until a separate staging function-deployment plan defines function scope, synthetic
secrets, and proof that no production key is reused.

## L12 — Inactive-client write protection: applied and verified in production
The inactive-subscription takeover prevented protected workout actions through the
normal UI only. `workout_sessions_client_own` authorized writes by client ownership
alone, and no policy in the schema referenced effective subscription state, so an
authenticated client whose access had lapsed could submit a direct PostgREST write.

`20260728010000_workout_write_subscription_gate.sql` closes this by adding
`client_has_write_access()` plus **RESTRICTIVE** INSERT/UPDATE/DELETE policies on
`workout_sessions` and `workout_exercise_logs`. Existing permissive policies are
untouched, so coach and admin paths cannot regress, and the rollback drops only
what the migration adds. `SELECT` is deliberately not gated: the locked rule is
active/grace → write, expired/pending/none → **view only**.

This gate applies to direct table INSERT/UPDATE/DELETE operations and normal
workout creation/logging paths. It deliberately does not revoke
`expire_my_stale_workout_sessions()`: that authenticated SECURITY DEFINER
maintenance RPC may mark only the caller's own already-stale active sessions as
`abandoned` (or sessions the caller may manage as staff). It cannot create a
session, add exercise logs, or grant paid-feature value. Keeping stale-session
cleanup available prevents lapsed clients from being left with permanently open
sessions; treat it as a narrow lifecycle exception, not proof that every
client-callable RPC is covered by the table policies.

The migration was applied to the isolated staging project on 2026-07-28 and is
registered as migration `20260728010000`. The authenticated database matrix passed
all 7 cases: 5 allowed and 2 denied. Active clients retained session/log writes;
coach and admin writes for a lapsed client remained allowed; lapsed-client
session/log writes were denied by RLS; and lapsed-client read access survived.
Fixture verification passed after the suite reset.

It was then applied to production on 2026-07-28 under owner approval and
registered as version `20260728010000`. Production now carries 6 RESTRICTIVE
policies and the 5 pre-existing permissive policies, with no RESTRICTIVE `SELECT`
or `ALL` policy. Database-level impersonation probes, each inside a rolled-back
transaction, confirmed a lapsed client is denied on both gated tables with
SQLSTATE `42501` while retaining read access, and that active-client, assigned-coach,
and pre-existing-session paths still write. Real authenticated smoke was not
performed; production verification was database-level only.

One production client profile has no subscription row and therefore newly loses
write access. That is the intended `none → view only` rule, it was measured
before the apply, and that client had no open active session.

Coach and admin writes on behalf of a lapsed client remain allowed — that is
existing product behavior, deliberately preserved, and is asserted by the suite so
a future change is a decision rather than an accident.

The same ownership-only pattern still exists on `daily_routine_logs`,
`progress_logs`, `phase_submissions`, `subjective_assessments`, `client_questions`,
`exercise_alternative_requests`, and the legacy `workout_logs` table. Those were
scoped out of this change; see [ISSUE_LOG.md](ISSUE_LOG.md) #17.

## L13 - Baseline function ACL fidelity audit remains pending
Fresh Supabase projects can inherit explicit function execution grants from
platform default privileges. The production schema baseline records effective
production ACLs, but some entries retain only `REVOKE FROM PUBLIC` and therefore
do not reproduce historical `anon` or `authenticated` revocations on an isolated
project. P3A-2D1 hardens the four security-critical RPCs identified at its gate:
subscription create/update, paid-package application, and global stale-workout
expiry. A dedicated inventory of all remaining function ACLs is still required.
Do not assume every baseline difference is exploitable; compare intended caller
roles and internal authorization function by function.
