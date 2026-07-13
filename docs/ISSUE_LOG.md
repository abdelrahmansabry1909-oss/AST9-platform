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

## 9. Gait hip/knee reversal still snapped after the loop-reset fix
- **Symptoms:** After PR #125 removed the terminal-swing teleport, the femur still appeared to click when changing from hip extension back to flexion. The walk also felt mechanically timed rather than like a natural gait cycle.
- **Root cause:** The seven clinical poses were still equally spaced and joined with linear interpolation. Position was continuous, but angular velocity changed abruptly at every phase boundary (measured diagnostic peaks: knee 140 deg/s and hip 87.5 deg/s). `GaitEngine` also ran an independent 1.1-second equal-phase clock while the skeleton used a 2-second cycle, so highlights could disagree with the pose.
- **Fix:** `codex/gait-natural-kinematics-v2` adds physiological phase timing and bounded periodic monotone cubic curves, keeps each clinical keyframe exact, adds pelvic/trunk counter-rotation, moves kinematics onto the canvas frame, and makes highlights/telemetry consume the same authoritative phase. This loop consolidation also fixes a latent highlight bug: the old `_onPhaseChange` guard referenced a nonexistent public `body.skeleton` property and therefore always short-circuited, so joint highlights during gait playback had never been functional; they now activate from the simulator's phase events. The GLB femur and foot-center nodes are covered by an asset-level integration test.
- **Verified:** Boundary derivative tests pass at all seven boundaries; adjacent clinical ranges are not overshot; 60 fps frame-to-frame velocity change stays at or below 40 deg/s for all five motion curves; left/right sampling stays exactly 0.5 cycle apart; real-GLB femur and foot probes remain under frame-pop thresholds; production build passes. A mocked-auth local browser completed the ordered cycle and wrap with no relevant console errors and passed Stop → Start without duplicate renderers.
- **Remaining:** The simulator is intentionally an in-place clinical loop. A true fixed-world stance-foot lock requires a forward-translating locomotion scene (or moving treadmill ground and camera strategy), not a bounded root correction. See `KNOWN_LIMITATIONS.md` L10. Owner visual review of naturalness on the live deployment remains required after merge.
