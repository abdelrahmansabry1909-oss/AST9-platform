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
