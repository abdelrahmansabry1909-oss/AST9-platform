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

**P2C-1b** moves the four self-service tiers' monthly and annual prices into a
server-side catalog, so the request RPC no longer accepts a caller-supplied
amount. The catalog stores the authoritative USD list prices and separate EGP
charge amounts. Every EGP charge ships unset and every row inactive, so the
request path refuses a tier until the owner sets and activates that tier's EGP
price.

**Applied to production 2026-08-01 under owner approval**, registered as versions
`20260803000000` and `20260804000000`. Verified at the database layer: 3 tables
with RLS enabled, 12 policies and **no DELETE policy** on `coach_payment_requests`,
5 new functions, `anon` holding **no** EXECUTE on any of them, the trigger helper
holding no EXECUTE for any API role, and exactly **one**
`request_coach_package_payment` overload — `(p_package_key text, p_months integer)`
— confirming the caller-supplied-amount signature is gone rather than shadowed.
Security advisors returned WARN only, no ERROR, and no new anon-executable
definer function. Transaction-local probes confirmed a coach requesting an
unpriced tier is refused (`package price is unavailable or inactive`) and an
anonymous caller is refused (`permission denied`), leaving no rows behind.

**Applied without a staging rehearsal**, which was an explicit owner decision.
It was acceptable for these two specifically because both migrations only create
new objects — no existing table, policy, column, or row was modified — and the
paired rollbacks drop only what was added. The same reasoning does **not** extend
to the D11 gate or the `service_role` revoke, which alter live tables and
predicates and remain unapplied pending staging.

**Nothing is requestable yet.** All eight `package_prices` rows ship with
`charge_amount_minor` NULL and `active` false, and `payment_settings` ships empty
and disabled. Until the owner sets the EGP amounts, activates the tiers, and
configures the payment link, every self-service request is refused by design. A
tier cannot be activated without an EGP amount — a table CHECK enforces it.

**No payment provider is live** — there is no Paymob/Stripe integration, SDK,
Edge Function, or provider key. Payments remain webhook-authoritative in
architecture, with owner approval standing in for a future verified webhook. See
root `BUSINESS_MODEL_AUTH_BILLING_PLAN.md`.

**Real authenticated smoke has not been performed.** Verification is
database-level only; no coach has completed a request, transfer, or approval
through the browser.

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

## L14 - The RPM timeline canvas has never had an authenticated smoke
The horizontal timeline (PR #190) was measured extensively in a real browser -
16 viewport/phase-count combinations for overlap, reachability, proportional
width, height and contrast - but the probe **injects the component's markup into
the built page**. It never signs in, never loads a real client, and never drives
the wizard. So the live path is unexercised: `_renderLadder` firing, phase click
-> popup, `+ Add phase`, the AI generate flow, and saving. Geometry and contrast
are trustworthy; the interaction path is not yet evidence-backed. One coach
session with the RPM Graph Builder open closes this.

## L15 - No gate parses the plain `<script src>` JavaScript (RESOLVED 2026-08-04)
`npm run build` only parses what is in the Vite module graph, and `test:unit`
only parses what it imports. Several shipped files are neither - they are classic
IIFEs loaded directly by `app.html`, including `js/rpm/graph-builder.js` and
`js/monitoring.js`. A syntax error in any of them passed every CI gate and
reached production as a dead feature; this happened on 2026-08-03 and was caught
only by a manual `node --check` (ISSUE_LOG #22).

**Closed by `tests/unit/html-script-parse.test.js`** (PR #192), which parses all 56 local
scripts referenced by `app.html` and `index.html` against the goal the browser
will actually use - `vm.Script` (sloppy mode) for classic tags, `node --check`
for `type="module"`. Proven by mutation: reintroducing the exact 2026-08-03
defect fails the test while `npm run build` still reports success.
**Residual gap:** this proves each file *parses*, not that it *behaves*. A
runtime error inside a correctly-parsed file is still only caught by L14's
missing authenticated smoke.

## L16 - The Sentry alert rule exists only in the dashboard
The issue alert rule (new issue -> `environment:production` -> email, 30-minute
rate limit) is live and its email delivery was verified end-to-end on 2026-08-02.
It is **not represented in this repository in any form**, so if someone deletes
or disables it, nothing here would detect that and alerting would fail silently.
Re-verifying it is a manual dashboard check. See DEV_LOG O2.

## L17 - The backup script has never produced a restore
`scripts/db-backup.mjs` is guard-verified (it refuses a non-production link, a
destination inside the repo, or a destination inside any git tree) but **no real
backup and no real restore has been performed**. A backup path that has not been
restored from is an assumption, not a recovery capability. The owner must run
`npx supabase link --project-ref <prod>`, take one backup, and restore it once.

## L18 - The popup's flip-above path is unexercised
When a phase popup would extend past the canvas bottom it flips above the block.
That branch has never fired in any measurement: the canvas is
`clamp(480px, 62vh, 760px)` and a rich popup is about 249px, so on every tested
viewport the popup fits below. It becomes reachable only when milestone or
tripwire text wraps enough to push the popup materially taller.

There is also a narrow residual: if a popup fits **neither** below nor above,
the guard `blockTopY - realH - 8 >= PADDING` correctly declines to flip, so it
stays below and the overflow is clipped by the canvas. That case is not handled
and has not been observed.

## L19 - Measuring animated UI immediately after insert reports transient values
`.nc-dgraph-editor` animates `scale(0.98) -> 1` and `.nc-dgraph-popup`
`scale(0.95) -> 1`. Reading `getBoundingClientRect` or `getComputedStyle` right
after insertion returns mid-animation numbers - a 44px control measures 43.1px,
and the popup's transform reads as `matrix(0.95, ...)`. This produced a
false-positive defect report on 2026-08-04. Any automated visual check of this
app must wait for the entry animation before asserting a size or a transform.

## L20 - The Pages artifact silently drops hidden files
`actions/upload-pages-artifact` stopped including dotfiles in v4.0.0 and the
exclusion is the default. Its v5 archive step runs

```
--exclude=.git --exclude=.github --exclude=.[^/]*
```

so **anything in `dist/` whose name starts with a dot never reaches the
deployed site**, and the build does not warn - `tar` just does not add it. The
symptom is a path that 404s on the live site while existing locally and in
`dist/`.

This is inert today: a fresh `npm run build` produces **zero** dotfiles
anywhere in `dist/`, measured 2026-08-07. It becomes live the moment the app
needs one - `.nojekyll`, or a `.well-known/` entry for domain verification or
an app-site-association file, both realistic for a SaaS.

The switch is an explicit opt-in on the upload step in
`.github/workflows/deploy.yml`:

```yaml
- name: Upload Pages artifact
  uses: actions/upload-pages-artifact@v5
  with:
    path: dist
    include-hidden-files: true   # required for .nojekyll, .well-known/, etc.
```

`.git` and `.github` stay excluded regardless of that input, so enabling it
does not leak repository internals into the deployed bundle.

**Applies once PR #149 (`upload-pages-artifact` v3 -> v5) is merged.** The
pinned v3 still includes dotfiles, so nothing is dropped before that lands.
