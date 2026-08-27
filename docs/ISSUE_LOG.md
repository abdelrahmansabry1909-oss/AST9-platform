# AST9 Issue Log

> Real bugs and how they were handled. Each entry: symptom → root cause → fix
> (PR/commit) → what was verified → remaining manual test. Backend reproductions
> were transaction-local and rolled back (no data written). "Owner browser smoke"
> means a real authenticated save by the owner in the live app — the only check
> this environment cannot perform (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).

---

## 1. Athlete Story (profile) save failed
- **Symptoms:** Saving the Athlete Story produced no persisted `athlete_profiles`
  row; the profile appeared not to save.
- **Root cause:** Frontend payload drift vs the live schema (column/JSONB/enum
  names), compounded by stale cached JS serving the pre-fix payload.
- **Fix:** PR #69 (`db046a1`) aligned the payload to the schema; PR #71 (`6c4f110`)
  bumped the cache-bust token so browsers re-fetch the fixed module.
- **Verified:** Backend-reproduced — admin insert of the current payload **succeeds**
  against the live schema (RLS allows admin/owning-coach; clients correctly blocked).
- **Remaining:** Owner browser smoke of the live Story save. If it still fails,
  capture the exact console/network error (a `PGRST204 "Could not find the '…'
  column"` would indicate a still-stale cache).

## 2. Assessment save failed
- **Symptoms:** Completing a movement assessment appeared to fail; in reality the
  session row saved but had **0 linked test results**.
- **Root cause:** Two distinct frontend payload bugs (see #3 and #4 below) that
  blocked the `athlete_test_results` inserts after the parent session row saved.
- **Fix:** PR #70 (status) + PR #71 (`best_of`).
- **Verified:** Backend-reproduced — `athlete_assessments` insert succeeds for
  admin and owning coach; `athlete_test_results` insert succeeds once `best_of` is
  an integer.
- **Remaining:** Owner browser smoke of a full assessment save (session + results).

## 3. Assessment status CHECK failed
- **Symptoms:** Assessment insert rejected by the DB.
- **Root cause:** `athlete_assessments.status` has CHECK `status ∈ {draft, final}`;
  the frontend sent `completed`.
- **Fix:** PR #70 (`71897f2`) — send `final` instead of `completed`.
- **Verified:** Backend-reproduced — `status='final'` insert accepted.
- **Remaining:** Covered by #2 owner browser smoke.

## 4. `best_of` boolean / integer mismatch
- **Symptoms:** `athlete_test_results` insert failed with
  `42804: column "best_of" is of type integer but expression is of type boolean`.
- **Root cause:** Column `best_of` is `integer`; the frontend sent a boolean
  (`best_of: isBest`) and read it back with `.eq('best_of', true)`.
- **Fix:** PR #71 (`6c4f110`) — `best_of: isBest ? 1 : 0` and read site
  `.eq('best_of', 1)`. No schema/migration change (column was empty, 0 rows).
- **Verified:** Backend-reproduced — `best_of` as integer is accepted; as boolean
  is rejected `42804`.
- **Remaining:** Covered by #2 owner browser smoke.

## 5. Cache-bust stale JS
- **Symptoms:** Already-fixed `athleticService.js` did not take effect for some
  sessions; old payloads (wrong columns / `status:'completed'`) kept running even
  though the server served the new file.
- **Root cause:** `app.html` referenced `js/athleticService.js?v=20260625a` and the
  token was **not bumped** across PR #69/#70, so browsers/CDN kept the cached
  pre-fix copy.
- **Fix:** PR #71 (`6c4f110`) — bumped to `?v=20260627a` (now on `origin/main`).
- **Verified:** Confirmed `origin/main:app.html` references `?v=20260627a`.
- **Remaining:** None — but the **discipline** stands: bump `?v=` whenever
  `athleticService.js` (or any cache-busted module) changes. See [NOT_A_BUG.md](NOT_A_BUG.md)
  / [DECISIONS.md](DECISIONS.md).

## 6. Browser visual smoke limitation
- **Symptoms:** Automated browser visual/save smoke could not be completed in the
  build/agent environment.
- **Root cause:** This is an environment limitation (no real authenticated browser
  session / DevTools-localhost constraints), **not an app bug**.
- **Fix:** N/A — tracked as a limitation, not a defect. See [NOT_A_BUG.md](NOT_A_BUG.md)
  and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
- **Verified:** Backend behavior verified by impersonated SQL; UI verified by owner.
- **Remaining:** Owner manual smoke remains the system of record for save flows.

## 7. Movement composite score "Score unavailable" (infinite recursion)
- **Symptoms:** The Movement Simulation / gait panel showed "Score unavailable"
  instead of numeric scores.
- **Root cause:** `ScoringEngine.fullScores()` called `_composite()`, and
  `_composite()` called `fullScores()` again → infinite recursion → `RangeError`
  (max call stack), which `GaitAnalysisPage` caught and rendered as
  "Score unavailable".
- **Fix:** `fix/neucore-scoring-composite-recursion` — compute the four component
  scores once in `fullScores()` and pass them into
  `_composite(rom, control, force, neurology)` (default params keep the arg-less
  `phaseRecommendation()` call working). No recursion; the arithmetic mean, null
  filtering, normalization values, phase thresholds, field names, weights, and
  recommendations are all unchanged.
- **Verified:** `node --check`;
  `node --test tests/unit/scoring-engine-composite.test.js` (6/6 pass:
  no-recursion, normative-finite, null-filtering mean, empty-case, phase
  thresholds 80/60/40 + referral, numeric-for-Movement-Simulation);
  `npm run build` green; `git diff --check` clean.
- **Discovered (deferred, out of scope):** with no balance data,
  `_neurologyScore()` returns `Math.max(0, _avg([]) - painPenalty)`, and `null - 0`
  coerces to `0`, so `neurology_score` is `0` (never null). The composite is
  therefore never null and the `'Insufficient data'` recommendation branch is
  **unreachable** — an empty assessment resolves to `Phase 1 — Foundation`
  (referral). Making `'Insufficient data'` reachable would change a clinical
  algorithm, which this recursion fix deliberately does **not** touch. Flagged for
  a separate owner decision.
- **Remaining:** Owner visual confirm the Movement Simulation panel now shows
  numeric scores in the live app.

## 8. Gait animation jumps, duplicate loops, and simulator styling mismatch
- **Symptoms:** The NeuCore Movement Simulation gait animation paused/teleported when looping from terminal swing to loading response. Multiple concurrent animation loops ran after a rapid Stop → Start or Worst Phase → Resume sequence. The simulator outer shell, phase strip, and worst-phase overlay cards had style conflicts and overlap breakages on mobile screens.
- **Root cause:**
  1. Bone rotation interpolation did not use cyclic interpolation between `terminal_swing` and `loading_response` index transitions.
  2. Old root translation moved between `±WALK_RANGE` and reversed direction unnaturally.
  3. Missing delta clamping allowed large phase steps after inactive tabs, and missing RAF ownership allowed duplicate frame chains.
  4. Styles were not strictly scoped to `#neucore-gait-container` under bright mode, overriding layout button displays due to `!important` on the gait toolbar display declaration.
  5. Joint callout cards on viewports < 480px lacked responsive positioning constraints, resulting in overlaps and viewport overflow.
- **Fix:**
  1. Implemented cyclic phase index wrapping (`(phaseIdx + 1) % phaseCount`) for rotation interpolation.
  2. Replaced walk-progress root motion with centered sinusoidal displacement (`Math.sin(phase * Math.PI * 2) * 0.018`), keeping depth position.z = 0 and yaw rotation.y = 0.
  3. Implemented delta clamping (`Math.min(rawDt, 0.05)`) to prevent large phase skips, structured `start()` with an active-playing return guard, and saved the RAF handle (`this._rafId`) to cancel any existing animation frame before starting, preventing duplicate chains.
  4. Scoped all premium styles under `body.nc-bright #neucore-gait-container` and removed `!important` from the gait toolbar display declaration.
  5. Added a dedicated `.gait-phase-card-rail` container element and styled it as a horizontal, scrollable card rail with scroll snapping (`scroll-snap-type: x mandatory`) and hidden connector lines on mobile.
  6. Corrected Stop clicked during worst-phase analysis to clear `_analysisMode`, hide the overlay, stop the simulation loop, reset the skeleton, and restore the overview camera.
- **Verified:** Built successfully (`npm run build`). Verified the 17-point regression checklist using a Playwright script: no overlapping cards, no horizontal document overflow at 390px/375px, Stop/Resume transitions work correctly, and all six unit tests pass.
- **Remaining:** None.

## 9. Collapsed sidebar icon & active pill alignment in Porcelain mode
- **Symptoms:** In 1440px desktop viewports, collapsed sidebar navigation icons and active item background pills were cut off by the 64px sidebar boundary.
- **Root cause:** `body.nc-bright:not(.nc-client) .sidebar` inherited horizontal padding (`24px 16px`) and flex start alignment intended for the 260px expanded drawer. Wordmark text labels retained flex layout width even when visually transparent.
- **Fix:** Refined `@media (min-width: 901px)` sidebar rules in `css/neucore-premium.css`. Collapsed sidebar uses zero horizontal padding (`24px 0 !important`), centered 44px × 44px active item pills (`width: 44px; height: 44px; margin: 4px auto`), centered icons, centered brand mark, and hidden wordmark text width (`display: none; width: 0`). On hover/focus, expanded drawer padding (`24px 16px !important`) and wordmark width are restored without shifting main content.
- **Verified:** Automated Playwright assertion script (`run_gate2e_verification.js`) verified `sidebarWidth = 64px`, `mainMarginLeft = 64px`, `markContained = true`, `activeContained = true`, `iconFit = true`, `expandedWidth = 260px`, `wordmarkUnclipped = true`, `subtitleUnclipped = true`.
- **Remaining:** None.

## 10. Objective Assessment mobile grid overflow at 375px/390px
- **Symptoms:** Objective Assessment cards caused 320px 2-column grid clipping and horizontal document scrolling on mobile devices.
- **Root cause:** Unconstrained 2-column CSS grid rules on `.neucore-assess-layout` and `.assess-grid` at small viewports.
- **Fix:** Added `@media (max-width: 768px)` rules in `css/neucore-premium.css` converting layout grids to single-column flex vertical stacks (`flex-direction: column; grid-column: span 1 !important`).
- **Verified:** Document scroll width verified to equal window inner width (`scrollWidth <= innerWidth`, overflow = `false`) across 375px and 390px viewports.
- **Remaining:** None.

## 11. Material Symbols icon font network dependency and flash of unstyled text
- **Symptoms:** Five icon spans rendered as raw text strings (e.g. "dashboard", "group", "menu_book", "assignment_turned_in", "warning") before Google Fonts loaded or when fonts were blocked.
- **Root cause:** Dependance on external `material-symbols-outlined` font family text spans instead of inline vector markup.
- **Fix:** Replaced all 5 remaining `material-symbols-outlined` text spans in `app.html` with 100% native inline `<svg>` elements.
- **Verified:** Full Playwright smoke and visual verification suites executed with Google Fonts network requests blocked (`context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, route => route.abort())`); zero icon text flashes or raw string fallbacks.
- **Remaining:** None.

## 12. Authenticated smoke used stale client-shell interaction assumptions
- **Symptoms:** The isolated staging smoke passed admin routing and coach routing,
  then first timed out while clicking `.logout-icon[title="Sign out"]`. After
  that was corrected, active-client routing passed but the test waited for the
  removed `#client-mobile-tabs` ID.
- **Root cause:** The desktop sidebar intentionally hides footer controls until
  hover or focus, and the current client shell renamed its tab bar to
  `#nc-tabbar`. The smoke retained assumptions from the older frontend.
- **Fix:** Hover `.sidebar` before clicking the existing sign-out control. This is
  a test-only interaction correction. Assert the attached current `#nc-tabbar`
  client shell instead of the removed ID. App HTML, CSS, auth, and routing are
  unchanged.
- **Verified:** Authenticated staging smoke passes 4/4: admin routing, coach
  routing plus real logout, active-client routing, and inactive-client takeover.
- **Remaining:** None.

## 13. Write-flow reset gaps and inactive-client database enforcement
- **Symptoms:** The P3A-2 write-test plan could leave legacy sessions, progress
  snapshots, program side effects, and notifications behind. Inactive clients
  were also blocked from workout writes only by frontend routing.
- **Root cause:** The original reset contract predated assessment snapshots,
  client routines, exercise alternatives, and notification side effects.
  `workout_sessions_client_own` checks ownership but not effective subscription
  state.
- **Fix in P3A-2D0:** Added an unassigned synthetic client and expanded the
  UUID-scoped reset contract to 18 relations. Added dependency-order and probe
  coverage tests. Verified the five-role baseline across three reset cycles.
- **Fix in L12:** Added independently audited RESTRICTIVE database policies for
  workout sessions and exercise logs plus a seven-case authenticated staging
  matrix. The migration was applied to isolated staging on 2026-07-28; all
  7 cases passed (5 allowed, 2 denied), followed by a clean five-role fixture
  verification.
- **Production:** Applied 2026-07-28 under explicit owner approval as version
  `20260728010000`. Verified at the database layer: 6 RESTRICTIVE policies, the 5
  pre-existing permissive policies retained, no RESTRICTIVE `SELECT`/`ALL`, `anon`
  cannot execute the helper, and impersonation probes in rolled-back transactions
  denied lapsed-client writes with `42501` while active-client, assigned-coach, and
  lapsed-client read paths were unaffected. No new ERROR-level security advisor.
  Real authenticated smoke was not performed.
- **Closed for workout tables.** The ownership-only tables tracked in issue #17
  remain outside L12.

## 14. Subscription write authorization was never proven at the database layer
- **Symptoms:** Subscription create/edit rules (assigned-coach scoping, admin-only
  expiry, rejected `cancelled` status, range checks) existed only in the SQL of
  two SECURITY DEFINER RPCs. No automated test exercised them as a real
  authenticated caller, so a permission regression would have reached production
  undetected.
- **Root cause:** The staging fixture tooling authenticated with the service-role
  key, which bypasses RLS and SECURITY DEFINER authorization. It could seed and
  verify state but could not prove who is allowed to change it.
- **Fix in P3A-2D1:** Added anon-key fixture sign-in and a 23-case authorization
  matrix run over PostgREST, plus offline tests that pin case ordering, forbid
  generic denial assertions, and check every asserted message against the
  `RAISE EXCEPTION` text in the migration that defines the RPCs.
- **Also fixed:** `tests/staging/cli.mjs` fell through to `reset` for any command
  lacking an explicit branch; unhandled commands now throw instead of running a
  destructive cleanup.
- **Live result:** The first isolated-staging run passed 22/23 cases. Every
  unauthorized write was denied, but the signed-out case exposed the ACL drift
  tracked in issue #15.
- **Remaining:** None for ISSUE #14. The signed-out boundary is corrected, L12 is
  applied to production, and `staging:authz-workout-writes` is the durable
  database-layer workout-write check.

## 15. Isolated staging baseline lost security-critical function revocations
- **Symptoms:** A signed-out caller reached `create_client_subscription` and was
  rejected by its internal coach/admin check, instead of being blocked at
  function execution.
- **Impact:** No unauthorized subscription write occurred. The same baseline
  pattern also affected the paid-package application RPC and global
  stale-workout sweep, whose ACL is their primary caller boundary.
- **Root cause:** The schema baseline revokes the RPCs from `PUBLIC` and grants
  trusted roles, but does not explicitly revoke Supabase's `anon` role. The
  historical migration did, and that body is not replayed when the isolated
  project is provisioned from the baseline.
- **Fix applied to staging:** A forward migration reasserts `PUBLIC`/`anon` revocation on
  both subscription RPCs while preserving `authenticated`/`service_role`
  execution. It separately revokes `PUBLIC`/`anon`/`authenticated` from the two
  system-only RPCs and preserves `service_role`. Offline tests pin all four exact
  signatures and grant sets.
- **Verification:** The corrected subscription matrix passed 24/24. Separate
  execution probes proved both system RPCs reject `anon` and authenticated
  callers, followed by successful fixture reset and five-role verification.
- **Durable control:** `staging:authz-system-rpcs` commits those four execution
  checks and guarantees reset after success or failure. Its isolated-staging run
  passed 4/4, followed by successful five-role verification.
- **Remaining:** Re-audit and merge the atomic migration wrapper before closing
  this issue.

## 16. Baseline function ACL fidelity needs a complete inventory
- **Symptoms:** The P3A-2D1 correction audit found many baseline function ACL
  entries that revoke `PUBLIC` without retaining explicit `anon` or
  `authenticated` revocations from their historical migrations.
- **Current containment:** The four security-critical RPCs identified during this
  gate are covered by a forward migration and offline ACL guards. Production
  already has the intended grants.
- **Remaining:** Stage A is inventory-complete and all decisions are final. The
  non-secret manifest covers all repository-declared function signatures with
  **51 approved and 0 provisional** entries. The offline guard pins the full ACL
  contract with a deterministic fingerprint in addition to inventory, signature,
  security-mode, and structural checks. Production parity remains unverified;
  issue #16 stays open pending the separately approved migration apply and
  production parity verification.
- **Trigger helpers approved (owner, 2026-07-30):** `handle_updated_at()`,
  `rpm_touch_updated_at()` and `update_updated_at()` moved from provisional to
  approved with all four roles pinned false. Each is reached only through
  `CREATE TRIGGER ... EXECUTE FUNCTION` (3, 2 and 1 references) with zero
  references in `js/`, `src/` or `supabase/functions/`, and PostgreSQL does not
  require the DML user to hold EXECUTE on a trigger function. The ACL contract
  fingerprint is unchanged by the promotion, which confirms no pinned grant moved.
- **Role predicates approved (owner, 2026-07-30):** `service_role` must not have
  direct EXECUTE on `is_admin()`, `is_coach()`, `is_coach_or_admin()`,
  `is_admin_or_coach()` or `get_my_role()`. It holds BYPASSRLS, has no call site
  for these predicates, and nested calls inside a `SECURITY DEFINER` body run
  with the definer's rights. Migration
  `20260730100000_revoke_service_role_role_predicates.sql` records that decision
  but is **applied nowhere**. `anon` EXECUTE remains required, not drift: policies
  without a `TO` clause apply to `PUBLIC` and evaluate as `anon` for signed-out
  requests.
- **Evidence pass correction (2026-07-30):** earlier policy counts in this issue
  were derived from the baseline alone and were wrong. A full pass over the
  baseline **plus all 66 migrations**, honouring `DROP POLICY` and stripping
  `$$` bodies before statement splitting, resolves **163 effective policies**.
  Corrected counts of policies with **no `TO` clause** — the ones an `anon`
  caller evaluates: `is_admin` **12** (was reported 17), `is_coach` **1** (was 4),
  `is_coach_or_admin` **3**, `is_admin_or_coach` **3**, `get_my_role` **2**.
  `anon` holds table grants on every affected table, so those policies are
  genuinely reached. All five therefore require `anon` EXECUTE; the conclusion is
  unchanged, but it is now established rather than asserted.
- **Manifest correction (2026-07-30):** `get_my_role()` was recorded with
  `anon: false`. That was wrong — it is referenced by two effective no-`TO`
  policies on `profiles`. The expectation is corrected to `anon: true`, and the
  ACL contract fingerprint was updated in the same commit.

## 17. Ownership-only client write policies beyond workout tracking
- **Symptoms:** L12 work found that `effective_status` appeared in no RLS policy at
  all. Workout tables are now gated, but several other tables still authorize
  client writes on `client_id = auth.uid()` alone.
- **Affected:** `daily_routine_logs`, `progress_logs`, `phase_submissions`,
  `subjective_assessments`, `client_questions`, `exercise_alternative_requests`,
  and the legacy `workout_logs` table.
- **Impact:** A client whose subscription has lapsed can still write to these
  through direct PostgREST calls. Severity varies by table and none of them is the
  paid-feature surface workout tracking is, so this was scoped out of L12 rather
  than bundled into a single large RLS change.
- **Decided (owner, 2026-07-30):** All seven tables are to be gated on effective
  subscription state, reusing `client_has_write_access(uuid)` with the L12
  RESTRICTIVE pattern on INSERT/UPDATE/DELETE only. `SELECT` is never gated; the
  locked rule is view-only, not no-access. See [DECISIONS.md](DECISIONS.md) D11.
  `progress_logs`, `client_questions`, and `workout_logs` have no write path from
  any application code and are additionally queued for a deprecation review.
- **Two constraints for the implementing phase.** First, `phase_submissions.client_id`
  and `subjective_assessments.client_id` are NULLABLE. L12's
  `client_id <> (SELECT auth.uid())` evaluates to NULL on such a row, and a
  RESTRICTIVE policy that does not evaluate TRUE denies the write — that would block
  coaches, not just lapsed clients. Both tables need
  `client_id IS DISTINCT FROM (SELECT auth.uid())`. Second, `progress_logs`,
  `client_questions`, and `workout_logs` are defined only in
  `supabase/baseline/production_public_schema.sql`, not by any migration under
  `supabase/migrations/`, so a migration touching them cannot be validated by
  replaying repository migrations onto a fresh preview database.
- **Production catalog read (2026-07-30, read-only):** The live policy set was
  confirmed before the migration was written, closing the baseline-drift risk
  noted above. Findings: all seven tables have RLS enabled and **every existing
  policy on them is PERMISSIVE** — no RESTRICTIVE policy existed, so nothing
  partially mitigated the gap; `client_has_write_access(uuid)` is present,
  SECURITY DEFINER, STABLE, granted to `authenticated` and `service_role` only,
  never `anon`, so no new function is needed; `client_id` is confirmed NULLABLE
  on `phase_submissions` and `subjective_assessments` and NOT NULL on the other
  five, confirming the NULL trap; and neither `client_questions` nor
  `exercise_alternative_requests` authorizes a client DELETE today, so their
  DELETE policies are deliberately inert forward cover. Catalog metadata only —
  no user rows were read.
- **Cross-migration hazard:** the L12 rollback drops
  `client_has_write_access(uuid)`, which the six live workout-table policies still
  depend on. This phase's rollback is policy-only and drops no function; the
  offline test asserts that explicitly so the hazard cannot be reintroduced.
- **Remaining:** The isolated-staging authorization cases, expectation manifest,
  21-policy gating migration, and paired policy-only rollback now exist, but
  nothing has been applied. Apply to isolated staging and capture catalog plus
  authenticated-matrix proof, then seek separate approval for a production
  apply. Issue #17 remains open until those deployment steps are complete.

## 18. Repository migration versions diverged from production history (resolved 2026-07-29)
- **Symptoms:** The L12 production-apply readiness audit initially found 26
  repository migration versions absent from production history. L12 itself was
  the 26th and is now correctly registered as `20260728010000`, leaving **25**
  absent repository versions. Of those, 22 are already applied under different
  version strings. The repository uses rounded timestamps; production recorded
  actual apply times — for example repo
  `20260614000000_coach_packages_foundation` versus production `20260614080301`,
  and repo `20260710000000_client_subscription_management` versus production
  `20260710161851`. The filenames match; only the versions differ.
- **Impact:** `supabase db push` and `supabase migration up` select work by
  version, so both would treat all 25 as pending and replay 22 already-live
  migrations, including the provider-neutral payments foundation, the 152-row
  system exercise library, and client subscription management. Not all are
  idempotent. This is a production-incident path, not merely a slow one.
- **Containment:** L12 was applied as a single explicit statement plus a pinned
  `schema_migrations` row and is now correctly registered, never via a
  version-based push. Nothing else was repaired because reconciling the remaining
  25 versions is a separate reviewed change.
- **Genuinely unapplied:** The remaining 3 repository migrations are truly absent
  from production — `20260727000000_auth_user_trigger`,
  `20260727000100_legal_documents_reference_data`, and
  `20260728000000_rpc_execute_acl_hardening`. All three were verified to be no-ops
  against current production: the auth trigger already exists, the 6 legal
  document rows already exist, and all four hardened RPC ACLs already match the
  intended grants (`anon` execute counts are 0). They need reconciliation, not
  application.
- **M1 mapping status (2026-07-29):** The documentation-only mapping is complete
  in [MIGRATION_HISTORY_RECONCILIATION.md](MIGRATION_HISTORY_RECONCILIATION.md).
  All 25 versions are accounted for with content-level evidence: 22 live
  repository migrations map to 25 differently versioned production rows (two
  repository files consolidate multiple production entries), and the remaining
  3 have exact no-op proofs. The expected relation/column/constraint/index/policy/
  function/trigger inventory had no missing item, the 22-function ACL matrix had
  zero mismatches, and no partial application was found. Production remained at
  64 registry rows; no repair, migration, push, or schema/data mutation occurred.
- **Resolution (2026-07-29):** The separately approved M2 repair recorded the
  approved 25 repository versions as applied, one version at a time, without
  applying migration SQL. The registry moved from **64 to 89 rows**. All 25
  differently versioned production rows were preserved, and the original 64
  registry rows remained byte-for-byte unchanged.
- **Verification:** All **64 of 64** repository migration versions are now
  represented in production history, with **0 absent**. The added set equals the
  approved 25 exactly. Catalog and application-row fingerprints were unchanged,
  and the L12 contract remained 1 registry row, 6 RESTRICTIVE policies, 5
  PERMISSIVE policies, and 0 RESTRICTIVE `SELECT`/`ALL` policies. Independent
  read-only audit found no blocker, major, or minor issue.
- **Remaining:** None for ISSUE #18. Production `supabase db push` and
  `supabase migration up` remain prohibited until their target selection,
  pending-version behavior, transaction model, rollback behavior, and complete
  end-to-end production procedure receive separate validation. That continuing
  restriction is no longer based on absent repository versions.

## 19. Rehab and Athletic Performance shells rendered together
- **Symptoms:** The dashboard showed both service lanes at once — Athletic
  Performance navigation appeared inside the Rehab shell and vice versa.
- **Root cause:** `app.html` shipped a bare `<body>` with no service-lane class.
  Every lane visibility rule in `css/neucore-premium.css` is scoped under
  `body.service-rehab` or `body.service-athletic`, so with neither class present
  **no rule applied and nothing hid the other lane**. The athletic nav items'
  only other protection was an inline `style="display:none"`, which
  `setRoleVisibility()` in `js/dashboard.js` strips for every coach and admin
  (`el.style.removeProperty('display')`) — and it does so ~33 lines before
  `setService('rehab')`, the only code that ever sets the body class. On any path
  where that profile load did not finish, the mix was permanent rather than a
  flash. `#screen-app` carries no `hidden` class in the markup, so the shell
  paints from the first frame.
- **Fix:** Declare the default lane in the markup — `<body class="service-rehab">`.
  The hide rule is then in force before any script runs, and `setService()`
  remains idempotent. Frontend-only; no CSS file was modified, so the
  Antigravity-owned stylesheets are untouched.
- **Verification:** Measured in Chromium against the real stylesheets and the
  real nav markup. With no lane class both nav items compute to `display: flex`
  (the bug reproduces); with `service-rehab` the athletic nav computes to `none`
  and rehab to `flex`; with `service-athletic` the reverse. Full-page browser
  verification was **not** possible — `app.html` bounces an unauthenticated
  visitor to `index.html`, and no authenticated session was available. Real
  authenticated smoke was not performed.
- **Regression guard:** `tests/unit/service-lane-default.test.js` asserts the
  `<body>` default, that all 44 nav elements carry exactly one lane class, and
  that the lane rules stay scoped under the body classes. Verified by removing
  the class and watching the test fail.

## 20. Account deletion had never worked for a real user (resolved 2026-08-02)
- **Symptoms:** Deleting a user account raised a raw foreign-key error. Deleting a
  freshly created test account worked, which is why it went unnoticed.
- **Root cause:** 20 foreign keys referencing user-owned data carried no
  `ON DELETE` clause. The SQL default is `NO ACTION`, so any user with a program,
  workout log, assessment or comment was a hard block. This was never a partial
  failure - deletion was impossible for anyone who had actually used the product.
- **The subtle part:** 5 of the 20 were **transitive** blockers one level down a
  cascade chain. Auditing only the FKs that point directly at `profiles` or
  `auth.users` finds 15 and moves the failure one table along rather than fixing
  it. The audit has to follow each cascade to its leaves.
- **Fix:** PR #180 - `20260806000000_user_delete_fk_rules.sql`, 4 `CASCADE` and
  16 `SET NULL`.
- **Verified:** Applied to production. 0 `NO ACTION` FKs remain; 75 CASCADE /
  68 SET NULL / 1 RESTRICT; all 144 constraints validated.
- **Remaining:** One real end-to-end account deletion by the owner, on an account
  that owns data, to confirm the cascade behaves as intended in the app rather
  than only in the catalog.

## 21. Every Sentry event reported the same release (resolved 2026-08-02)
- **Symptoms:** Sentry could not distinguish which deploy an error came from;
  every issue carried release `20260702b`.
- **Root cause:** `js/monitoring.js` hardcoded `APP_VERSION`. It is a classic IIFE
  served as a plain `<script src>`, so Vite never parses it and no build-time
  substitution reached it.
- **Fix:** PR #178 - a Vite `inject-build-stamp` plugin head-prepends
  `window.AST9_BUILD_ID` (commit SHA) before the script runs; monitoring reads it.
- **Verified:** The deployed page carries the real SHA.
- **Trap for the next person:** `app.html` bounces signed-out visitors to the
  landing page, which never loads `monitoring.js`. Checking `window.Sentry` after
  that redirect produces a false negative - snapshot with `addInitScript` instead.

## 22. A delegated frontend change shipped a file that did not parse (caught pre-merge, 2026-08-03)
- **Symptoms:** None in CI. `npm run build` succeeded and all 163 unit tests
  passed. The delivered `js/rpm/graph-builder.js` was nevertheless a **syntax
  error** and the entire Reactive Graph tab would have been dead on arrival.
- **Root cause:** A new function was pasted into the middle of an unterminated
  template literal, leaving two `_renderDiagonalGraph` declarations and a call to
  a `_renderEmptyState` that existed nowhere in the file.
- **Why no gate caught it:** `graph-builder.js` is loaded as a plain
  `<script src>` at `app.html`. It is **not in the Vite module graph**, so the
  build never parses it, and no unit test imports it. `node --check` was the only
  thing that found it.
- **Fix:** Rejected before merge and returned for repair; the merged result
  (PR #190) parses and was measured in a browser.
- **Remaining:** The class of defect is still uncaught by CI. See
  KNOWN_LIMITATIONS L15.

## 23. Supabase CLI dry-run printed a live credential (incident, 2026-08-02)
- **Symptoms:** `supabase db dump --dry-run` printed a freshly minted
  `cli_login_*` user and password to stdout, along with the host.
- **Root cause:** The CLI **ignores `SUPABASE_DB_URL`** and silently falls back to
  the currently linked project when no explicit target flag is given. The dry-run
  mints and displays real credentials rather than a placeholder.
- **Who caused it:** Claude, while designing the backup script. Reported
  immediately; the credential was not reused and the linked project was not
  touched afterwards.
- **Fix:** The backup script was redesigned around `supabase db dump --linked`, so
  no credential passes through argv or the environment at all, plus
  `sanitizeOutput()` redaction and `assertLinkedProjectIsProduction`. PRs #177,
  #181.
- **Remaining:** **Owner must rotate the exposed `cli_login_*` token.** Until that
  is done this issue is open.

## 24. Clicking a phase put the popup off the canvas (resolved 2026-08-04)
- **Symptoms:** Clicking any phase on the Reactive Graph showed the detail popup
  jammed at the left edge and mostly clipped - identically for every phase - so
  the "Expand & edit phase" action was effectively unreachable.
- **Root cause:** `_showNodePopup` positioned from the block's **inline** style:
  `pop.style.left = nodeEl.style.left`. That worked for the old diagonal nodes,
  which carried inline `left`/`top`. Horizontal-timeline blocks carry only
  `width`/`min-width`/`flex`, so `left` resolved to `''` and `top` became the
  invalid `calc( + 30px)`. Both declarations were dropped and the popup fell back
  to its static position. **Measured: x = -99.3px for every phase at every
  viewport.**
- **Compounding cause:** even after the JS was corrected, `.nc-dgraph-popup`
  still carried `transform: translate(-50%, 12px)`, centring the popup a second
  time and pushing it back outside the canvas.
- **Fix:** PR #193 - position from `getBoundingClientRect()` relative to
  `#nc-dgraph`, append before measuring so the real `offsetWidth`/`offsetHeight`
  drive the clamp and flip, and delete the duplicate CSS block carrying the
  translate.
- **Verified:** 15 cases (5 phases x canvas 1072 and 420, plain and rich
  popups), measured after entry animations settle: zero popups outside the
  canvas, every popup tracking its block centre, clamping engaging on the narrow
  canvas.
- **Remaining:** No authenticated smoke - the measurements use the real
  stylesheet and real markup but never sign in. See KNOWN_LIMITATIONS L14. This
  bug is exactly what that gap allows through.
- **Why it shipped:** introduced by the diagonal-to-timeline migration (#190).
  The migration was verified for geometry, contrast and reachability, but the
  probe never *clicked* a phase - and the file parses fine, so the new parse
  guard would not have caught it either.

## 25. backdrop-filter had never rendered anywhere in the app (resolved 2026-08-04)
- **Symptoms:** Every frosted-glass surface rendered flat. No blur, in any
  release. Not a regression - it had never worked.
- **Root cause:** the source declared the standard property first and the
  `-webkit-` form second. CSS resolves duplicates last-wins and the minifier
  keeps the last of a prefixed/standard pair, so the build emitted **only**
  `-webkit-backdrop-filter`. Chrome 151 does not support that alias:
  `CSS.supports('-webkit-backdrop-filter', 'blur(8px)')` is `false`, and an
  element with only the prefixed declaration computes `backdrop-filter: none`.
- **Fix:** PR #194 - 37 declaration pairs reordered to prefix-first across 5
  stylesheets. Pure reorder, identical line multisets, zero value drift.
- **Verified:** built CSS went from 21 standard / 64 prefixed to 63 / 64, and the
  editor scrim that computed `none` now computes `blur(12px)` on the deployed
  site.
- **Guarded:** `tests/unit/css-vendor-prefix-order.test.js` fails on any
  standard-first pair.
- **Dead ends recorded so they are not retried:** `browserslist` has no effect
  (Vite 8 ignores it for CSS); `build.cssTarget` does not restore the standard
  property; `cssMinify: false` works but costs 240KB.

## 26. The movement analysis was lower-body only (resolved 2026-08-26)
- **Symptoms:** The owner reported "still there is no full body analysis, it is
  all lower body". The simulation page's deficit cards, the score panel and the
  activation chart all described hips, knees, ankles and feet, and said nothing
  about the spine or shoulder — for every client, regardless of what was entered.
- **Previously recorded cause — WRONG.** This was on file as a *source-scope
  limit*: the reference book was assumed to cover the lower body only, so the
  analysis was assumed to be as complete as the source allowed. That verdict
  explained the activation chart alone and was carried over to the whole feature
  without being re-checked. The source has extensive axial, shoulder and gait
  material (Table 9-11, Figs 9-54/55/56/66, Ch. 5 2:1 scapulohumeral rhythm,
  Ch. 15 excursions).
- **Actual root cause — three independent failures, all inside our own code:**
  1. **Engine drift.** Two gait engines exist. `js/gaitEngine.js` carried 15
     rules; `src/neucore/gait/GaitRules.js` — the one that actually drives the
     simulation page — carried 10, and the 5 it was missing were **every** spine
     and shoulder rule. Nothing reported the divergence.
  2. **Rules dead on supply.** Three more never fired at all: one compared a
     `select` against a value no `<option>` emits, one read an element id absent
     from the form, and one needed a numeric input the form did not have.
  3. **Collected and dropped.** `readForm()` gathered upper-body fields and then
     did not pass them on, so scoring never saw them.
- **Fix:** PR #208 — engines levelled, dead rules repaired, `readForm()` extended
  (shoulder abduction, thoracic rotation/flexion/extension, parsed lumbar
  values), and a new cross-region `js/integrationEngine.js` reporting how one
  region's restriction is paid for by another. Visible deficit cards went from
  **4 to 10** on the same input.
- **Guarded:** `tests/unit/gait-engine-parity.test.js` fails if the two engines'
  rule sets diverge again; `tests/unit/integration-chain-analysis.test.js` pins
  the Neumann values and asserts a missing input yields `not_assessed` rather
  than a computed finding.
- **Lesson (recorded because it cost the most):** *check collected-and-dropped
  before blaming the source.* A plausible external explanation was accepted for
  an internal defect, and it suppressed the investigation for a long time.

## 27. Chart.js cannot recover from a first paint inside a folded panel (2026-08-26)
- **Symptoms:** The new scapular activation chart rendered a blank canvas. The
  canvas reported plausible dimensions and threw nothing; it simply had zero
  painted pixels — 0 in the page against 48,836 in an isolated probe.
- **Root cause:** Chart.js defers its first paint to an animation frame. The
  analysis panels fold shut on the line after the chart is constructed, so that
  frame landed in a `display:none` box. Once that happens the instance is dead:
  it is never retina-scaled, and `resize()`, `render()` and `update()` all leave
  it blank.
- **Dead ends recorded so they are not retried:** dispatching a window resize and
  calling `chart.resize()`; adding `update('none')`; deferring construction by
  one `requestAnimationFrame`; observing the **canvas** with a `ResizeObserver`
  (Chart.js pins the canvas's inline width, so its own box never changes and the
  observer never fires); and guarding on the panel element (wrong node — the fold
  hides a wrapper *inside* the card, so the panel keeps a box).
- **Fix:** rebuild on every hidden→visible transition, triggered by the fold's
  window resize plus a `ResizeObserver` on the canvas **wrapper**. Measured
  207,295 painted pixels, surviving repeated fold cycles.
- **Guarded:** `tests/unit/shoulder-activation.test.js` asserts `_initChart` has
  exactly **one** call site and that it sits inside `_ensureChart`.
- **The guard's own near-miss:** the first version of that test sliced the file
  from `constructor(` to the first mention of `_ensureChart` and so never looked
  at `_build()`, which was still calling `_initChart()` directly. **The test
  passed while the defect it exists to catch was live.** It was rewritten to
  count call sites and then re-run against the real defect to prove it fails.

## 28. A category axis was addressed by value, so the cutoff band never drew (2026-08-26)
- **Symptoms:** The shaded "beyond this client's arc" band was silently absent.
  No error, no visual artifact — just nothing.
- **Root cause:** on a Chart.js **category** scale, `getPixelForValue` takes an
  **index**, not a data value. Passing `120` (degrees) resolved far off the right
  edge of the plot, and the fill was clipped away.
- **Fix:** interpolate the client's angle into index space, then across the
  plotted width between `getPixelForValue(0)` and `getPixelForValue(last)`.
- **Verified:** the band pixel now samples `246,250,248` — exactly `--bg-raised`
  in the bright theme — inside the band, and fully transparent before the cutoff.

## 29. An objective assessment can fail to save with the coach told it succeeded (RESOLVED 2026-08-27)
- **Status:** FIXED, owner-approved. Found while auditing the L21 persistence
  gap and initially left alone because surfacing it changes what coaches see.
- **Symptoms:** none visible — that is the problem. The coach sees
  "Program generated!" whether or not anything reached the database.
- **Mechanism**, three independent layers in `js/dashboard.js`:
  1. `_saveToSupabase(...)` is `async` but is called **without `await`**
     (line ~923). The success toast on the next line fires before the save has
     even finished, let alone succeeded.
  2. The whole function body — four inserts: `sessions`, `assessments`,
     `rehab_objective_assessments`, `gait_assessments`, `body_map_states` — sits
     in one `try` whose `catch` does nothing but
     `console.warn('Supabase save (non-fatal):', e.message)`.
  3. `if (!aRow) return;` exits silently when the parent `assessments` insert
     comes back empty, warning nobody, and every dependent insert is skipped.
- **Why it matters beyond L21:** an RLS denial, a network blip, a constraint
  violation or a paused project all currently look identical to success. There
  is no way to know from the UI, and no way to know afterwards from the data —
  the row is simply absent.
- **Why it makes the L21 ordering dangerous:** PostgREST rejects an entire
  insert if one column is unknown. So shipping the frontend that writes the new
  upper-body columns *before* the migration is applied would silently discard
  every objective assessment, lower body included, with a success toast on
  screen. That specific ordering is guarded by
  `tests/unit/upper-body-rom-columns.test.js`; the general swallow is not.
- **Not "non-fatal":** the comment calls the failure non-fatal, and for the
  legacy `sessions` row it arguably is. For `rehab_objective_assessments` it is
  the loss of the entire assessment the coach just performed.
- **A fourth silence, found while fixing it — and the one that mattered most:**
  `supabase-js` **returns** `{ error }` rather than throwing, and none of the
  five inserts destructured it. `await sb.from('sessions').insert({...})` looks
  complete and discards the error entirely. So an RLS denial, a constraint
  violation or an unknown column raised **no exception at all** and the
  `try/catch` never ran — the catch was largely decorative. The other three
  layers only mattered because this one let every failure through first.
- **Fix (2026-08-27):** every insert now destructures and checks its returned
  error; each failure returns `{ ok:false, stage, message }` naming the stage
  that failed; the empty-row case returns a failure instead of `return`; the
  caller **awaits** the save; and a failure raises a warning toast telling the
  coach plainly that nothing was stored, that the program is still on screen
  and exportable, and to keep the tab open. Failures also reach Sentry tagged
  `area: 'assessment_save'`, wrapped so monitoring can never itself throw and
  turn a reported failure into an unreported one.
- **Deliberately not changed:** a failed save does **not** block or discard the
  program. It is generated locally and stays valid; only storage failed, and
  telling a coach their work is gone while it is on screen would be its own
  dishonesty.
- **Guarded:** `tests/unit/assessment-save-reporting.test.js` — 10 cases,
  mutation-proven against all five regressions (a discarded error, a checked
  error not acted on, a dropped `await`, the restored `console.warn` swallow,
  and an unwrapped Sentry call).
