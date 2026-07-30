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
- **Remaining:** Perform a dedicated function-by-function inventory comparing
  baseline ACLs, historical migrations, SECURITY DEFINER bodies, and intended
  caller roles. Correct baseline generation or add a reviewed post-baseline ACL
  manifest so future isolated projects cannot recreate role-grant drift. Do not
  classify every differing ACL as exploitable without examining its internal
  authorization.

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
- **Remaining:** Write the isolated-staging authorization cases first, then the
  migration. Re-confirm the live policy set against the real database before writing
  it — the baseline has drifted from production before (see #15). The table/actor
  analysis behind the decision was repository-derived, not read from production.

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
