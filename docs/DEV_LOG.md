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
- **Verification:** DB-verified — 10-scenario impersonated, rolled-back matrix
  (admin ✓, assigned coach ✓, other coach ✗, client ✗, months-range ✓,
  plan_name persist ✓; zero test rows left). Advisor `0028`/anon clean (explicit
  anon `EXECUTE` revoked, matching `reactivate_subscription`). `node --check` +
  `npm run build` green; boot smoke: modal fields present, no console errors.
  Owner authenticated smoke pending (no creds in this environment).

---

## Program versioning

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
