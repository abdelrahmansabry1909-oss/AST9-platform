# Phase 13 — System Exercise Library (David Grey import)

Status: **13A extraction + 13B database import are DONE and verified live in production.**
The coach/client UI surfacing + PDF-export hyperlinks (13C–F) are the next increment
(see "Remaining work").

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

## Remaining work (next increment — UI not yet built)
- **13C** Coach library UI: Upper/Core/Lower tabs + Lower IR/ER/Combined/Other filters +
  right-side video preview. (System rows are readable by coaches under RLS; whether the
  existing `exercisePicker.js` query already lists them or needs a tweak is to be verified
  as part of this step.)
- **13D** Manual-builder / program-publish: snapshot `video_url` into the published
  program JSON so client/PDF links stay stable.
- **13E** Client Train video display (note: `workoutSession.js`/`clients.js` already render
  a `video_url` "Watch demo" link + thumbnail, so most of this may already work once a
  system exercise is in a client's program — to be verified).
- **13F** PDF/print export: make exercise names clickable when a `video_url` exists; safe
  URL allow-list helper (YouTube/youtu.be only; block `javascript:`/`data:`/`file:`/iframe).
