# AST9 Dev Log

> Chronological log of major completed phases. Dates and PR/commit values are
> verified against `gh pr list` and `git log origin/main` (Phase R0, 2026-06-27).
> Earlier rehab phases (pre-#48) are summarized in the root `FEATURE_STATUS.md`
> and `PROJECT_STATUS.md`; this log focuses on the recent program-versioning and
> Athletic Performance arc plus the active hotfixes.

Verification legend:
- **DB-verified** — migration applied to the live prod DB and RLS verified by
  transaction-local impersonation (admin/coach/client).
- **Owner visual** — frontend reviewed by the owner in the browser; no automated
  browser smoke is available in this environment (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).
- **Backend-reproduced** — payload accepted/denied confirmed against the live
  schema by impersonated, rolled-back SQL.

---

## Phase P2C — Manual payment layer applied to production

- **Date:** 2026-08-01 · branch `docs/p2c-production-applied`
- **What:** Applied `20260803000000_manual_payment_requests` and
  `20260804000000_server_side_package_prices` to the production database via MCP
  `execute_sql`, each inside its own transaction, and pinned both versions in
  `supabase_migrations.schema_migrations` so repository and database history stay
  linear.
- **Why:** The coach billing page was correct but inert — the tables existed only
  in the repository, so every self-service tier rendered "not available yet".
  Both migrations create new objects only and modify no existing table, policy,
  column, or row, so the owner approved applying them without a staging
  rehearsal. That reasoning is specific to these two and does not extend to the
  D11 gate or the `service_role` revoke.
- **Pre-flight:** confirmed the three target tables absent, the `payment_events`
  and `apply_paid_coach_package_period_system` dependencies present, no existing
  `request_coach_package_payment`, neither version pinned, and — because plpgsql
  bodies are not validated at CREATE time — that every `notifications` column the
  RPCs insert exists and that the `severity` CHECK admits `info` and `warning`.
- **Verification:** 3 tables with RLS, 12 policies, 0 DELETE policies on
  `coach_payment_requests`, 5 functions, 0 `anon` EXECUTE, 0 `authenticated`
  EXECUTE on the trigger helper, exactly one `request_coach_package_payment`
  overload with the 2-argument signature, 8 price rows with EGP unset and all
  inactive, and security advisors returning WARN only with no ERROR.
  Transaction-local probes confirmed an unpriced-tier request and an anonymous
  call are both refused, leaving no rows behind.
- **Verification boundary:** Database-level only. **Real authenticated smoke was
  not performed** — no coach has completed a request, transfer, or approval
  through the browser. Nothing is requestable until the owner sets the eight EGP
  amounts, activates the tiers, and configures the payment link.

---

## Phase P2C-1b — Server-side package prices

- **Date:** 2026-08-01 · branch `feat/p2c1b-server-side-package-prices`
- **What:** Added an authenticated-readable, admin-written package-price catalog
  for the four self-service tiers and the monthly/annual durations. USD list
  prices match the public catalog, while all EGP charge amounts ship unset and
  inactive. Replaced the caller-priced request RPC with a two-argument RPC that
  resolves an active EGP charge on the server and returns both charge and list
  amounts. The unsafe four-argument overload is explicitly dropped.
- **Why:** A coach could supply an arbitrary amount through PostgREST, causing the
  request and eventual payment ledger to record a payer-chosen figure even though
  owner approval remained manual.
- **Verification boundary:** Repository database layer and offline static tests
  only. No frontend was changed, no database was accessed, and the migration is
  applied to no database. The request path refuses every tier until the owner sets
  and activates its EGP price.

---

## Phase P2C-1 — Manual InstaPay payment requests (database layer)

- **Date:** 2026-08-01 · branch `feat/p2c1-manual-payment-requests`
- **What:** Added an owner-editable disabled-by-default payment-instructions row,
  coach payment-request audit records, a locked coach sent-for-review transition,
  and owner-only approval/rejection RPCs. Approval alone calls the existing
  provider-neutral paid-period function with a deterministic manual event ID.
  Registered all five new functions in the repository ACL manifest. The update
  guard remains `SECURITY INVOKER` with no direct EXECUTE grant because PostgreSQL
  invokes trigger functions as part of the table statement.
- **Why:** Coaches can request and report an external InstaPay transfer without
  gaining package access; the owner must independently verify receipt and approve.
- **Verification boundary:** Repository database layer only. No frontend or
  provider integration was added, no automated transfer verification exists, and
  the migration is applied to no database.

---

## Fix — Service-lane default (Rehab / Athletic shells rendered together)

- **Date:** 2026-08-01 · branch `fix/service-lane-default`
- **What:** Declared the default service lane in the markup
  (`<body class="service-rehab">`) and added
  `tests/unit/service-lane-default.test.js` to lock the lane contract.
- **Why:** Every lane visibility rule is scoped under `body.service-rehab` /
  `body.service-athletic`. With a bare `<body>` no rule applied, so both shells
  rendered together for coaches and admins — permanently on any path where the
  profile load did not reach `setService('rehab')`. See
  [ISSUE_LOG.md](ISSUE_LOG.md) #19.
- **Verification boundary:** Cascade measured in Chromium against the real
  stylesheets and nav markup; the bug reproduces without the class and resolves
  with it. Full-page browser verification was not possible because `app.html`
  bounces unauthenticated visitors to `index.html`. **Real authenticated smoke
  was not performed.** No CSS file, database, or production system was touched.

---

## Phase T2 — Subscription write-rule behavioral coverage

- **Date:** 2026-08-01 · branch `test/t2-subscription-write-rule`
- **What:** Added offline behavioral coverage for the browser subscription
  service's write decision, fail-soft state reads, pill boundaries, defensive
  filtering, status vocabulary, and the latent `cancelled` boundary. The write
  agreement test derives the database-allowed statuses from the migration and
  asserts that the JavaScript gate makes the same decision.
- **Why:** Nearly all prior unit coverage was static drift guarding, while this
  consequential client behavior had no tests and its single write rule is
  implemented twice, in JavaScript and SQL.
- **Verification boundary:** No application source or SQL was modified, no
  database was accessed, and no test asserts anything about production state.

---

## Phase O1 — Observability alerting

- **Date:** 2026-08-01 · branch `feat/o1-observability-alerting`
- **What:** Wired the existing privacy-scrubbed frontend monitoring helper into
  selected workout, program-publishing, and daily-routine write failures; fixed
  unreachable ops-health status capture; and added an offline regression guard
  for literal-only call-site arguments, privacy markers, live call sites, and the
  workflow capture form.
- **Why:** Handled persistence failures were invisible to the owner, and curl's
  fallback appended a second `000`, bypassing the workflow's intended
  unreachable-endpoint diagnostic.
- **Verification boundary:** No Sentry alert rule was configured, no Sentry
  dashboard was accessed, no database was accessed, and no production system
  was touched.

---

## Phase D1 — Disaster recovery objectives and restore-drill procedure

- **Date:** 2026-08-01 · branch `docs/d1-disaster-recovery`
- **What:** Added a disaster-recovery runbook with an explicit unverified-status
  banner, recovery inventory, proposed owner-approved RPO/RTO, owner backup
  coverage checklist, and an isolated-staging restore drill. Linked it from the
  incident-response rollback section and the migration rollback inventory, and
  added it to the repository map.
- **Why:** The rollback inventory directs `irreversible-by-design` incidents to
  restore from backup or fix forward, while the incident-response documentation
  provided no way to locate, verify, or exercise a recovery source.
- **Verification boundary:** Documentation only. No backup was verified, no
  restore was performed, and no database was accessed. Backup presence, scope,
  retention, integrity, and restore capability remain open owner checks.

---

## Phase S3 — CI supply-chain hardening

- **Date:** 2026-08-01 · branch `security/s3-supply-chain-hardening`
- **Live finding:** `ws@8.20.0` sat in the **production** dependency tree via
  `@supabase/supabase-js` → `@supabase/realtime-js`, carrying two high-severity
  advisories (uninitialized memory disclosure; memory-exhaustion DoS). Nothing in
  CI would ever have surfaced it — there was no dependency audit, no Dependabot,
  no scanning of any kind. It was found by hand.
- **Exposure, stated honestly:** `ws` is used by realtime-js only under Node;
  browsers use the native WebSocket, so the deployed static bundle almost
  certainly never shipped it. The real exposure was the Node-side staging test
  tooling. Important, not urgent.
- **Fix:** `npm audit fix --package-lock-only` → `ws` 8.20.0 → 8.21.1.
  `package-lock.json` only; **no declared dependency changed**. Two Vite
  build-chain transitives were refreshed in the same pass within their existing
  semver ranges and were not themselves flagged: `nanoid` 3.3.12 → 3.3.16 and
  `postcss` 8.5.14 → 8.5.25. Because those affect the build, the production build
  and the public smoke suite were re-run after the bump.
- **Gate:** new `audit:ci` script (`npm audit --omit=dev --audit-level=high`)
  runs in both the deploy `Verify` job and the pull-request smoke job, from a
  single script so there is one source of truth.
- **Threshold decision:** high/critical in production dependencies blocks. Dev-only
  advisories do not block a static-bundle deploy, and failing on every moderate
  transitive advisory with no available fix would create a broken-build treadmill.
- **Dependabot:** `.github/dependabot.yml` covers npm and github-actions weekly.
  The actions ecosystem is included deliberately — every action is pinned to a
  mutable major tag (`@v4`), so a repointed tag would execute in CI.
- **Verified by negative control:** restoring the vulnerable lock file makes
  `audit:ci` exit 1; the fixed lock exits 0.
- **Deliberately out of scope:** pinning actions to commit SHAs and bumping the
  deprecated `checkout@v4` / `setup-node@v4`. Both need network lookups to verify
  SHAs and version existence; Dependabot now proposes them, which is the durable
  fix.
- **Scope:** dependency lock, CI configuration, and documentation only. No
  application source, schema, migration, or production change.

---

## Phase P3A-2H Stage A — Function ACL inventory and parity guard

- **Date:** 2026-07-30 · branch `test/p3a-2h-function-acl-guard`
- **What:** Added an inventory-complete ACL manifest for every effective public
  function signature: 46 decisions are approved and 5 remain provisional (the
  role predicates). Provisional entries carry per-role recommendations,
  explicitly block remediation, and remain pending owner decision. The offline unit guard reconstructs the inventory from the
  baseline plus ordered migrations, including signature normalization and
  `DROP FUNCTION` handling, validates the decision and grant structure, and pins
  all 51 ACL contracts with a deterministic SHA-256 fingerprint.
- **Why:** New public functions can retain unintended API execution, and the
  baseline snapshot cannot by itself prove the intended caller contract.
- **Owner decision (2026-07-30):** The three trigger helpers were promoted from
  provisional to approved, leaving **46 approved and 5 provisional**. Evidence was
  conclusive: each is reached only through `CREATE TRIGGER ... EXECUTE FUNCTION`
  with no application or edge caller, and PostgreSQL does not require the DML user
  to hold EXECUTE on a trigger function. The ACL contract fingerprint is unchanged
  by the promotion, proving no pinned grant moved — only governance status did.
  The five role predicates stay provisional on the single `service_role` question.
- **Scope:** Tests, manifest, and documentation only. No ACL, schema, or
  migration changed, and no database was accessed; production parity
  verification remains a separately approved later stage.

---

## Phase T1 — Unified test gate and orphaned-test guard

- **Date:** 2026-07-30
- **What:** Added `test:unit` as the complete unit suite, added `npm test` as the
  single local gate for the full unit suite, production build, and public smoke,
  and changed both deploy and pull-request smoke workflows to run the complete
  unit suite.
- **Why:** `scoring-engine-composite.test.js` was orphaned from every npm script,
  and there was no aggregate command for verifying the whole project.
- **Guard:** A manifest unit test compares every `tests/unit/*.test.js` file on
  disk with the files named by `test:unit`, failing on either an unwired test or
  a stale script entry.

---

## Phase CI-1 — Isolated staging authorization CI wiring

- **Date:** 2026-07-30
- **What:** Added a manually dispatched, serialized, least-privilege workflow
  that validates, seeds, verifies, and runs all four staging authorization
  matrices before an always-run fixture reset. The authenticated smoke workflow
  now supplies the mandatory unassigned-client fixture pair.
- **Why:** The authorization suites had no CI entry point, and authenticated
  smoke would otherwise fail its five-role fixture contract after staging
  configuration because the unassigned-client credentials were not wired.
- **Owner action required:** The workflow cannot run until the owner configures
  all repository variables and secrets listed in the RUNBOOK staging CI section,
  and the isolated staging Supabase project must be active.
- **Scope:** Workflow and documentation only. No secret values, application
  source, database files, or production configuration changed.

---

## Phase P3A-2F — Client write subscription gate

- **Date:** 2026-07-30 · branch `feat/p3a-2f-client-write-gate`
- **What:** Committed a paired migration and rollback adding 21 RESTRICTIVE
  INSERT/UPDATE/DELETE policies across the seven ownership-only client-write
  tables. The policies reuse `client_has_write_access(uuid)`, preserve staff
  paths with null-safe `IS DISTINCT FROM`, and deliberately leave SELECT
  unchanged. Offline tests pin the complete policy and rollback shape.
- **Deployment:** The migration is committed but **NOT applied to any database**
  in this phase. Applying it is a separately approved step.
- **Verification:** `test:unit:staging-safety`, production build, and whitespace
  checks only; no live or staging database command was run.
- **Remaining:** Apply to isolated staging under separate approval, capture the
  catalog and authenticated-matrix proof, then seek separate approval for any
  production apply.

---

## Phase P3A-2E — Client write authorization expectation matrix

- **Date:** 2026-07-30 · branch `test/p3a-2e-client-write-authz`
- **What:** Added a non-secret expectation manifest, offline matrix guards, scoped
  fixture cleanup, and authenticated staging cases for client writes on
  `daily_routine_logs`, `phase_submissions`, `subjective_assessments`,
  `exercise_alternative_requests`, `progress_logs`, `client_questions`, and the
  legacy `workout_logs` table. The matrix pins lapsed-client write denials,
  active-client and staff write access, and lapsed-client read access.
- **Scope:** Tests and test documentation only. This phase writes no migration,
  SQL, RLS policy, database function, or application code.
- **Verification:** `test:unit:staging-safety`, production build, and whitespace
  checks. The new `staging:authz-client-writes` command is **EXPECTED to fail**
  until the gating migration exists; it was not run in this tests-only phase.
- **Remaining:** Write and independently review the gating migration, re-confirm
  the live policy set against the real database, then run the authenticated
  staging matrix.

---

## Phase P3A-2A — Deterministic staging fixture foundation

- **Date:** 2026-07-26 · branch `codex/p3a-staging-fixture-foundation`
- **What:** Added local `validate`, `seed`, `verify`, and `reset` commands for
  stable synthetic admin, coach, active-client, and inactive-client staging
  fixtures. Seed reconciles auth users, profiles, legal acceptance, coach package,
  and deterministic subscription states, replacing only the two fixture clients'
  subscription rows through the shared UUID guard. Reset removes only assessment,
  RPM, program-version, and workout rows scoped to those same client UUIDs, then
  restores and verifies the baseline.
- **Safety:** Every mutation independently rejects the production project, requires
  a staging service-role key distinct from the anon key, requires exact project-ref
  confirmation, validates a six-character synthetic marker in each email local
  part, rejects duplicate fixture emails, and refuses empty or invalid UUID
  filters. Auth users are never deleted and sensitive values are redacted.
- **Smoke correction:** The authenticated harness now targets the exact sign-out
  control and expects the client-specific dashboard section for active clients.
- **Scope:** Test tooling, package scripts, ignore rules, and control documentation
  only. No app code, schema migration, RLS, Edge Function, billing, Paymob, scoring,
  or visual change.
- **Verification:** Offline contract tests, staging-target safety tests, JavaScript
  syntax checks, public Playwright smoke, production build, and whitespace check.
- **Remaining:** Owner must create an isolated schema-complete staging project,
  configure credentials locally/repository secrets as appropriate, run
  `staging:seed` and `staging:verify`, then authorize P3A-2 write-flow browser tests.

---

## Phase P3A-1 — Authenticated staging safety foundation

- **Date:** 2026-07-26 · branch `codex/p3a-authenticated-production-verification`
- **What:** Replaced the credential-only authenticated browser smoke contract with
  a staging-isolated harness. It validates a non-production Supabase URL, requires
  synthetic identity markers, rewrites only the local built Supabase-bearing
  scripts in memory, blocks production Supabase HTTP and WebSocket endpoints,
  requires the locally built frontend, and adds admin/coach/active
  client/inactive-client/logout routing checks. Partial configuration fails closed;
  completely absent staging configuration skips cleanly.
- **Privacy:** Authenticated trace, screenshot, video, and persisted storage state
  remain disabled. CI does not upload Playwright reports or test-results. No
  credentials, tokens, staging URLs, or real user data are committed.
- **Scope:** Test/CI/runbook/control documentation only. No production app, schema,
  RLS, edge function, billing, Paymob, scoring, or frontend visual change.
- **Verification:** staging-target safety unit tests; authenticated Playwright test
  discovery; public Playwright smoke; production build; `git diff --check`.
- **Remaining:** Provision the isolated Supabase staging project and synthetic
  fixtures, configure repository variables/secrets, then implement deterministic
  seed/reset plus P3A-2 write-flow coverage.

---

## Porcelain Emerald Platform Visual Redesign

### Porcelain Emerald Visual Redesign & Compliance Cleanup
- **Date:** 2026-07-26 · branch `feat/porcelain-emerald-platform-redesign`
- **What:** Completed the Porcelain Emerald platform visual redesign and compliance cleanup across landing, login, and application shell:
  1. Replaced all 5 remaining `material-symbols-outlined` text icon spans with 100% native inline SVGs, eliminating font-load dependencies.
  2. Applied compliance copywriting cleanup across `index.html` and `app.html` (removed HIPAA, SOC2, bank-grade, Vance/Jenkins/Apex, and patient bounce-back claims).
  3. Repaired `index.html` section HTML hierarchy and replaced legacy subtitle with "Movement Intelligence Workspace".
  4. Restructured mobile bottom navigation into a 64px fixed horizontal row with role-accurate navigation items (`Home`, `Session`, `Community`, `Programs`).
  5. Refined Objective Assessment layout for mobile viewports (`max-width: 768px`) using vertical flex stacking to eliminate 320px grid overflow.
  6. Corrected desktop landing hero sizing at `1440px` (`min-width: 1025px`), ensuring primary CTAs fit inside the first viewport.
  7. Implemented desktop collapsible slim sidebar under `body.nc-bright:not(.nc-client) .sidebar` (64px collapsed with centered 44px active pills and centered icons; 260px expanded on hover with 0 text clipping and zero main content shift).
- **Files:** `app.html`, `index.html`, `css/landing.css`, `css/neucore-design-system.css`, `css/neucore-premium.css`, `css/styles.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`, `docs/ISSUE_LOG.md`, `docs/KNOWN_LIMITATIONS.md`.
- **Verification:** `git diff --check` clean. `npm run build` green. `npx playwright test tests/smoke/public.spec.ts` 11/11 passed in 20.9s. Complete 5-stage visual verification suite executed with Google Fonts blocked.

---

## NeuCore movement scoring

### Gait Simulation Loop & Simulator Shell Polish
- **Date:** 2026-07-12 · branch `feat/gait-loop-and-simulator-shell-polish`
- **What:** Refined the NeuCore Movement Simulation to fix gait animation jumps/reversals and polish the simulator shell:
  1. Cyclic phase interpolation between the last frame (`terminal_swing`) and first frame (`loading_response`) for a seamless animation loop.
  2. Treadmill root motion centered in the viewport with depth position.z = 0 and yaw rotation.y = 0.
  3. Frame-delta clamp (`Math.min(rawDt, 0.05)`) and explicit RAF handle ownership to prevent frame skips and duplicate RAF chains.
  4. Scoped simulator styling under `#neucore-gait-container` using the bright porcelain/emerald theme, removing global CSS leaks and removing `!important` from the gait toolbar display declaration.
  5. Refactored the phase timeline strip to use clean semantic selectors and highlight active (emerald), moderate (amber), and severe (red) states.
  6. Implemented a horizontal worst-phase card rail on mobile (< 480px) with scroll snapping, hidden connector lines, and zero card overlaps.
  7. Corrected the Stop click handler during analysis to clear the overlay, reset bones to neutral, and restore the overview camera.
  8. Integrated with the non-recursive ScoringEngine and verified legacy composite score remains at `82.2%`.
- **Files:** `css/neucore-premium.css`, `src/neucore/gait/GaitAnalysisPage.js`, `src/neucore/gait/GaitPhaseStrip.js`, `src/neucore/gait/PhaseAnalysisOverlay.js`, `src/neucore/simulation/MovementSimulator.js`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`, `docs/ISSUE_LOG.md`.
- **Verification:** Built successfully (`npm run build`). Verified the 17-point regression checklist using a Playwright script: no overlapping cards, no horizontal document overflow at 390px/375px, Stop/Resume transitions work correctly, and all six unit tests pass.

### Fix — recursive composite score ("Score unavailable")
- **Date:** 2026-07-12 · branch `fix/neucore-scoring-composite-recursion`
- **What:** `ScoringEngine.fullScores()` ⇄ `_composite()` recursed infinitely
  (`RangeError`), which `GaitAnalysisPage` caught and rendered as "Score
  unavailable" in the Movement Simulation. Fixed by computing the four component
  scores **once** in `fullScores()` and passing them into a non-recursive
  `_composite(rom, control, force, neurology)` (default params preserve the
  arg-less `phaseRecommendation()` call). The arithmetic mean, null filtering,
  every normalization value, the phase thresholds, field names, weights, and
  recommendations are all **unchanged**.
- **Files:** `src/neucore/scoring/ScoringEngine.js`,
  `tests/unit/scoring-engine-composite.test.js` (new), `docs/ISSUE_LOG.md` (#7).
  No DB/RLS/auth/CSS/HTML/program-generation change.
- **Verification:** `node --check`; `node --test` (6/6 pass — no-recursion,
  normative-finite, null-filtering mean, empty case, phase thresholds 80/60/40 +
  referral, numeric-for-Movement-Simulation); `npm run build` green;
  `git diff --check` clean. Owner visual confirm of numeric scores in the live
  Movement Simulation pending.
- **Discovered (deferred):** `'Insufficient data'` is currently unreachable because
  `_neurologyScore()` returns 0 (not null) with no balance data (`null - 0 → 0`) —
  a clinical-algorithm change, out of scope for this fix. See
  [ISSUE_LOG.md](ISSUE_LOG.md) #7.

---

## Client access subscriptions

### Phase A — Admin/coach subscription management
- **Date:** 2026-07-10 · branch `feat/client-subscription-management`
- **What:** An admin **or the client's assigned coach** can now create/edit a
  client access subscription (custom label `plan_name`, custom months 1–60,
  dates, notes, active/pending status) via two `SECURITY DEFINER` RPCs —
  `create_client_subscription()` and `update_client_subscription()` — that check
  `is_admin() OR profiles.assigned_coach = auth.uid()` in SQL. **Table RLS is
  unchanged** (direct writes stay admin-only via `subscriptions_admin_write`);
  coaches never write the table directly. Widened the old `plan IN (3,6,12)`
  CHECK to `plan BETWEEN 1 AND 60`, added an `end_date > start_date` CHECK, and a
  `plan_name` column (≤80 chars). Manual client-access management — no payment
  provider; unrelated to `coach_subscriptions` billing/slots.
- **Files:** `supabase/migrations/20260710000000_client_subscription_management.sql`,
  `supabase/rollbacks/20260710000000_client_subscription_management_down.sql`,
  `js/subscriptionService.js`, `js/subscriptions.js`, `app.html` (subscription
  modals + New-Subscription button role).
- **Verification:** DB-verified — impersonated, rolled-back role matrix
  (admin ✓, assigned coach ✓, other coach ✗, client ✗, months-range ✓,
  plan_name persist ✓, direct coach table write blocked by RLS ✓; zero test
  rows left). Advisor `0028`/anon clean (explicit anon `EXECUTE` revoked,
  matching `reactivate_subscription`). `node --check` + `npm run build` green;
  boot smoke: modal fields present, no console errors. Owner authenticated
  smoke pending (no creds in this environment).
- **Secondary review (Fable 5, advisory) + fixes:** Fable flagged a **blocker**
  and a **major** that Claude confirmed against local evidence and fixed in the
  same PR:
  - `update_client_subscription` originally accepted `status='cancelled'`, but
    `v_client_subscription_state` (in `20260530202308_subscription_grace.sql`)
    has **no `cancelled` branch** → a future-dated cancelled row read as
    `active` and kept write access. Fix: **drop `cancelled`** from the accepted
    statuses (it was never offered in the UI; the effective-state view is left
    untouched — the latent gap is now unreachable and logged in
    [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).
  - Coach could set `expired`/`cancelled` via the edit RPC (End is admin-only).
    Fix: **only an admin may set `expired`**; coaches are limited to
    active/pending (RPC-enforced; the `es-status` picker hides `expired` for
    non-admins).
  - Minor fixes folded in: derive the create end-date **after** the range check
    (friendly error, not date-overflow); require the target to be `role='client'`;
    cap `notes` at 2000 chars; add the missing `.select()` honesty guard to
    `activate()`. Re-verified (real non-admin coach: create ✓, update
    active/pending ✓, set-expired ✗, set-cancelled ✗, foreign client ✗; admin
    expire ✓; months-overflow → friendly ✓; non-client target ✗; zero rows left).

---

## Program versioning

### Phase B — Edit Current Program (coach workflow)
- **Date:** 2026-07-11 · branch `feat/edit-current-program`
- **What:** Gave coaches an obvious **Edit Current Program** button on the active
  program card that clones the client's active published version into a draft and
  opens the existing `ProgramPublish` editor — it never mutates
  `client_programs.program`. Split the old, misleadingly-named `createNewDraft`
  (which silently cloned the latest program) into two clear paths:
  `editCurrentProgram(clientId, activeVersionId)` (clone active → draft, with a
  dup-guard that reopens an in-progress edit draft instead of spawning duplicates)
  and `createBlankDraft(clientId)` (blank scaffold — "**Build New Program**";
  confirms before a second concurrent draft). Save = draft only (`_saveDraft`);
  Publish still routes through the atomic `publish_program_version()` RPC
  (supersede prior active + update the single `client_programs` pointer + append a
  `client_program_revisions` snapshot). `duplicateAsDraft` retained for the
  History "Revise as Draft" action. A shared `_createDraftVersion` helper de-dups
  the insert logic.
- **Files:** `js/dashboard.js` only (product logic). **No** `programPublish.js`
  change (the editor already saved-draft/published correctly); **no** `app.html`
  change (reused `modal-program-edit`).
- **DB/RLS:** **none — no migration.** Reused the existing `client_program_versions`
  RLS (`cpv_write` = admin/assigned-coach; `cpv_select` exposes only the client's
  active-published version, hiding drafts) and `publish_program_version()` authz
  (`is_admin() OR coach_id=self OR assigned_coach=self`).
- **Verification:** `node --check` (`dashboard.js`, `programPublish.js`) +
  `npm run build` green; boot smoke (new fns wired, `createNewDraft` gone, no
  console errors). **Product-safety matrix — impersonated, rolled back, zero rows:**
  client insert draft ✗, client sees draft = 0 rows, client self-publish = 0 rows
  changed, client publish via RPC ✗, assigned coach insert draft ✓ (rows=1), other
  coach foreign draft ✗. Owner authenticated UI smoke pending (no creds in env).

### E1b-1 — Program versions foundation
- **Date:** 2026-06-24 · **PR #59** · merge `5f9ccc6` (`e769acd`)
- **What:** New `client_program_versions` table + RLS (client served due-only,
  `effective_from <= now()`, no client write) + `resolveClientProgram` serving
  overlay. Inert until live DB migrated.
- **Files:** `supabase/migrations/20260624000000_client_program_versions.sql`,
  rollback, `js/clientProgram.js`.
- **Verification:** DB-verified.

### E1b-2 — Coach edit-upcoming scheduling
- **Date:** 2026-06-24 · **PR #60** · `8ea4034`
- **What:** Coach UI to schedule an upcoming program version by effective date.
- **Files:** program builder/publish JS + `app.html`.
- **Verification:** Owner visual.

---

## Athletic Performance lane

### F1 — Athletic service shell
- **Date:** 2026-06-25 · **PR #61** · `97000e4`
- **What:** Service-switcher shell adding the "Athletic Performance" lane as a
  `body`-class axis (`service-rehab` / `service-athletic`) orthogonal to role.
- **Files:** `app.html`, `js/dashboard.js`, CSS.
- **Verification:** Owner visual.

### F2 — Athletic assessment foundation
- **Date:** 2026-06-25
- **PR #62** (`d1d86c6`) — assessment foundation schema: `athlete_profiles`,
  `assessment_batteries`, `athlete_assessments`, `athlete_test_results` + RLS +
  `tg_athletic_touch()`.
- **PR #63** (`7e77b6f`, F2B-Fix) — add assessment indexes; tighten battery RLS
  (default-battery write rule).
- **PR #64** (`cb671e6`) — assessment UI foundation (`js/athleticService.js`, `app.html`).
- **PR #65** (`de3a2d5`) — normalize assessment save payloads.
- **Files:** `supabase/migrations/20260625000000_*`, `20260625010000_*`, JS/HTML.
- **Verification:** schema DB-verified; UI Owner visual.

### F3 — Movement observations
- **Date:** 2026-06-25 → 2026-06-26
- **PR #66** (`904f157`, F3B) — `athletic_movement_observations` table (child of
  `athlete_assessments`): 28 cols, 10 movement domains, 16 finding tags
  (`<@` controlled vocabulary), canonical lowercase `side`, **no scoring/norms/ML**.
- **PR #67** (`dcb67dd`, F3B-Hardening) — close inherited client self-stamp RLS
  hole: gate every owning/assigned-coach write branch behind
  `public.is_coach_or_admin()` across 5 athletic tables (7 policies).
- **PR #68** (`7786dba`) — movement observations UI.
- **Files:** `supabase/migrations/20260625020000_*`, `20260625030000_*`,
  matching rollbacks, JS/HTML.
- **Verification:** schema + hardening **DB-verified** (client self-stamp insert
  denied `42501` on all 5 tables; coach/admin writes preserved; client reads 0);
  UI Owner visual.

### Athletic save hotfixes (#69–#71)
- **PR #69** — *align save payloads with schema* — 2026-06-26 · `db046a1`.
  Column/JSONB/enum alignment for `saveAthleteStory` / assessment save.
  Files: `app.html`, `js/athleticService.js`. Backend-reproduced.
- **PR #70** — *use valid assessment status* — 2026-06-27 · `71897f2`.
  `status` must be `draft|final` (CHECK); frontend was sending `completed` → now `final`.
  Files: `js/athleticService.js`. Backend-reproduced.
- **PR #71** — *align best-of payload and cache bust* — 2026-06-27 · `6c4f110`.
  `best_of` column is `integer`; frontend sent a boolean (`42804`). Fixed to
  `best_of: isBest ? 1 : 0` and read site `.eq('best_of', 1)`; **bumped cache
  token** `js/athleticService.js?v=20260625a → ?v=20260627a` so clients re-fetch.
  Files: `app.html`, `js/athleticService.js`. (Implements the backend save-failure
  diagnostic recommendation.) Backend-reproduced.
  > **Open item:** real authenticated owner browser save smoke still pending — see [ISSUE_LOG.md](ISSUE_LOG.md).

### R1A — Lock Athletic Performance preview
- **Date:** 2026-06-27 · **PR #72** · `5e9f2e5`
- **What:** Gate the Athletic lane to `admin` only. `switchService('athletic')` for
  a non-admin opens `modal-athletic-locked` and resets to Rehab; `showSection`
  blocks all `ATHLETIC_SECTIONS` for non-admins; coach switcher label becomes
  `Performance 🔒`.
- **Files:** `js/dashboard.js`, `app.html`, `css/neucore-premium.css`.
- **Verification:** Owner visual.

---

## Phase R0 — Documentation & repo-control baseline
- **Date:** 2026-06-27 (this phase)
- **What:** Create the `docs/` control-baseline doc set (this file + 7 others).
  Documentation only — no app/source/migration/RLS/auth changes.
- **Files:** `docs/*.md` (new).
- **Verification:** N/A (docs only).

---

## Phase P-FE-3 — Royal NeuCore Redesign
- **Date:** 2026-07-10
- **What:** Rebuilt the NeuCore login page to implement a premium split-screen design, and updated the landing page. The visual identity of both pages was redesigned to follow the new Royal NeuCore system (midnight navy bases, soft gold accents, ivory text, and subtle sapphire secondary glows). This includes a left hero column with an illustrative mock telemetry panel, a centered login card, a transition of CTA colors to gold, and preservation of the mock telemetry disclaimer and hidden-state safety.
- **Files:** `app.html`, `index.html`, `css/landing.css`, `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`.
- **Verification:** Computed display validated (visible = `block`, hidden = `none`), viewports (390px) checked, no console errors, and Vite build passes.

### Mobile Navbar Responsive Cleanup (P-FE-3 Follow-up)
- **Date:** 2026-07-11
- **What:** Fixed a mobile responsive overflow issue where the "Explore Platform" nav CTA was overflowing the viewport on narrow screens (e.g. 375px). Modified the landing page layout to hide the primary navbar CTA on mobile devices (width <= 480px) to prevent layout breakages while keeping the "Sign In" button fully visible and reachable.
- **Files:** `css/landing.css`, `docs/DEV_LOG.md`.
- **Verification:** Built successfully (`npm run build`), captured desktop and mobile screenshots (390px/375px), verified zero horizontal overflow, and confirmed Sign In button is fully reachable.

### Logged-in Dashboard Porcelain Emerald Visual Polish & Readability Fix
- **Date:** 2026-07-11 · branch `feat/porcelain-emerald-dashboard-polish`
- **What:** Redesigned the authenticated dashboard and platform shell components (sidebar, topbar, cards, tables, inputs, and quick action panels) to a premium Porcelain Bright Royal visual theme with Luxurious Emerald brand accents. Fixed the container opacity issue by ensuring all main grid/panel/content containers evaluate to computed opacity of `1`. Corrected the Objective Assessment numerical result inputs by styling them with high-contrast text (`#071326`) on a pure white background (`#FFFFFF`), clear placeholder text (`#6B7585`), robust focus states, and a fixed height of `42px` to eliminate vertical text clipping. Polished the assessment workspace layout using ivory-backed cards, deep navy headers, and refined padding.
- **Files:** `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`.
- **Verification:** Built successfully (`npm run build`), updated the Playwright assertions script to navigate, select, and expand the accordion zones of the Objective Assessment workspace, typed test values (`12`, `45`, `90`), asserted computed color and opacity values (computed opacity `1`, text color `rgb(7, 19, 38)`), and generated screenshots (`objective_assessment_emerald.png` and other page layouts). All checks passed with zero console errors.

### FitExpert-Inspired Porcelain Emerald Dashboard Polish
- **Date:** 2026-07-11 · branch `feat/fitexpert-dashboard-reference-polish`
- **What:** Refined the authenticated app shell, sidebar, header, and dashboard components using the FitExpert dashboard structure as a style reference. Applied a flat, clean SaaS theme with bright porcelain canvas (`#F8F9F9`), crisp white panels (`#FFFFFF`), very high-contrast comfortable typography (`#181C32` primary text, `#4B5565` secondary text, `#7E8299` muted text), and flatter card borders (`rgba(24, 28, 50, 0.06)`) and flat shadows while retaining AST9's medical emerald accents selectively.
- **Files:** `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`.
- **Verification:** Built successfully (`npm run build`), ran Playwright visual verification asserting container opacities evaluate to `1` and filled Objective Assessment inputs are fully visible and not clipped.

### FitExpert-Inspired Dashboard Layout & Sidebar Polish
- **Date:** 2026-07-11 · **PR #120** · merge `be4a72a`
- **What:** Reorganized the authenticated dashboard layout and sidebar to match the FitExpert dashboard structure while preserving the porcelain-emerald theme. Restored a clear "Dashboard" page header. Refined the first fold to feature a wide welcome card with integrated workflow steps on the left and a compact Client Overview roster card on the right. Moved the KPI row below the first fold and simplified its card styles to be flat. Expanded the desktop sidebar to a wider (`220px`), non-collapsing sidebar displaying text labels next to icons. Polished general cards and Objective Assessment cards to use thin borders (`rgba(24, 28, 50, 0.06)`), minimal shadows, and cleaner section spacing.
- **Files:** `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`, `app.html`.
- **Verification:** Built successfully (`npm run build`), ran Playwright visual checks asserting welcome cards, wide sidebar width (220px), client roster placement, and input fields remain fully functional and visible.

### Objective Assessment Visual Polish
- **Date:** 2026-07-12 · branch `feat/objective-assessment-visual-polish`
- **What:** Polished the Objective Assessment tab to improve input box readability, range slider controls, and body map presentation in bright/porcelain mode. Specifically:
  1. Restored the joint editor pain slider gradient background (green -> yellow -> orange -> red -> dark red) and premium white/emerald-bordered thumb by resolving broad input override rules.
  2. Hidden the side zone rail chips (`#zone-rail`, `.zone-rail`, `.zone-chip`) next to the 3D skeleton to present a clean, unboxed anatomy model.
  3. Optimized input boxes (`.form-input`, `input[type="number"]`, `select`) in the Objective tab to use a centered layout, height of `44px`, font-size of `14px`, font-weight `600`, and compact `8px 10px` padding to prevent typed values from clipping.
  4. Enforced a minimum width of `480px` on hip and shoulder tables with card-level horizontal scrolling (`overflow-x: auto`) to prevent grid column compression on narrow screens.
- **Files:** `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`.
- **Verification:** Built successfully (`npm run build`), ran visual assertion tests verifying inputs/sliders, hidden rails, wide layout constraints, and zero console errors.

### Generate Page Movement Analysis Step & Simulator Styling
- **Date:** 2026-07-12 · branch `feat/generate-movement-analysis-step`
- **What:** Refactored the assessment analysis flow on the Generate tab to separate the movement quality scores and 3D simulation analysis from automatic/manual program generation.
  1. Added a dedicated `#movement-analysis-btn` button (visual style managed in `css/neucore-premium.css`) before program creation actions to trigger analysis independently.
  2. Refactored the analysis launch code into a reusable `runMovementAnalysis()` function, and wired it to dedicated analysis, auto-generate, and manual-build buttons.
  3. Added assessment signature tracking (`window._lastMovementAnalysisSignature`) using active client ID + assessment values. If data has changed, clicking Generate or Build Manually automatically recalculates and refreshes the analysis first.
  4. Redesigned the Movement Simulation panel (`.gait-page`, sub-panels, headers, and buttons) to follow the porcelain + emerald theme direction (white cards, clean grey borders, dark canvas viewport for contrast, and emerald/amber/red color-coded telemetry and buttons).
  5. Refactored `ActivationChart` in `src/neucore/simulation/ActivationChart.js` directly with clean bright-mode support, utilizing soft porcelain-emerald gridlines (`rgba(24, 28, 50, 0.06)`), high contrast dark text `#181C32`, and clinical legend colors.
- **Files:** `app.html`, `src/main.js`, `src/neucore/gait/GaitAnalysisPage.js`, `src/neucore/simulation/ActivationChart.js`, `css/neucore-premium.css`, `docs/DESIGN_SYSTEM.md`, `docs/DEV_LOG.md`.
- **Verification:** Built successfully (`npm run build`), and verified layout/simulation render and user workflows in Playwright.

---

## P3A-2B — Isolated staging schema baseline foundation

- **Date:** 2026-07-27
- **Scope:** Backend tooling, schema artifact, forward migrations, tests, and
  documentation only. No frontend, workflow, Edge Function, credential, or remote
  provisioning changes.
- **Baseline:** Added the independently privacy-reviewed, schema-only production
  `public` dump outside `supabase/migrations/`. Its SHA-256 is pinned and verified
  offline before commands are emitted. A path-specific Git attribute disables
  line-ending normalization so the reviewed artifact remains byte-identical when
  staged and checked out.
- **History safety:** Retained all 60 historical migrations byte-for-byte,
  including the ten registry markers. Added an exact 60-version repair manifest.
- **Forward fixes:** Added an idempotent `auth.users` trigger repair for
  `public.handle_new_user()` and idempotent metadata-only legal document rows.
- **Provisioning guard:** Added an offline command emitter that rejects production,
  requires typed staging-ref confirmation, verifies baseline/manifest integrity,
  and prints an atomic empty-schema baseline command plus migration repair/push
  commands without executing them. After Claude's final audit, the guard SQL
  literals were changed to PostgreSQL dollar quoting so the emitted command keeps
  identical semantics in PowerShell, Git Bash, and POSIX shells.
- **Consistency:** Raised the authenticated-smoke identity marker minimum from four
  to six characters to match fixture tooling.
- **Limit:** The remote staging project and Edge Functions remain unprovisioned.
- **Verification:** `test:unit:staging-safety` passes 29/29; `npm run build`
  succeeds; public smoke passes 11/11; authenticated smoke remains correctly
  credential-gated at 4 skipped.

---

## P3A-2C - Isolated staging provisioning

- **Date:** 2026-07-27
- **Environment:** Created a separate staging organization and one Free Nano
  project in Frankfurt. No billing or payment step was accepted.
- **Local tooling:** Installed verified PostgreSQL 17.10 command-line tools. The
  installer SHA-256 matched the trusted WinGet manifest before execution.
- **Schema:** Applied the reviewed schema-only baseline to an empty `public`
  schema in one explicit transaction, repaired all 60 historical migration
  versions, and pushed only the two audited P3A-2B forward migrations.
- **Verification:** Confirmed 62 migration rows, all fixture/reset relations,
  exactly one enabled auth profile trigger, six current legal-document metadata
  rows, and `pg_cron` disabled. Seeded and verified synthetic admin, coach,
  active-client, and inactive-client fixtures.
- **Credential safety:** No staging ref, URL, key, password, or fixture email was
  committed. Keys and passwords were not printed. Local secrets are Windows-user
  encrypted outside the repository. Production was not linked, queried, or
  mutated.
- **Smoke finding:** Authenticated admin routing passed. Coach routing also
  passed, but the logout assertion targeted a sign-out icon hidden by the
  collapsed sidebar. The smoke now hovers the sidebar before clicking the same
  real logout control. The active-client assertion now targets the current
  `#nc-tabbar` shell instead of the removed `#client-mobile-tabs` ID. No app
  behavior changed. The final authenticated staging smoke passes 4/4.

---

## P3A-2D0 - Authenticated write-flow fixture and reset foundation

- **Date:** 2026-07-27
- **Scope:** Staging fixture/reset tooling, safety tests, and documentation only.
  No application source, frontend, migration, RLS, Edge Function, Paymob, or
  production change.
- **Fixture extension:** Added one unassigned synthetic client for coach
  authorization-denial tests. The fixture has no assigned coach and no baseline
  subscription. Credentials remain Windows-user encrypted outside the repository.
- **Reset coverage:** Expanded the probed cleanup contract to 18 relations,
  including legacy sessions, progress snapshots, client routines, exercise
  alternative requests, and fixture-recipient notifications. All deletes remain
  UUID-scoped and dependency ordered.
- **Safety:** RPM graphs are removed before the objective and subjective
  assessments they reference. Progress snapshots are removed by both fixture
  client ID and referenced assessment ID before assessments; program side-effect
  rows are removed before current program rows. Auth users are never deleted.
- **Verification:** Staging safety tests pass 32/32. A one-time seed created the
  fifth fixture, then three consecutive reset-and-verify cycles passed for all
  five roles. A final post-audit reset-and-verify cycle also passed after the
  dependency-order guards were added.
- **Deferred blocker:** Workout-write coverage remains blocked until a separate
  audited backend migration enforces inactive-client write restrictions at the
  database layer. The current frontend-only gate is not treated as DB security.

---

## P3A-2D1 - Subscription write authorization coverage

- **Date:** 2026-07-27
- **Scope:** Staging authorization tooling, safety tests, and documentation only.
  No application source, frontend, migration, RLS, Edge Function, Paymob, or
  production change. The subscription RPCs are exercised as they already exist.
- **Approach:** Authorization is proven at the database layer, not through UI
  reachability. Each fixture role signs in with the **anon** key and calls
  `create_client_subscription` / `update_client_subscription` over PostgREST.
  Actor clients never use the service-role key, which would bypass RLS and
  SECURITY DEFINER authorization and report every case as allowed.
- **Coverage:** Initially 23 ordered cases, now 24 after adding separate
  signed-out execution checks for both RPCs. Admin and assigned-coach writes succeed; a
  coach is refused on the unassigned client; clients cannot self-provision or
  edit their own access; signed-out callers cannot reach the RPC; `cancelled` is
  refused on both RPCs (L9); only an admin may expire; every documented range
  check is asserted. Every denial asserts the specific server message, so no case
  can pass on an unrelated failure.
- **Determinism:** The suite creates extra subscription rows deliberately and
  always runs `reset` afterwards, including after a failure, so the verify
  baseline is restored.
- **Defect fixed in passing:** `tests/staging/cli.mjs` previously fell through to
  `reset` for any command without an explicit branch, so adding a command would
  have silently run a destructive reset. Unhandled commands now throw.
- **Verification:** Staging safety tests pass 45/45 and the production build
  passes, both re-run locally. Two deliberate mutations (dropping a captured id,
  rewording a denial pattern) were confirmed to fail the new tests, so the
  ordering and message-contract guards are not vacuous.
- **Live staging result (2026-07-28):** Validation and the initial five-role
  baseline verification passed. The matrix passed 22/23 cases. The signed-out
  create was denied by the RPC's internal role check, but reached the SECURITY
  DEFINER function instead of receiving PostgreSQL's function-permission denial.
  The suite restored fixtures in `finally`, and a separate post-failure
  `staging:verify` passed for all five roles.
- **Deliberately deferred:** Browser-level subscription UI coverage, and the
  `AUTH_CREDENTIAL_KEYS` extension it would require. Adding those keys now would
  make them mandatory for every authenticated Playwright run before any spec
  consumes them.

## P3A-2D1 follow-up - Security-critical RPC execute ACL hardening

- **Date:** 2026-07-28
- **Root cause:** The schema baseline records production's effective ACLs but
  omits explicit browser-role revocations that matter on a fresh Supabase
  project, where default privileges can grant function execution. Historical
  migration bodies contain the correct revocations but are not replayed after
  baseline provisioning and migration-history repair.
- **Correction:** Added a forward migration that revokes both subscription RPCs
  from `PUBLIC` and `anon`, then explicitly preserves `authenticated` and
  `service_role` execution. The same migration revokes `PUBLIC`, `anon`, and
  `authenticated` from the paid-package application RPC and global stale-workout
  sweep, preserving `service_role` only. Those system RPCs have no caller-JWT
  authorization and depend on their ACL. Offline tests pin all four complete
  signatures and their intended grants.
- **Safety:** No unauthorized subscription was created. No production target was
  contacted or modified.
- **Staging proof:** The linked target matched the encrypted staging
  configuration, and the dry run listed only this migration. Apply succeeded.
  `validate -> verify -> authz-subscriptions -> verify` then passed, including
  all 24 subscription cases. Four execution probes confirmed both system RPCs
  reject `anon` and authenticated callers at function permission. Fixture reset
  and the final five-role verification passed afterward.
- **Durable control:** Added `staging:authz-system-rpcs`, which preserves the same
  four execution-level checks and always resets fixtures after the probe.
  Wrapped the migration in `BEGIN`/`COMMIT` for channels that execute the file
  directly. The Management API transaction model was not independently proven;
  future applies must verify the channel model and avoid nesting transaction
  wrappers. The committed-form command passed 4/4 on isolated staging, followed
  by a successful five-role verification, and structural checks found no partial
  ACL state.
- **Remaining gate:** Re-audit the durable command and transaction wrapper,
  rerun its committed form, then push the corrected PR head. No merge yet.
- **PR/CI evidence:** Head `d74e181` was pushed after Claude approval. Playwright
  smoke passed. Supabase Preview skipped despite the migration, so it provided
  no preview-database ACL evidence; the PR and RUNBOOK state that explicitly.

---

## L12 - Database-level workout write gate

- **Date:** 2026-07-28
- **Scope:** One forward migration, its rollback, a durable staging command, and
  offline guards. No application source, frontend, Edge Function, Paymob, or
  production configuration change.
- **Problem:** `workout_sessions_client_own` authorized client writes on ownership
  alone, and `effective_status` appeared in **no** policy anywhere in the schema.
  The inactive-subscription takeover was frontend-only, so a lapsed client could
  write workout sessions and logs through direct PostgREST calls.
- **Design:** RESTRICTIVE policies, which PostgreSQL ANDs with the existing
  permissive ones. No existing policy is modified, so coach and admin paths cannot
  regress and the rollback drops only what the migration adds. A permissive policy
  would have been OR'd instead and would block nothing; the offline suite fails if
  `AS RESTRICTIVE` is dropped.
- **Deliberate non-goals:** `SELECT` is not gated, preserving view-only access for
  a lapsed client. Coach and admin writes on behalf of a lapsed client are
  unchanged; the suite asserts this so narrowing it stays a decision, not an
  accident.
- **Behavior change:** a client with **no** subscription row loses write access.
  This matches the locked rule (none -> view only) and the login gate, but it is a
  change and is recorded here rather than discovered.
- **Coverage:** `staging:authz-workout-writes` runs 7 cases - lapsed client refused
  on both gated tables, active client still writes to both, coach and admin still
  write for a lapsed client, and the lapsed client keeps read access. Denials must
  report `violates row-level security policy`.
- **Audit correction:** the admin probe inserts a `completed` session because the
  coach probe already occupies the partial unique index permitting one active
  session per client. The denied lapsed-client probe also uses `completed`, so a
  missing RLS gate reports an unexpected successful write rather than a
  unique-index error. The suite resets fixtures before and after execution so an
  interrupted prior run cannot create a false authorization failure.
- **Deliberate RPC exception:** `expire_my_stale_workout_sessions()` remains
  callable by authenticated users. As a SECURITY DEFINER maintenance path it is
  outside the table RLS gate, but it can only abandon already-stale manageable
  sessions; it cannot create workout sessions or exercise logs. L12 therefore
  claims protection for direct table writes and normal workout write flows, not
  removal of every lifecycle RPC.
- **Verification:** Offline suite 65/65 and the production build pass, both re-run
  locally. Seven deliberate mutations were each confirmed to fail the guards,
  including turning the policies permissive, gating SELECT, dropping the logs
  gate, weakening the anon revoke, weakening the denial regex, resetting only on
  success, and flipping the lapsed denial to allowed.
- **Staging verification:** Applied only to the isolated staging project on
  2026-07-28. Migration history registered `20260728010000` as the 64th row.
  `staging:authz-workout-writes` passed 7/7 cases with the required split:
  5 allowed and 2 denied. Post-run fixture verification passed for admin, coach,
  active client, inactive client, and unassigned client.
- **Production status:** Applied 2026-07-28 under explicit owner approval, after
  PR #134 merged as `e775de5`. Registered as version `20260728010000`, the 64th
  migration row.
- **Application mechanism:** Applied as a single Management-API SQL execution of
  that one file, followed by an explicit `schema_migrations` row pinned to
  `20260728010000`. **`supabase db push` was deliberately not used.** Repository
  filenames and production versions diverged from 2026-06-14 onward: at the time
  of this apply, 26 repository versions were absent from production history, and
  22 of those were already applied
  under different version strings (for example repo `20260710000000` versus
  production `20260710161851`). A version-based push would therefore have replayed
  22 already-live migrations, including the payments foundation and the 152-row
  exercise library. The local CLI stayed linked to isolated staging throughout.
  Only the outer `BEGIN;`/`COMMIT;` were removed from the submitted payload,
  to avoid unsafe nesting if the execution channel wraps statements. The
  channel's transaction model was not independently proven; complete structural
  verification confirmed that no partial L12 state remained. The committed
  migration file is unchanged.
- **Production verification:** Version row exactly 1. `client_has_write_access` is
  SECURITY DEFINER, STABLE, with `search_path=public, pg_temp`. `anon` cannot
  execute it; `authenticated` and `service_role` can. Policy counts: 6 RESTRICTIVE
  (INSERT/UPDATE/DELETE on both tables), 5 pre-existing PERMISSIVE retained,
  0 RESTRICTIVE `SELECT` or `ALL`. Behavioral probes ran as impersonated roles
  inside rolled-back transactions: lapsed-client session insert denied `42501`;
  lapsed-client log insert into a session created while active denied `42501`;
  lapsed-client read returned their history; active-client insert allowed;
  assigned-coach insert for their client allowed. Session and log row counts were
  unchanged afterwards and no probe row persisted. Security advisors reported no
  new ERROR-level finding — `client_has_write_access` appears only under the
  signed-in SECURITY DEFINER lint, not the anon one, which is the intended grant.
- **Honesty note:** Real authenticated smoke was not performed. Production
  verification was database-level only.
- **Measured impact:** Of 5 client profiles, 4 resolve to `active` and retain
  write access. Exactly 1 has no subscription row, resolves to `none`, and newly
  loses write access with 0 open active sessions — the intended rule, measured
  before the apply rather than discovered after.
- **Scoped out:** The same ownership-only pattern on `daily_routine_logs`,
  `progress_logs`, `phase_submissions`, `subjective_assessments`,
  `client_questions`, `exercise_alternative_requests`, and legacy `workout_logs`.
  Tracked as ISSUE_LOG #17.

---

## M2 - Production migration-history reconciliation

- **Date:** 2026-07-29
- **Scope:** Production migration-registry reconciliation only. No migration SQL,
  schema, RLS, function, grant, trigger, Realtime, cron, application source, or
  application-data change.
- **Purpose:** Resolve ISSUE_LOG #18 by recording the 25 repository migration
  versions whose effects were already present under divergent production
  versions or proven equivalent/no-op states.
- **Execution:** The approved versions were recorded as applied one at a time
  with the pinned Supabase CLI `2.109.1` and an explicit database URL. The run
  never used `--linked`, `supabase link`, `db push`, `migration up`, handwritten
  registry SQL, or migration SQL application.
- **Executor revision history:**
  1. Revision 1 pinned CLI `2.109.1`, rejected implicit linked targeting,
     enforced the approved version sets, sanitized output, and scoped rollback
     to approved versions added by the run.
  2. Revision 2 routed every post-write verification failure through one rollback
     controller, changed rollback to reverse-order one-version operations,
     added deterministic catalog and row-content fingerprints, formalized exit
     outcomes, and hardened native-tool validation and report handling.
  3. Revision 3 added an eight-check restored-baseline verifier for both
     nothing-to-revert and completed-rollback paths, recorded actual pre/post/
     rollback evidence, and made quiet-window drift fail closed.
  4. Revision 4 attempted to harden the L12 snapshot contract after the first
     gates-only transport failure by using a typed single-object result and
     explicit property validation.
  5. Revision 5 replaced dynamic L12 property access with validated hashtable
     index access and added exact failure-line, command, exception-type, and stack
     diagnostics after Revision 4 did not eliminate the failure.
  6. Revision 6 identified and fixed the actual PowerShell case-insensitive
     script-scope variable collision, backed by negative controls reproducing
     both observed failures and a case-insensitive static collision check.
  7. Revision 7 resolved the repository root explicitly, preflighted all 25
     migration files, and ran both apply and rollback CLI calls from that root,
     fixing the first full-run working-directory failure.
- **Final executor:** Revision 7, SHA-256
  `0a2ecdc3df80e894ddd219a327d52d339591f3b4ddbf6709f3393edb8eb545fd`.
- **Outcome:** **SUCCESS**. Registry count moved from **64 to 89**. Exactly the
  approved 25 versions were added, all 25 divergent production rows were
  preserved, all original 64 rows remained byte-for-byte unchanged, and all
  64 repository versions are now represented with 0 absent.
- **Evidence:** Sanitized report SHA-256
  `773354eb201f065c665e58424f97814be06a928f120c7dcb289b86b7672263b2`.
  The pre-change and post-originals snapshots both hash to
  `7b9dae553d5a550f7746c0b7d6482618d3d43632980dbc2aa7aa5c2e03fe546b`.
  The versions-only hashes are
  `2633ec6dc94153dc7f5dd9788e7ad8125fe2d7e97c61c582af091cfdafe20f20`
  before and
  `4de1275e54b775b6294353cdfc7b3ba66a910c955eca18f45250216fdbc154d7`
  after.
- **Independent verification:** Registry 89; approved 25 present; mapped 25
  preserved; catalog fingerprint
  `8352d0584b8f145060119c691636a53b` unchanged; row-content fingerprint
  `956c3e7ef1d8664e1e3b8976f04ea5b8` unchanged; L12 remained 1 registry
  row, 6 RESTRICTIVE policies, 5 PERMISSIVE policies, and 0 RESTRICTIVE
  `SELECT`/`ALL` policies. Independent read-only audit found no blocker, major,
  or minor issue.
- **Honesty note:** M2 changed only
  `supabase_migrations.schema_migrations`. It did not prove that production
  `supabase db push` or `supabase migration up` is safe end to end; those
  commands remain prohibited pending separate validation. No real authenticated
  browser smoke was performed because M2 had no application behavior change.

---

## O1 - Deploy gate hardening

- **Date:** 2026-07-29
- **Change:** Added a read-only `verify` job ahead of the GitHub Pages build and
  deploy jobs, and added `main` pushes to the standalone smoke workflow triggers.
- **Why:** Commits reaching `main` outside a pull-request checks path could
  previously publish to production without any test gate.
- **Deploy gates:** `npm run test:unit:staging-safety`,
  `npx playwright install --with-deps chromium`, and
  `npm run test:smoke:public` now run after `npm ci`. Authenticated Playwright
  specs remain outside the deploy requirement.

---

## S1 - Migration rollback inventory and documentation truth pass

- **Date:** 2026-07-30
- **Change:** Added the complete 64-migration rollback inventory, corrected the
  incident-response and repository-map rollback coverage statements, and updated
  the specified stale issue, decision, limitation, and runbook statements.
- **Why:** Operators and future audits need the documented rollback coverage,
  locations, and implementation status to match the verified repository state.
- **Also recorded:** Owner decision D11 — client write access follows effective
  subscription state on all seven residual ownership-only tables, and the three
  tables with no application write path are queued for a deprecation review. The
  analysis behind it was repository-derived (baseline schema plus `js/` write
  paths), not read from production. Two implementation constraints are carried in
  [ISSUE_LOG.md](ISSUE_LOG.md) #17: the nullable-`client_id` NULL trap, and the
  three tables that exist only in the baseline.
- **Scope:** Documentation only — no SQL, no application code, no file moves,
  and no production access.

---

## P3A-2H-R - Revoke service-role role-predicate execution

- **Date:** 2026-07-30
- **Owner decision:** Revoked `service_role` EXECUTE in the repository contract
  for `is_admin()`, `is_coach()`, `is_coach_or_admin()`,
  `is_admin_or_coach()` and `get_my_role()`. `service_role` holds BYPASSRLS,
  has no call site for these predicates, and needs no grant for definer-rights
  nesting.
- **ACL contract:** All 51 entries are approved and none remain provisional.
  `PUBLIC` stays revoked. The `anon` grant is deliberately preserved because
  baseline policies without a `TO` clause evaluate these predicates for
  signed-out requests; `authenticated` is also preserved.
- **Evidence pass and correction:** review found the manifest and the migration
  disagreed about `get_my_role()` — the manifest recorded `anon: false` while the
  migration granted `anon`. A read-only pass over the baseline **plus all 66
  migrations** (honouring `DROP POLICY`, stripping `$$` bodies) resolved **163
  effective policies** and settled it: `get_my_role()` is referenced by two
  no-`TO` policies on `profiles`, so `anon` EXECUTE is required and the manifest
  was wrong. It is corrected to `anon: true` with the fingerprint updated in the
  same commit. The earlier per-predicate counts were baseline-only and are
  corrected to 12, 1, 3, 3 and 2 policies with no `TO` clause.
- **Application status:** The migration is committed but applied to no database.
  ISSUE_LOG #16 remains open pending an approved apply and production parity
  verification.

---

## INV-1 - Guard migration rollback inventory against drift

- **Date:** 2026-07-30
- **Change:** Added an offline unit guard that compares every forward migration,
  rollback pairing and location, allowed inventory status, and summary count
  against the repository filesystem. Registered it in `test:unit` and repaired
  the inventory summary prose to describe the enforced contract.
- **Why:** The inventory drifted twice within hours when two migrations shipped
  without rows, and no automated check caught either omission or the stale
  counts.
- **Scope:** This closes the drift class rather than correcting another instance:
  missing and stale rows, pairing and location contradictions, invalid statuses,
  and stale filesystem-derived counts now fail the build.
