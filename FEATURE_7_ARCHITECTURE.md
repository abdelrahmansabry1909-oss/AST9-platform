# Feature 7 — Assessment Results / 3D Hologram Integration

**Status:** ✅ IMPLEMENTED (S1–S4). Frontend-only — no migrations / edge / RLS / AI changes. Commits: `46813c5` (S1), `9d11787` (S2), `5f7b2d4` (S3), + S4 (verify/simplify/docs).
**Branch:** `claude/interesting-buck-452459` · **HEAD:** `6af242f`
**Locked scope decisions (user, this session):**
1. **3D model source = the existing procedural NeuCore skeleton** (`GLBSkeleton` / `LoadVisualizer`). The separate `D:\ecorche_platform` `.glb` is **out of scope** — a future, cross-project swap behind the same component surface.
2. **Scope = client-dashboard integration *plus* a coach parity view.**

---

## 0. Executive summary

F7 was specced as "wire the client Assessment Report card to real data and cross-link it to the 3D body map." Investigation shows the client "real-data" path is **currently dead**, so F7 is **fix + complete**, not greenfield:

- `clientDashboard._loadLatestAssessment()` queries `rehab_objective_assessments` with `.eq('client_id', …)` — **that table has no `client_id`** (it's keyed by `assessment_id`). PostgREST 400s, the error is swallowed, and the hero/report **always fall back to illustrative numbers**.
- `deriveLoadProfile(assessment)` reads `assessment.joint_data` — but `joint_data` lives in **`body_map_states`**, never on the objective row — and references field names that don't exist (`sp_flex_pain` vs the real `spine_flexion_pain`). So the pain-driven coloring is always zero even when data exists.

**The good news (verified live):** every table F7 reads already has the right data and **client + coach RLS already permit every read**. So F7 is a **pure frontend integration**:

> **No DB migrations. No new tables/columns. No RLS changes. No edge functions. No storage. No AI.**

This makes F7 the lowest-risk possible feature and fully consistent with the production-safe discipline established during stabilization.

---

## 1. Objective

1. **Fix** the client dashboard so the 3D hologram + Assessment Report show the client's *actual* latest assessment (objective ROM + coach-painted body-map joints + gait + subjective notes).
2. **Cross-link** the assessment to the 3D body map: the hologram hotspots reflect the real assessed/painted regions (Point A), with the Target (Point B) toggle intact.
3. **Coach parity:** a coach can open any assigned client and see the *same* hologram + assessment snapshot, read-only.
4. Do all of the above by **reusing one shared loader + one shared view component** (no copy-paste between client and coach surfaces).

**Non-goals:** swapping in the ecorché `.glb`; authoring/editing assessments from the client side; new clinical scoring formulas (the existing deterministic `deriveLoadProfile` blend stays, with its field bugs fixed); coach-progress-surface unification (separate deferred item).

---

## 2. User flow

### Client
1. Client logs in → `Dashboard.showSection('dashboard')` → `ClientDashboard.render()`.
2. Hero shows "Loading…", then the **3D hologram colored by their latest assessment** — overloaded regions warm/red (Point A), with a toggle to the balanced Target (Point B).
3. **Assessment Report** card shows real **True Driver** (`phase_recommendation`), **Reported Symptoms** (subjective `external_pain` / objective `pain_flags`), **Coach's notes** (`recap_notes`/`free_form_notes`).
4. If no assessment exists yet → the existing empty-state copy (unchanged).

### Coach
1. Coach → **Clients** table → new per-row action **"◉ Recovery"**.
2. Opens a read-only **Recovery Snapshot** modal for that client: same hologram + same Assessment Report rows, plus a small objective summary (composite/ROM/asymmetry).
3. Closing the modal disposes the 3D context (no WebGL leak). Coach RLS already grants read of the client's assessment + body-map rows.

---

## 3. Technical architecture

### Current pieces (reused, unchanged surface)
- `src/neucore/client/LoadVisualizer.js` — wraps `BodyCanvas` + `GLBSkeleton`; takes `profile = { currentA, targetB, hasRealData }`; `setState('A'|'B')`, `destroy()`. **Reused as-is.**
- `src/neucore/client/loadMetrics.js` — `deriveLoadProfile()`, `loadToColor()`, `REGION_TO_JOINT`. **Bug-fixed** (see §8).
- `window.LoadVisualizer` / `window.deriveLoadProfile` bridges in `src/main.js` (ADR-002). **Reused.**
- `js/clientDashboard.js` — client home renderer. **Rewired** to the shared loader.
- `js/clients.js` — coach Clients table. **One row action + one modal added.**

### New piece (one small module)
- **`js/assessmentSnapshot.js`** (`window.AssessmentSnapshot`) — the single source of truth for "load a client's latest assessment bundle," usable by both client and coach surfaces.
  - `loadLatest(clientId)` → `{ assessment, objective, gait, subjective, bodyMap, profile, hasRealData }`
  - `mountHologram(hostEl, snapshot)` → builds a `LoadVisualizer` from `snapshot.profile`; returns a handle with `setState`/`destroy`.
  - `renderReport(hostEl, snapshot)` → the True Driver / Reported Symptoms / Coach's notes rows (the existing `_renderAssessmentReport` logic, lifted here so client + coach share it).

### Correct data path (replaces the broken one)
```
profiles(id=clientId)
   └─ assessments        WHERE client_id = clientId   ORDER BY created_at DESC LIMIT 1   →  A (has client_id ✅)
        ├─ rehab_objective_assessments  WHERE assessment_id = A.id   →  objective (ROM, scores, flags)
        ├─ gait_assessments             WHERE assessment_id = A.id (or client_id) → gait
        └─ body_map_states              WHERE client_id = clientId (or assessment_id = A.id) ORDER BY updated_at DESC → bodyMap.joint_data
   └─ subjective_assessments WHERE client_id = clientId ORDER BY created_at DESC LIMIT 1 → subjective
```
Then: `profile = deriveLoadProfile({ ...objective, joint_data: bodyMap?.joint_data })`.
`joint_data` (coach-painted pain per joint: `{ LumbarSpine:{pain_scale}, RightHip:{…}, … }`) is the **primary** hotspot driver; objective ROM deficit augments — exactly what `deriveLoadProfile` already blends once it's actually fed.

---

## 4. Database changes
**None.** All tables/columns exist. F7 only changes which columns the client reads and how rows are joined.

## 5. New tables / columns
**None required.** (Optional future enhancement, *not* in F7: a generated/derived `assessments.client_id` denormalization on `rehab_objective_assessments` to simplify queries — explicitly deferred; the join works today.)

## 6. RLS impact
**None — verified live.** The reads F7 performs are already allowed:
| Table | Client read | Coach read |
|---|---|---|
| `assessments` | `assessments_client_read` (`client_id = auth.uid()`) | `assessments_coach_all` (admin / coach_id / assigned_coach) |
| `rehab_objective_assessments` | `rehab_obj_client_read` (join → `a.client_id = auth.uid()`) | `rehab_obj_coach_all` |
| `gait_assessments` | `gait_assessments_client_read` | `gait_assessments_coach_all` |
| `body_map_states` | `body_map_states_client_read` | `body_map_states_coach_all` |
| `subjective_assessments` | `subj_assess_access` (client_id OR coach_id) | same |

The broken query fails on a **missing column**, not on RLS. No policy changes needed. F7 client surface is strictly read-only; body-map authoring stays a coach-only write path (unchanged).

## 7. Edge function / Storage / AI impact
**None.** No function calls, no buckets, no LLM. (The hologram is procedural; assessment text is already in Postgres.)

---

## 8. Frontend impact (the whole feature)

**Bug fixes (core of F7):**
1. `loadMetrics.js` — accept `joint_data` from the merged object (already does via `assessment.joint_data`); fix spine field names `sp_flex_pain → spine_flexion_pain`, `sp_ext_pain → spine_extension_pain` (booleans). Keep the deterministic blend + bounds.
2. Replace `clientDashboard._loadLatestAssessment()`'s invalid `client_id` filter with the `assessments → rehab_objective_assessments` join (via the shared loader).

**New / changed files:**
| File | Change |
|---|---|
| `js/assessmentSnapshot.js` *(new)* | Shared `loadLatest` / `mountHologram` / `renderReport`. ~120 lines. |
| `js/clientDashboard.js` | Use `AssessmentSnapshot` for the hero profile + report; feed merged `joint_data`; delete the dead local loaders (or thin-wrap them). |
| `src/neucore/client/loadMetrics.js` | Field-name fixes; tolerate merged input. |
| `js/clients.js` | Add per-row **"◉ Recovery"** action → `Clients.openRecovery(clientId, name)` opening the modal. |
| `app.html` | One hidden modal shell (`#modal-client-recovery`) with a canvas host + report host + script include for `assessmentSnapshot.js`. |
| `css/neucore-design-system.css` *(maybe)* | Minor modal layout only if existing classes don't cover it. |

**Component reuse / altitude:** client dashboard and coach modal both call the *same* `AssessmentSnapshot` API — the only difference is the host element and that the coach passes a `clientId` they're authorized to read. No duplicated derivation or rendering logic.

---

## 9. Migration strategy
N/A — no DB or deploy migration. Ships as a frontend change set; GitHub Pages picks up the next `npm run build`. Each step is independently shippable.

---

## 10. Risks & mitigations
| Risk | Likelihood | Mitigation |
|---|---|---|
| **Two WebGL contexts** (client hero + coach modal) → context-loss / leak | Med | Modal builds its `LoadVisualizer` on open and **`destroy()`s on close**; reuse the single-instance guard pattern already in `clientDashboard._mountVisualizer`. |
| `joint_data` shape differs from `{Joint:{pain_scale}}` assumption | Med | Verify against live rows before coding; loader normalizes + falls back to objective-only; empty → existing illustrative fallback (no crash). |
| Field-name fix wrong (column mismatch) | Low | Cross-checked against live `information_schema`; covered by the derive unit checks. |
| Regression to coach assessment **authoring** (`main.js` save path) | Low | F7 is read-only and additive; does not touch the paint/save flow. Regression test confirms authoring still writes `body_map_states`. |
| Clients with zero assessments | High (early users) | Empty-state path already exists and is preserved on both surfaces. |
| Perf of `GLBSkeleton.build()` in a modal | Low | Lazy-build on modal open; spinner; retry button already in `LoadVisualizer`. |

---

## 11. Test strategy
- **Derivation checks** (`deriveLoadProfile`): inputs (a) null, (b) objective-only, (c) joint_data-only, (d) both → all regions bounded 0–100; `hasRealData` true only when a real signal is present; spine pain flags now actually move Lower Back load.
- **Live data smoke (MCP, read-only):** pick a client that has `assessments` + `rehab_objective_assessments` + `body_map_states`; confirm the join returns the expected rows and `joint_data` shape; confirm a client with none returns empty cleanly.
- **Manual (app):**
  - Client: hero colors reflect real regions; A/B toggle; report rows populated; no console 400s (the old `client_id` error is gone).
  - Coach: "◉ Recovery" opens the same view for an assigned client; closing disposes the canvas; a non-assigned client is not reachable (RLS).
  - Empty-state for a fresh client on both surfaces.
- **Regression:** coach live assessment authoring still saves `body_map_states`; client dashboard Chart.js metric cards still render; subscription pill/banner unaffected.
- **`/simplify`** pass on the diff before final commit (established workflow).

---

## 12. Rollback strategy
Pure frontend, no stateful changes. Rollback = `git revert` the F7 commits and rebuild; nothing to undo in DB/edge/storage. Because each step is its own commit, a single problematic step can be reverted without losing the others.

---

## 13. Incremental execution plan (one logical step per commit)
> Implementation begins **only after approval.** Verify each step before the next; check for regressions continuously.

- **S1 — Shared loader + derive fix.** Add `js/assessmentSnapshot.js` (`loadLatest`) and fix `loadMetrics.js` field names. No UI wired yet. *Verify:* loader returns correct bundle for a known client (live read); derive checks pass. **Commit.**
- **S2 — Client dashboard rewire.** Point `clientDashboard` at the shared loader; feed merged `joint_data`; hero + report now show real data. *Verify:* app shows real regions, no 400s, empty-state intact. **Commit.**
- **S3 — Coach parity view.** Add `assessmentSnapshot.mountHologram`/`renderReport`, the `#modal-client-recovery` shell, and the `Clients.openRecovery` row action. *Verify:* coach sees the snapshot for an assigned client; modal disposes cleanly; RLS blocks non-assigned. **Commit.**
- **S4 — Verify + simplify + docs.** Full client+coach+empty regression sweep; `/simplify`; update `FEATURE_STATUS.md` / `PROJECT_STATUS.md` / `NEXT_STEPS.md`. **Commit.** Stop for signoff.

---

*Plan only. No code, schema, data, migration, edge function, or deployment was modified. On approval I will execute S1→S4 one commit at a time, verifying live (read-only) between steps and preserving the production-safe standards from the stabilization phase.*
