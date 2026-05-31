# Feature 5 — Exercise Video Integration · Architecture Proposal

**Status:** Awaiting your sign-off · NO IMPLEMENTATION YET
**Branch:** `claude/interesting-buck-452459`
**Author:** Claude · 2026-05-30

---

## 0 · Goal (lifted verbatim from your message)

**Client Workout Experience** — video preview · expandable player · exercise instructions · notes · sets/reps/weight tracking.
**Coach Experience** — select exercises from library; exercise metadata automatically follows the exercise into the program.

---

## 1 · Audit findings

### 1.1 `public.exercises` (live) — already rich
| Column | Type | Used by |
|---|---|---|
| `id` | uuid PK | — (never linked from program JSON) |
| `name` | text | the *only* field that's currently in published programs |
| `category`, `phase` | text | Library filters |
| `video_url` | text | ✅ used in Library card thumbnail/preview |
| `thumbnail_url` | text | ✅ used in Library card |
| `cues`, `common_errors`, `progressions`, `regressions` | text × 4 | shown in Library detail; NEVER reach the program/client view |
| `tags`, `target_joints` | text[] | Library filters; not surfaced client-side |
| `created_by`, `created_at` | uuid, timestamptz | bookkeeping |

Live row count: **0** (the table exists empty — useful: no migration data risk).

### 1.2 `js/exerciseLibrary.js` + `js/exerciseUI.js` — already solid
- 5-minute cache, lookup by name/joint/phase
- YouTube helpers `getEmbedUrl(url)` + `getThumbnailUrl(url)` (auto-derive thumbnail from YouTube URL)
- YouTube playlist import (`fetchPlaylistItems` + `importFromPlaylist`)
- `ExerciseUI.openVideoModal(id, name, videoUrl)` — full-screen iframe player already implemented
- `ExerciseUI.addToProgram(exercise)` — appends a row to the live `#program-panel` post-Generate

**Verdict:** the library + video infrastructure already exists. Feature 5 doesn't build a new library — it threads what's already there into the program payload.

### 1.3 `js/programGenerator.js` → `js/programPublish.js` → `client_programs.program`
The exercise object that travels from generator to client is **plain text only**:
```json
{
  "name": "90/90 Hip IR PAILs/RAILs",
  "sets": 2,
  "reps": "2 min progressive",
  "tempo": "progressive",
  "rest": "60s",
  "notes": "Front leg in IR, start passive → build to 80% contraction"
}
```
*(verified live by inspecting the one published `client_programs` row)*

No `exercise_id`. No `video_url`. No `thumbnail_url`. No `instructions`. The publish editor (`_exerciseRow`) lets the coach type name/sets/reps inline as free text — there is no "Pick from Library" affordance and no library lookup at publish time.

### 1.4 `js/programPublish.js` `renderClientProgram` — read-only renderer
Renders the program object as-is. No exercise lookup. No video. Just name + notes + numeric prescription columns.

### 1.5 `js/workoutSession.js` — already half-prepared
- `_renderExerciseLogRow(ex, idx, existing)` reads `ex.name` only; `ex.exercise_id` is read once (line 391: `exerciseId: ex.exercise_id || null`) and threaded through to the DB log row. **The plumbing is already there — nothing populates it.**
- `workout_exercise_logs.exercise_id` FK to `exercises(id) ON DELETE SET NULL` is already in production (Feature 2 migration).

So **the data path from program → log row already accepts an exercise_id.** What's missing is the program ever carrying one.

---

## 2 · The gap, stated precisely

> The `exercises` table holds video/thumbnail/instructions/metadata. The program payload doesn't carry the `exercise_id`. Therefore nothing downstream of the publish step ever sees the rich data — the client gets a plain text name, the workout row can't show a video, the log can't analyze "across all clients doing exercise X".

Feature 5 closes this single seam.

---

## 3 · Schema options (ranked)

### Option A — **Zero schema additions (RECOMMENDED)**
Use the existing `exercises` table as-is. The change is *purely* the JSON shape of `client_programs.program.workouts[].{warmup,main,cooldown}[]`:

```json
{
  "exercise_id": "9b73…",                  // NEW — nullable FK target
  "name":  "90/90 Hip IR PAILs/RAILs",     // kept for free-text & legacy
  "sets":  2,
  "reps":  "2 min progressive",
  "tempo": "progressive",
  "rest":  "60s",
  "notes": "Coach override of the library cue text"
}
```

- New rows added by the "Pick from Library" picker carry `exercise_id`.
- Legacy rows (already published, name-only) keep working — the renderer falls back to the inline name.
- Free-text rows (coach typed a one-off) leave `exercise_id` null — equally supported.
- Library metadata (`video_url`, `thumbnail_url`, `cues`/etc.) is **looked up at render time** via `ExerciseLibrary.getById(exercise_id)` — already cached for 5 minutes by the existing library module.

**Why this is the right minimum:**
- No migration on `exercises` or `client_programs`.
- No data backfill — legacy programs continue to render as plain rows.
- Library is the single source of truth; if a coach updates a video URL after publishing, every client viewing that exercise sees the new URL instantly (no re-publish needed).
- Reversible — drop the proposal in one commit if it doesn't work; nothing in the DB needs unwinding.

### Option B — Add `default_prescription jsonb` to `exercises`
Single new column: `default_prescription jsonb` = `{sets, reps, tempo, rest}`. When the coach picks from the library, those defaults pre-fill the program row.
- Cost: one migration, one extra DB field on every library card editor.
- Benefit: nicer authoring UX (less typing).
- **Verdict:** worth doing later, not now. Option A unblocks the client experience first; defaults are an authoring polish.

### Option C — Add `instructions text` to `exercises`
A single client-friendly instruction block separate from the four clinical text fields (`cues`/`common_errors`/`progressions`/`regressions`).
- Cost: one migration; renderer logic decides instructions vs. fallback-concat.
- Benefit: cleaner client view than "cues + common errors + progressions" smashed together.
- **Verdict:** worth doing — but as a follow-on; **for v1, concatenate the existing four fields** at render time (with empty-segment skipping). Coaches who want a polished version can write into `cues` for now; we add a dedicated `instructions` field in a v2 once we know what the client UX actually wants.

### Recommendation
**Ship Option A only.** Zero schema change. All work in JS. If we hit UX friction, ship B + C as a tiny follow-up migration.

---

## 4 · JSON shape evolution — `client_programs.program.workouts[].*[]`

| field | v1 (today) | v2 (Feature 5) | who writes it | who reads it |
|---|---|---|---|---|
| `name` | required | required | publish editor / generator | render + workout row |
| `sets`, `reps`, `tempo`, `rest`, `notes` | optional | optional (unchanged) | publish editor | render + workout row |
| **`exercise_id`** | — | **optional uuid** | "Pick from Library" picker | render → lookup video/thumbnail/instructions |

Forward + backward compatible. Migration of existing rows = none.

---

## 5 · Module-by-module change list (proposed scope)

### 5.1 NEW — `js/components/exercisePicker.js`
Tiny reusable component (~200 lines IIFE → `window.ExercisePicker`):
- `open({ phase, category, onSelect })` — modal listing library cards (uses existing `ExerciseLibrary.loadAll(filter)`), search box, phase/category filter chips
- `onSelect({ exercise_id, name, defaults? })` callback returns the picked row
- Reused by **Feature 5 publish editor** AND **Feature 6 alt-response modal** (locked dependency — see §7)

### 5.2 `js/programPublish.js` — edit `_exerciseRow` only
Add a small "📚 Library" button next to the name input. Click → opens picker → on select: sets `_program.workouts[wi][key][i] = { exercise_id, name, sets: '', reps: '', ... }` and redraws. Existing free-text typing path unchanged.

### 5.3 `js/programPublish.js` — `renderClientProgram` (read-only)
For each row where `ex.exercise_id` is set:
1. `ExerciseLibrary.getById(ex.exercise_id)` (5-min cache, single lookup)
2. Add a thumbnail tile + ▶ Preview button next to the name → opens existing `ExerciseUI.openVideoModal(...)`.
3. Render a collapsed "ℹ Instructions" disclosure that expands to show concatenated `cues / common_errors / progressions / regressions` (empty segments skipped).

When `ex.exercise_id` is null → render unchanged (today's plain row).

### 5.4 `js/workoutSession.js` — `_renderExerciseLogRow`
Same upgrade as 5.3 inside the active workout tracker:
- Compact video thumbnail (60×40 tile) before the exercise name
- ▶ Preview opens the modal
- ℹ Instructions disclosure (collapsed by default — keeps row dense)
- The "⇄ Alt" button (Feature 3) sends `exercise_id` along with `exercise_name` to `AltExercise.openModal(...)` (already supported — service signature accepts `exerciseId`)

### 5.5 `js/workoutSession.js` — `logExercise` call site
Pass `exercise_id: ex.exercise_id || null` (one-line change — the data layer already accepts it; the FK is already there).

### 5.6 NEW — `src/components/expandable-player.css` (or inline)
- Tile state: 60×40 thumbnail, hover lifts
- Expanded state: card-width 16:9 iframe with collapse button
- Two interaction modes:
  - **Inline expand** — player expands within the workout row (preserves scroll context, doesn't block the page)
  - **Modal expand** — uses existing `ExerciseUI.openVideoModal` for full-attention viewing

Both modes use the same YouTube embed URL from `ExerciseLibrary.getEmbedUrl`.

### 5.7 NO changes to
- `js/exerciseLibrary.js` (already does everything we need)
- `js/exerciseUI.js` (its video modal is reused, not replaced)
- `js/dashboard.js` (no new sections / loaders)
- `js/auth.js`, `js/subscriptionService.js`, `js/notificationsService.js`, `js/progressionEngine.js`
- Any migration. Zero. ✓
- `index.html` (legacy shell — out of scope as always)

---

## 6 · Locked out of scope (deliberately deferred)

- **Defaults pre-fill** (Option B) — push to v2 after we observe authoring patterns
- **Polished `instructions` field** (Option C) — push to v2 once the client UX is real
- **Equipment / difficulty / duration metadata** — add only when filtering UX demands them
- **Custom uploaded videos** (vs. YouTube-only) — out of scope; the YouTube path is what every existing exercise uses
- **Offline video caching** — out of scope
- **In-player progress tracking** ("video watched 80%") — out of scope
- Touching the legacy `index.html`

---

## 7 · Dependency map with Feature 6 (Alternative Exercise Replacement)

Feature 5 is **strictly upstream** of Feature 6. The exact dependencies:

| Feature 6 need | Provided by Feature 5? |
|---|---|
| Coach's "Pick a substitute" UI | ✅ Yes — `ExercisePicker` component (§5.1) is the same component. Built once, reused twice. |
| Substitute carries video + instructions to client | ✅ Yes — `exercise_id` threading (§4) does this for free. |
| Client view shows the substitute, not the original | ⚠ Needs Feature 6 work: a new `substitute_exercise_id` column on `exercise_alternative_requests` + renderer logic in `renderClientProgram` to swap when a substitution exists for this (program_id, workout_key, exercise_index). |
| Coach can revert a substitution | Pure Feature 6 logic. |
| Progression engine attributes the workout to substitute (not original) | Already works — `workout_exercise_logs.exercise_id` is captured at log time (Feature 2 + Feature 5), so analytics naturally point at whatever the client actually performed. |

**Build order is locked:** Feature 5 first, then Feature 6. The `ExercisePicker` component is the seam — building it in Feature 5 makes Feature 6 trivial (one extra column + a renderer branch).

**One column will be needed for Feature 6 (not now):** add to a future migration `20260xxx_alt_exercise_substitute.sql`:
```sql
ALTER TABLE exercise_alternative_requests
  ADD COLUMN substitute_exercise_id uuid REFERENCES exercises(id) ON DELETE SET NULL;
```
Mentioned here for clarity — **not part of Feature 5's apply step.**

---

## 8 · Risks + edge cases

| Risk | Mitigation |
|---|---|
| Library exercise gets deleted while it's in someone's published program | `exercise_id` lookup returns null → renderer falls back to inline `name`. No crash. Same null-safety as `workout_exercise_logs.exercise_id ON DELETE SET NULL`. |
| YouTube link goes dead | Player shows "Video unavailable". Acceptable — we don't host video. Track via a future "broken video" detection if it becomes a problem. |
| Coach edits `video_url` in Library after publish | Client sees new URL on next view (lookup is live, not snapshotted). **Feature, not bug** — this is exactly why Option A is right. |
| Phase mismatch (Phase-3 exercise picked into a Phase-1 program) | Picker can pre-filter by `ns-phase`, but allow override. UI shows a small warning chip "Outside this phase". No hard block — coach knows best. |
| Privacy of cues/regressions text | All `exercises` rows are world-readable per existing RLS (`exercises_client_read FOR SELECT USING (true)`). No change. |

---

## 9 · Effort + scope estimate

| Module | Lines (est.) | Risk |
|---|---|---|
| `js/components/exercisePicker.js` (new) | ~180 | Low — wraps existing library API |
| `js/programPublish.js` `_exerciseRow` | +25 | Low |
| `js/programPublish.js` `renderClientProgram` | +50 | Low |
| `js/workoutSession.js` `_renderExerciseLogRow` | +40 | Low |
| `js/workoutSession.js` `logExercise` call site | +1 | Trivial |
| CSS for video tile + expand | +60 inline or new file | Low |
| **Total** | **~360 lines, one new component, zero migrations** | **Low** |

---

## 10 · Two open questions before I lock and execute

These two choices materially shape the JS layer. I'll wait for both answers before writing a line of code.

> Will deliver via `AskUserQuestion` immediately after you confirm "proceed with proposal". Preview of the questions:
>
> **Q1 — Video player UX:** inline-expand within the workout row (modern, less disruptive) · modal player (matches existing `ExerciseUI.openVideoModal`) · both side-by-side (thumbnail click = inline; "Open in modal" link = full).
>
> **Q2 — Library button placement in the publish editor:** dedicated "📚 Pick from Library" button per row · auto-suggest dropdown when typing an exercise name (matches existing names) · both.

---

## 11 · What I'm asking you to approve right now

Three things. If you say yes to all three, I open the two questions above, then lock + execute.

1. **Architecture: Option A (zero schema change, JSON shape evolution).** Library stays the source of truth; programs carry `exercise_id` going forward; legacy rows keep working.

2. **Scope: §5 only.** No defaults pre-fill, no new `instructions` field, no equipment metadata. Pure threading + reuse of existing video modal + the one new `ExercisePicker` component.

3. **Feature 6 dependency acknowledged:** `ExercisePicker` is designed for reuse in Feature 6; the `substitute_exercise_id` column is queued for Feature 6's migration, **not** Feature 5's.

Reply with go-aheads (1/2/3) or scope changes. I'll fire the two open questions and then build.
