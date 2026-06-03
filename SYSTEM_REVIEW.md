# NeuCore / AST9 — Full-System Engineering Review

**Mode:** Read-only. No code, schema, data, migration, or edge function was modified.
**Targets:** Frontend JS modules · Supabase schema · migrations · RLS · RPC functions · triggers · views · edge functions · dashboard/client/coach/admin flows.
**Ground truth:** Live project `byquokhcbagofshsclfy` (introspected via MCP: policies, functions, triggers, views, indexes, security + performance advisors, all 5 deployed edge functions) cross-checked against repo branch `claude/interesting-buck-452459`.
**Date:** 2026-06-01. Supersedes the pre-fix `SYSTEM_AUDIT.md` for the items it covers; C2/C1/H1-H2 from that audit are **resolved + frozen** and re-verified here.

Companion documents: **TEST_MATRIX.md** (test specs), **REMEDIATION_PLAN.md** (sequenced fixes). Findings here use stable IDs (`C-n`, `H-n`, `M-n`, `L-n`) referenced by both.

---

## 0. Coverage & method (honesty statement)

| Area | Depth |
|---|---|
| DB schema, RLS (49 tables), 25 functions, 14 triggers, 2 views, indexes, constraints | **Full** — live introspection + advisors |
| Edge functions (5 deployed + 2 on-disk) | **Full source** read |
| `auth.js`, `supabaseClient.js`, `subscriptionService.js`, `notificationsService.js`, `workoutSession.js`, `dailyRoutine.js`, `altExerciseRequest.js`, `progressionEngine.js`, `clientDashboard.js`, `subscriptions.js` | **Full read** |
| `dashboard.js`, `programPublish.js`, `clients.js` | **Key flows read** (phase upgrade, publish/override, AI call, create/delete-user, subscription writes) |
| `programGenerator.js`, `community*.js`, `exercise*.js`, `charts.js`, `pdfExport.js`, `scoring.js`, `gaitEngine.js`, `rpm/*`, `src/neucore/*`, `visitor.js`, `landing.js`, `progressReport.js`, `bodyMap3D.v2.js`, `platformExtras.js` | **Mapped via targeted grep** (privileged writes, localStorage, XSS-interpolation, edge calls, TODO) — not line-by-line |

Claims below are grounded in one of: live DB output, edge-function source, or a file:line I read. Items needing a check I could not perform from here are marked **VERIFY**.

---

## 1. Architecture breakdown

Single-page app (`app.html`, vanilla IIFE modules on `window.*`, no bundler; ES-module bridge `/src/main.js` for the Three.js visualizer). Supabase is the only backend: Postgres + RLS for authz, PostgREST for data, GoTrue for auth, 5 edge functions for privileged/async work. `index.html` is a **separate** public landing/visitor-survey surface.

**Authorization model (post-stabilization):** uniform "admin OR owning/assigned coach OR self" RLS across client-data tables; privileged `profiles` columns guarded by a trigger; phase changes + subscription renewals via guarded SECURITY DEFINER RPCs; notifications insert-locked and written only through `notify()`. This DB-resident model is the system's strongest layer. **The weakest layer is the edge-function tier**, which sits *outside* RLS (service role) and is where the new Critical findings live.

---

## 2. Flow-by-flow

- **Auth → routing:** `auth.js` login (75s wake-retry), profile load (synthetic fallback), client subscription gate (`active|grace` pass). Role drives section rendering. Sound; one fail-open (M-7).
- **Admin/coach create client/coach:** `clients.js` → `create-user` edge fn. ⛔ **unauthorized server-side (C-1).**
- **Coach publish program:** `programPublish._publish()` upsert + F6 republish sweep. Sound; JSON immutable; override layer correct.
- **Coach alt-exercise response:** `altExerciseRequest` + `tg_aer_*`. Sound.
- **Coach phase upgrade:** now via `set_client_phase()` RPC, UI gated on returned row. ✅ fixed (C1) — re-verified.
- **Coach subscriptions:** `reactivate` via RPC ✅; **`submit`/`activate`/`remove` write the table directly (H-2)** — admin-only post-Fix-3, two of them fail silently for coaches.
- **Client workout/routine/progression:** write-gated, DB-backed, view-driven. Sound except media re-render (M-5).
- **Notifications:** trigger → `notify()` → recipient-scoped reads. Sound.
- **Async:** `subscription-checker` cron expires + emails (service role). Functional; duplicates a DB fn (L-6); `send-email` unauthorized (H-4).

---

## 3. Findings by category (ranked)

### 🔴 CRITICAL

**C-1 — `create-user` edge function has no authorization (privilege escalation).**
`verify_jwt:true` only proves the caller is *signed in*, not that they are an admin/coach. The handler checks `if (!authHeader) 401` and then calls `supabase.auth.admin.createUser(...)` + `profiles.upsert({ role })` with the **service-role key**. Any authenticated user (including a client) can `POST /functions/v1/create-user` with `{email,password,full_name,role:'admin'}` and mint an **admin** account — fully bypassing the C2 `profiles` guard (RLS/triggers don't apply to the service role path). CORS is `*`.
*Evidence:* deployed source `create-user/index.ts`. *Impact:* total tenant compromise.

**C-2 — `delete-user` edge function has no authorization (account destruction).**
Same pattern: header-only check, then `supabase.auth.admin.deleteUser(user_id)` with service role. Any authenticated user can delete **any** account (admin, coaches, other clients) by id.
*Evidence:* deployed source `delete-user/index.ts`. *Impact:* data loss / denial of service / tenant takeover (delete admin, recreate via C-1).

> C-1 + C-2 re-open the exact threat class the signed-off C2 fix closed, one layer up. They are the headline of this review.

### 🟠 HIGH

**H-1 — `handle_new_user` trusts client-supplied `role` on signup (VERIFY signup-enabled).**
The `auth.users` insert trigger sets `profiles.role = coalesce(raw_user_meta_data->>'role','client')`. If GoTrue self-signup is enabled at the project level, a user can call the public `/auth/v1/signup` with `data:{role:'admin'}` and self-provision as admin. The app UI has no signup, but the API endpoint may be open.
*Evidence:* `handle_new_user` def. *VERIFY:* GoTrue "Allow new users to sign up" / `DISABLE_SIGNUP`. If enabled → **promote to Critical**.

**H-2 — `subscriptions.js` direct table writes (duplicate path + silent failure for coaches).**
`submit()` (INSERT, L198), `activate()` (UPDATE status, L224), `remove()` (DELETE, L254) write `subscriptions` directly, in parallel to the guarded `reactivate_subscription()` RPC used by `reactivate()`. After the signed-off Fix-3, the table is writable **only by admins**; for a genuine non-admin coach: `submit` throws an RLS error, while `activate`/`remove` affect **0 rows but show success** (no rows-affected check — the same silent-success class as the fixed C1). Masked today only because the sole operator is an admin.
*Evidence:* `subscriptions.js` 198/224/254; Fix-3 policy set (`subscriptions_admin_write` is the only write policy). *Impact:* broken/illusory subscription management for coaches; data-integrity confusion.

**H-3 — Edge-function repo ↔ production drift.**
Deployed (ACTIVE): `subscription-checker`, `generate-program`, `create-user`, `send-email`, `delete-user`. On disk (`supabase/functions/`): only `rpm-ai-suggest`, `visitor-survey` — neither deployed. The five live functions (including service-role user-management and email) have **no source in the repo**: unversioned, unreviewable, no disaster recovery, and (per C-1/C-2/H-4) insecure with no code-review trail.
*Evidence:* `list_edge_functions` vs `ls supabase/functions/`.

**H-4 — `send-email` has no authorization + unescaped HTML.**
Header-only check, then sends templated email to any `client_id`'s address via Resend (service role). Any authenticated user can trigger/spam emails to arbitrary clients; the `message` field (phase_upgrade) is interpolated into the HTML body unescaped (email HTML injection).
*Evidence:* deployed source `send-email/index.ts`.

### 🟡 MEDIUM

**M-1 — RLS `auth_rls_initplan` (45 policies).** Policies call `auth.uid()`/`is_admin()` unwrapped, re-evaluated per row. At scale every RLS-filtered scan pays per-row function cost. Fix: wrap as `(SELECT auth.uid())` / `(SELECT is_admin())`. *Evidence:* performance advisor.

**M-2 — Multiple permissive policies (91).** Overlapping permissive policies for the same role/action (incl. the SELECT + ALL pattern introduced by the Fix-3 unification, mirroring `client_programs`) are all evaluated and OR-combined per query. Correctness is fine; throughput suffers. Fix: consolidate to one policy per action where practical. *Evidence:* performance advisor.

**M-3 — 14 unindexed foreign keys.** e.g. `client_programs`, `client_routines`, `exercise_alternative_requests`, `notifications`, `phase_submissions`, `rpm_graphs`, `case_shares`, `ai_feedback_log`. Slows joins and parent-row deletes (cascade scans). *Evidence:* performance advisor.

**M-4 — Preview / from-scratch rebuild parity.** 10 pre-2026-05-15 migrations are no-op stubs; a fresh `supabase preview`/branch DB will lack `profiles`, `subjective_assessments`, `case_shares`, early RLS, etc. The one-time `supabase db pull --schema public` consolidation is still pending. Repo cannot rebuild production from zero. *Evidence:* `supabase/migrations/README.md`.

**M-5 — Workout tracker loses media/substitution context after Start.** `mountWorkouts` re-render uses `host._workouts || [workout]` and omits `libMap`; `renderClientProgram` never sets `host._workouts`. Thumbnails, ▶ Preview, ℹ Info, and the "🔄 Substituted" badge disappear on the active workout until reload. *Evidence:* `workoutSession.js` ~246/302; `programPublish.js` renderClientProgram.

**M-6 — `visitor_inquiries` anon INSERT `WITH CHECK true`.** Unauthenticated spam/abuse vector on the public form. Needs rate-limit/captcha at the edge. *Evidence:* security advisor.

**M-7 — Auth fail-open.** `_refreshSubscriptionState` returns `{effective_status:'active',_unverified:true}` if `SubscriptionService` is undefined. A load-order regression could ship a state where expired clients are treated active. *Evidence:* `auth.js`.

### 🟢 LOW

- **L-1** `rpm_touch_updated_at` has mutable `search_path` (only non-SECURITY-DEFINER fn missing it; all 19 secdef fns set it). *Advisor.*
- **L-2** GoTrue leaked-password protection disabled. *Advisor.*
- **L-3** anon may execute `is_admin()/is_coach()/is_admin_or_coach()/is_coach_or_admin()` (required by RLS; minor info surface). *Advisor.*
- **L-4** `dist/` holds stale build copies of the JS modules — **untracked** (`git ls-files dist/` empty) and referenced by no HTML. Confusion risk only. *ls + git.*
- **L-5** `_coachOfClient` returns null when a coach starts a session on a client's behalf → `workout_sessions.coach_id` unattributed. *`workoutSession.js`.*
- **L-6** Duplicate expiry logic: DB `check_subscription_expiry()` vs `subscription-checker` edge fn (two implementations; edge fn lacks email-dedupe/idempotency). *Both sources.*
- **L-7** `rpm/graph-viewer.js` uses `localStorage` (view-state cache) — minor deviation from the "DB single source of truth" principle established in the Stabilization Pass. *grep.*
- **L-8** Inconsistent `?v=` cache-busters across `<script>` tags. *app.html.*
- **L-9** Two `is_*` role-helper families coexist (`is_admin_or_coach` vs `is_coach_or_admin`) — redundant duplicates. *fn inventory.*

---

## 4. Specific requested checks

| Requested | Result |
|---|---|
| **Dead code** | `dist/*` stale untracked copies (L-4); legacy `index.html` is a live separate surface (not dead); no dead JS modules found among those loaded by `app.html`. Removed-in-Stabilization helpers are gone (verified no `_renderRecentSessions`/`toggleProgram` refs). |
| **Duplicate logic** | Subscription expiry (DB fn vs edge fn, L-6); subscription writes (RPC vs direct table, H-2); two role-helper families (L-9); per-module re-declared `esc()`/`_esc()` (benign convention). |
| **Architectural inconsistencies** | Privileged work split between guarded RPCs (good) and unauthorized service-role edge fns (C-1/C-2/H-4); subscription mutation has two competing paths (H-2). |
| **Security risks** | C-1, C-2, H-1, H-4, M-6, L-2, L-3. |
| **Data-integrity risks** | H-2 (silent 0-row writes), M-5, L-5; no DB-level phase-transition constraint (enforced only in `set_client_phase` RPC — acceptable since that's now the only path). |
| **Runtime failure paths** | H-2 silent no-ops; M-7 fail-open; edge fns return 400/500 without client-side surfacing in some callers (best-effort `catch` swallows email failures — intended). |
| **Repo ↔ production drift** | H-3 (edge fns), M-4 (migration stubs), L-4 (dist). Migration registry ↔ disk filenames are otherwise 1-to-1 (30↔30, re-verified). |
| **Missing indexes** | M-3 (14 unindexed FKs); 73 unused indexes (candidates for removal, INFO). |
| **Missing constraints** | All tables have RLS + PKs. No CHECK on phase transitions at DB level (mitigated by RPC). `subscriptions.plan` is an int with no domain check (3/6/12 enforced only in JS). Low. |
| **RLS weaknesses** | None of the prior leak class remains (Fix-3 verified). Remaining RLS items are performance-shaped (M-1/M-2), not authorization holes. |

---

## 5. Strengths (preserve)

Notify-via-RPC + insert-locked `notifications`; immutable published-program JSON + non-destructive override layer; version-stamped `v_client_progression` (v1.1); **all 19 SECURITY DEFINER functions set `search_path`**; `profiles` privilege-guard trigger (C2 fix); `set_client_phase` RPC with server-side transition rules (C1 fix); unified assigned-coach RLS (Fix-3); `security_invoker` views so table RLS propagates; migration registry aligned; consistent output-escaping in reviewed render paths.

---

## 6. Verdict

**Not production safe.** The DB/RLS layer is now solid, but the **edge-function tier is an unauthorized service-role surface**: `create-user` (C-1) and `delete-user` (C-2) let any signed-in user create an admin or delete any account, which re-opens — one layer above — the tenant-compromise class the signed-off C2 fix closed. `handle_new_user` (H-1) may extend this to anonymous signup. These must be fixed and re-verified before any feature work or production exposure. `subscriptions.js` (H-2) and the edge-function repo drift (H-3) are the next priorities.

Findings are sequenced for remediation in **REMEDIATION_PLAN.md**; verification specs are in **TEST_MATRIX.md** (see `SEC-EDGE-*` and `REG-SUB-*` as the gating cases).
