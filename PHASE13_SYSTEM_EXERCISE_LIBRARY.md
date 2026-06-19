# Phase 13 — System Exercise Library (David Grey import)

Status: **13A–13F are DONE.** 13A extraction + 13B database import are verified live in
production; 13C–13F (coach library UI, builder/publish video snapshot, client Train video,
PDF hyperlinks) are implemented in the app and verified mechanically (see "13C–13F — UI,
snapshot, client video, PDF").

## Source
Four David Grey Rehab PDFs (owner-supplied), read with PyMuPDF — text **and PDF link
annotations** (the blue clickable exercise names → YouTube). Tooling lives untracked in
`.smoke-d079a9f/phase13/` (`extract_dg.py`, `gen_import_sql.py`, `manifest.json`).

## Extraction report
| metric | value |
|---|---|
| raw http link annotations | 512 |
| merged name instances | 335 |
| → exercise instances | 310 |
| → resources excluded (intro video, FB group, site, course) | 25 |
| **unique exercises imported (deduped by YouTube video id)** | **152** |
| missing / non-YouTube video | **0** |
| flagged `needs_review` (residual messy names) | 5 (3 false positives, 2 cleaned by hand) |

Category counts: **Core 67, Upper Body 44, Lower Body 41.**
Upper subgroups (tags): Breathing & Mobility 20, Strength 19, Neck 5.
Lower IR/ER split (`target_area`): Internal Rotation 3, External Rotation 1,
IR/ER Combined 1, Other 36 (most lower exercises are not rotation-specific).

**Dedup rule:** one YouTube video = one exercise; repeated weekly-table appearances and
overlapping link rects collapse to a single row (provenance kept in `source_*`). Names
split across line-fragments were merged from the union of a video's link rects, isolating
the blue hyperlink span to avoid table-cell noise.

## Database design (additive, no destructive change)
System exercises reuse the existing `public.exercises` table — the Phase 5 RLS already
treats `created_by IS NULL` + `is_global = true` rows as the shared system library.
Imported rows set: `category` = body region (Upper Body / Core / Lower Body),
`target_area` = subcategory (IR/ER/Combined/Other or section), `tags` =
`{<subcategory>, <section>, david-grey, system}`, `video_url` + `youtube_url` =
canonical YouTube watch URL, `is_global = true`, `created_by = NULL`.

Migration `20260619000000_system_exercise_library.sql` (rollback in `rollbacks/`):
- Extends the `category` CHECK to also allow the three body regions (modalities still valid; NULL still allowed).
- Adds nullable provenance columns `source_key, source_file, source_program, source_section` + a unique index on `source_key` (NULLs distinct → coach-private rows unaffected).
- Idempotent upsert of the 152 rows `ON CONFLICT (source_key)`.

## Verification (all against production)
- Import byte-exact: independent MD5 over `source_key|video_url` (computed from the
  manifest in Python) == the same MD5 computed in Postgres = `2b58837151df8e340ca2ad9ac69f5119`.
- Counts: 152 system rows (+1 pre-existing coach-private = 153 total); 0 bad video URLs.
- **Idempotent:** re-running the upsert left the count at 152 (no duplicates).
- **RLS (impersonation):** coach reads all 152 system rows; **client browse = 0**
  (clients only see exercises referenced in their own published program); coach UPDATE on
  a system row affects **0 rows** (coaches cannot edit system exercises). Owner-only admin
  unchanged (`admin_count = 1`).

## Legal / IP note
The four PDFs are **copyrighted David Grey Rehab material**. Only **minimal coaching
metadata** was imported — exercise name, body-region category, YouTube link, and source
file/program labels. **No** full program text, notes, disclaimers, or PDF layouts were
imported, and AST9 does **not** redistribute the PDFs. Before any public/commercial use
of this third-party content, the owner must confirm the licensing/redistribution rights
with David Grey Rehab.

## 13C–13F — UI, snapshot, client video, PDF (implemented)

No schema or RLS change — these are presentation/snapshot only. The Phase 5 RLS already
exposes system rows to coaches read-only, hides the library from client browsing, and lets
clients see only the media inside their own program.

**Shared URL allow-list** — `ExerciseLibrary.safeYouTubeUrl(url)` (`js/exerciseLibrary.js`):
parses the URL, requires `http(s)`, requires a YouTube host (`youtube.com`, `www.`/`m.`
variants, `youtu.be`), extracts the id from `watch?v=` / `youtu.be/` / `embed|shorts|v|live`,
and returns a canonical `https://www.youtube.com/watch?v=<id>` or `null`. Hardened against a
stray `?v=` on a non-YouTube host. Embeds keep using `getEmbedUrl` (YouTube-id → `…/embed/…`,
`rel=0&modestbranding=1`, **no autoplay**).

**13C — Coach Exercise Library + picker.** The live library page renderer is
`Clients.loadExercises()` (`js/clients.js`, wired from `dashboard.js` `exercise-library`),
not `ExerciseUI`. It now loads once and filters in-memory by: **Region** chips (All / Upper
Body / Core / Lower Body), a **Focus** sub-row for Lower Body (All / Internal Rotation /
External Rotation / IR/ER Combined / Other), and **Source** (All / System Library / My
Exercises). Selecting a card shows a **right-side** preview: a safe YouTube embed (or a calm
"No video attached" state) + an "Open on YouTube" link. System rows carry a "System" badge;
the delete ✕ is shown only on the coach's own rows (RLS also blocks editing system rows). The
Manual-Builder `ExercisePicker` gained Upper Body / Core / Lower Body chips mapped to
`loadAll({ category })`. Chip/card styling reuses the existing `.btn`/`.exercise-card`/badge
classes and `--lime`/`--teal` tokens — no new visual language.

**13D — Builder/publish video snapshot** (`js/programPublish.js`). Picking from the library
(picker `onSelect` and the name-field autosuggest) now snapshots the exercise's `video_url`
onto the program row via `_snapVideo` (sanitized http(s)). At publish, `_snapshotVideos`
backfills every row: library-linked rows (`exercise_id`) take the library `video_url`;
free-text rows (generated programs) get a link **only** on a unique normalized-exact name
match against the library — ambiguous (0 or >1) matches are left empty, never guessed. The
match report is logged (`linked` / `name-matched` / `total`). No fake URLs; ongoing/one-time
modes and the revision trigger are untouched (snapshot is additive to the program JSON).

**13E — Client Train video** (`js/clientProgram.js`). `_meta(ex)` now falls back to a minimal
meta built from the row's own snapshot `video_url` when the live library row can't be
resolved, so generated / snapshotted plans surface ▶ Watch in day detail and guided
execution. Embeds open inline (no autoplay) with a modal fallback on narrow screens; the
existing safe iframe path is reused. `ExerciseInstructions.build` now drops the internal
`system` / `david-grey` provenance tags so they never appear as client instruction chips.
(The legacy in-page `WorkoutSession.mountWorkouts` tracker — reachable only via the hidden
`#nav-my-program` per CX F-1 — was intentionally left untouched.)

**13F — PDF export** (`js/pdfExport.js`). `exerciseTable` renders the exercise name as a
native jsPDF `textWithLink` (teal) when `safeVideo(ex.video_url)` resolves to a YouTube URL;
rows without a safe video stay plain ink text. A one-line caption appears only when at least
one row links. PDF program rows carry `video_url` after the 13D snapshot.

### Verification (13C–13F)
- `node --check` passes on all 7 changed JS files; `npm run build` (vite) succeeds and the
  `copy-legacy-js` step carries the changes into `dist/js`.
- `safeYouTubeUrl` unit-tested against the **real** module: 14/14 — accepts `watch` /
  `youtu.be` / `embed` / `shorts` / `m.youtube.com`; rejects `javascript:` / `data:` /
  `file:` / look-alike hosts (`evil.com/?v=…`, `youtube.evil.com`) / iframe strings / null.
- Live DB re-confirm (no DB change this increment): 152 system rows, all 152 with canonical
  YouTube URLs; the DB `category` values (Upper Body / Core / Lower Body) and Lower
  `target_area` values (Internal/External Rotation, IR/ER Combined, Other) **exactly match**
  the filter-chip values, so the filters return rows.
- Live RLS impersonation: real coach reads **152** system rows and edits a system row in
  **0** rows (blocked); client browses **0** system rows (blocked); admin edits **1** (manages
  all); `admin_count = 1` (owner-only admin intact).
- **Not performed:** interactive in-browser smoke as a logged-in coach/client (requires the
  owner's account credentials, which the assistant does not hold). Verification was mechanical
  (syntax, production build, real-module URL unit test) + live DB/RLS — not a click-through.
