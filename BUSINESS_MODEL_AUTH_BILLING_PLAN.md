# AST9 / NeuCore — Business Model · Auth · Billing · Production-Scale Plan

**Status:** PROPOSAL — awaiting approval. No implementation until approved.
**Author:** audit + architecture pass (presentation + business layer).
**Scope discipline:** Preserve RLS, F8/S4, Option A, storytelling arc, Recovery
Pulse, assessment architecture, client subscription gate. No fake payments, no
plain-password storage, no frontend-only enforcement.

---

## 0. Central architectural finding (read this first)

There are **two different "subscription" concepts**, and the codebase today only
implements the first:

| Concept | Exists today? | Granularity | Gates what | Source of truth |
|---|---|---|---|---|
| **Client access subscription** | ✅ Yes (mature) | per **client** (`subscriptions.client_id`, `plan` = months) | *Client* login (active/grace pass; expired/pending/none block) | `v_client_subscription_state` + `SubscriptionService` |
| **Coach package / client-slot limit** | ❌ **No** | per **coach** | How many *clients* a coach may create | **Does not exist — to be built** |

The business phase is almost entirely about the **second** concept. The plan
**adds** the coach-package layer **alongside** the untouched client-access layer.
The existing sidebar tab labelled **"Subscriptions"** manages *client access
windows* — it is **not** coach billing and will not be repurposed.

---

## 1. Current auth / login audit

**Verdict: strong, security-hardened foundation. Minimal change needed.**

- `js/auth.js` — `Auth` IIFE global. `signInWithPassword`, profile load from
  `profiles`, role accessors (`getRole/isAdmin/isCoach/isAdminOrCoach`), session
  init, password reset, auth-state listener. Login wakes a paused project (75s +
  one retry).
- **Client login gate (locked):** after profile load, if `role==='client'` it
  calls `SubscriptionService.getEffectiveState` and blocks unless
  `active|grace`. Re-checked on every reload in `init()`. `SubscriptionInactiveError`
  routes the UI to `#screen-subscription-inactive`. **Keep as-is.**
- Anon key is a *valid JWT but not authorization* — edge functions resolve the
  caller's **DB role** via `get_my_role()` (`_shared/auth.ts → requireRole`).
- New signups are forced to `role='client'` by the `handle_new_user()` trigger
  (`20260603152638`) — client-supplied `role` is ignored. Role elevation only
  through the authorized `create-user` edge function.

**Risks found:** none critical in auth itself. The only auth-adjacent gap is the
**absence of a coach slot check** (see §6/§7) and the **lack of a coach
onboarding-state field** (§13).

## 2. Current role-routing audit

- Roles: `admin | coach | client` (DB `profiles.role`, default `client`).
- **UI routing is class-driven**, not hard-gated per section: `app.html` nav
  items carry `role-coach-admin`, `role-client-only`, `role-admin-only` classes;
  `_showApp` adds `nc-bright` to everyone and `clientShell.js` adds `nc-client`
  for clients and drives the mobile tab bar → existing client sections only.
- **Server-side is the real gate:** RLS (Option A, §8) means even if a client
  reached a coach section, every coach/admin query is row-blocked or returns
  nothing for them. UI class-hiding is cosmetic; **RLS is authoritative.**

**Risk:** routing safety is "hide by CSS class." It is backed by RLS, so it is
not a data-leak risk, but a client who manually triggers `Dashboard.showSection('clients')`
would see an empty/broken coach view rather than a clean redirect. **Phase 1
adds a defensive role-guard in `Dashboard.showSection`** (presentation hardening,
no data impact) so clients are bounced to their dashboard.

## 3. Current coach/client creation audit

- **Edge `create-user`** (`supabase/functions/create-user/index.ts`) — authz via
  `requireRole(['admin','coach'])`:
  - `admin` → may create `client` or `coach`.
  - `coach` → may create `client` **only**; `assigned_coach` pinned to self
    (client-supplied value ignored).
  - `role='admin'` is never grantable here.
  - Validates `assigned_coach` references a real coach/admin.
  - Creates auth user (`email_confirm:true`) + upserts `profiles` row.
- **UI:** `clients.js → submitAddClient()` (requires name/email/password ≥8 +
  **coach assignment required**) and `submitAddCoach()`; both POST to
  `create-user` with the caller's JWT. `delete-user` edge backs removal.

**Critical gap:** `create-user` has **no client-slot enforcement**. A coach on a
1-slot plan can create unlimited clients today. This is the #1 thing the business
phase must fix, server-side (§7).

## 4. Current subscription / billing audit

- **Client access** (mature, keep): `subscriptions` table (`client_id`, `plan`
  int=months, `start_date`, `end_date`, `status`, `grace_days` default 7,
  `notified_7d/exp`, `created_by`). View `v_client_subscription_state`
  (`security_invoker`) collapses → `effective_status ∈ active|grace|expired|pending|none`.
  RPC `reactivate_subscription(client_id, months, start, notes)` (SECURITY
  DEFINER; admin or assigned coach). `subscription-checker` edge + cron drive
  expiry notifications. `js/subscriptions.js` = coach UI for this.
- **Coach billing / packages:** **none.** No `packages`/`coach_subscriptions`
  table, no `profiles.package`/`client_limit`, no slot UI, no calculator. Grep
  for `package|slot|client_limit|max_clients` → zero business matches.
- **Payment provider:** **none.** No Stripe SDK, no payment edge function, no
  checkout RPC. (`send-email` exists; that's transactional email only.)

**Decision:** build the package model + slot enforcement + Billing UI now;
**payment integration is a separate, later, explicitly-approved phase.** Until
then, package assignment is an **admin action** (admin sets a coach's package),
and the Billing page presents upgrade options + a "request upgrade" / "contact"
path — **never a fake "payment successful."**

## 5. Package model design

**Catalog (presentation = frozen JS constant; enforcement = DB integer).**
Prices are display-only; the DB stores only the numeric `client_limit`.

| key | label | client_limit | price | old_price |
|---|---|---|---|---|
| `free` | Free | 1 | $0 | — |
| `starter` | Starter | 5 | $5 | $10 |
| `growth` | Growth | 10 | $10 | $20 |
| `pro` | Pro | 20 | $20 | $35 |
| `scale` | Scale | 50 | $35 | $45 |
| `custom` | Custom | `custom_qty` (≥60, or unlimited) | `custom_qty × $0.65` | — |

- The user's spec says Starter "2 to 5" → enforced ceiling = **5**.
- Custom: `client_limit = custom_qty`; price computed in UI (`qty × 0.65`,
  e.g. 60 → $39). `client_limit = NULL` ⇒ unlimited (only admin may set).
- **Admin (acting as coach) bypasses all slot checks** (effectively unlimited).

**Storage (mirrors the client-subscription pattern, keeps billing out of the
PII `profiles` table):**

```
coach_subscriptions
  id            uuid pk
  coach_id      uuid unique  → profiles(id) on delete cascade
  package_key   text not null default 'free'   -- free|starter|growth|pro|scale|custom
  client_limit  int          -- resolved cap; NULL = unlimited; CHECK (>=1 or null)
  custom_qty    int          -- only when package_key='custom'
  status        text not null default 'active'  -- active|past_due|canceled
  started_at    timestamptz default now()
  updated_at    timestamptz default now()
  notes         text
  created_by    uuid → profiles(id)
```

A static `js/packages.js` (`window.Packages`, `Object.freeze`) holds the catalog
for UI (labels/prices/calculator). The **DB integer `client_limit` is the only
value enforcement trusts** — never the JS catalog.

**Why a table, not `profiles` columns:** (a) keeps billing separable from PII;
(b) avoids touching the `profiles` protected-columns trigger; (c) is where Stripe
will later attach (`stripe_customer_id`, `current_period_end`); (d) supports an
audit trail of package changes.

## 6. Slot-enforcement design

**Single source of truth: a SECURITY DEFINER RPC consumed by both the enforcer
and the UI** (no divergence between what the UI shows and what the server
allows).

```sql
-- returns { used, client_limit, remaining, package_key, unlimited }
create function public.coach_slot_status(p_coach_id uuid default auth.uid())
  returns jsonb  security definer  set search_path=public
```

- `used` = count of `profiles` where `assigned_coach = p_coach_id AND role='client'`.
- `client_limit`/`package_key` from `coach_subscriptions` (default `free`/1 if no row).
- Caller authz inside the RPC: admin, or self (`p_coach_id = auth.uid()`).
- `unlimited = true` when `client_limit IS NULL` **or** the coach is admin.

**Enforcement point (server-side, authoritative): the `create-user` edge
function.** After existing authz, when `role==='client'`:
1. Resolve the **target coach** = `assigned_coach` (coach creating → self; admin
   creating → the coach they assigned).
2. If that coach is **not admin**, call `coach_slot_status` (service role) and
   **reject with `403 {error, code:'SLOT_LIMIT', used, client_limit}`** when
   `used >= client_limit`.
3. Admin-as-target ⇒ skip (unlimited).

This is genuinely server-side (Deno edge + DB RPC); the frontend check is **UX
only**. Belt-and-suspenders DB trigger on `profiles` insert is listed as
**optional future hardening** (it complicates admin bulk flows; the edge gate +
RPC is sufficient for launch).

**UI messaging (spec):** "You have used 1 of 1 client slots. Upgrade to add more
clients." — rendered from `coach_slot_status`, with the Create button disabled at
limit.

## 7. Required DB changes

1. `coach_subscriptions` table (§5) + indexes (`coach_id` unique).
2. **Backfill (critical — must not lock out existing data):** insert one row per
   existing coach. `client_limit = GREATEST(current_client_count, free_limit)`
   so **no existing coach is retroactively over limit**; admin → `client_limit
   = NULL` (unlimited). Default new coaches → `free` / 1.
3. `coach_slot_status(uuid)` RPC (§6).
4. `v_coach_business` admin view (§11).
5. `profiles.onboarding_completed_at timestamptz` (§13) — non-privileged.
6. **Session delete** capability needs an RLS policy, not a schema change (§15).
7. **No change** to `subscriptions`, `v_client_subscription_state`,
   `workout_*`, `programs`, `client_programs`, `assessments`.

All DDL ships as **idempotent migrations** with matching `rollbacks/…_down.sql`
(repo convention).

## 8. Required RLS changes

Current baseline (verified): Option A (`profiles_select_scoped`) — own row /
admin all / coach sees own assigned clients + staff directory. Privileged-column
trigger protects `role`/`assigned_coach`. `is_admin/is_coach/is_admin_or_coach/get_my_role`
are SECURITY DEFINER helpers available for reuse.

New policies:

- **`coach_subscriptions`** — RLS ON.
  - SELECT: `coach_id = auth.uid() OR is_admin()`.
  - INSERT/UPDATE/DELETE: **`is_admin()` only.** A coach must **never** write
    their own `client_limit` (that would self-grant slots). Coach package changes
    happen via admin action (or, later, a Stripe webhook using service role).
- **`workout_sessions` DELETE** — add a policy: admin, the stamped `coach_id`, or
  the client's `assigned_coach` may delete (clients already have FOR ALL on own).
- **`profiles.onboarding_completed_at`** — confirm the existing UPDATE policy
  lets a coach update their **own non-privileged** columns; if the protected
  trigger is column-allowlisted, ensure this column is permitted. (If self-update
  proves awkward, fall back to a 1-row `coach_prefs` table — decided at impl.)
- **`v_coach_business`** — `security_invoker` + admin-only readability (view body
  guarded by `is_admin()`), so a non-admin gets zero rows.

No change to Option A, F8 `v_client_pulse`, progression views, or the
privileged-column trigger.

## 9. Required RPC / edge changes

- **New RPC** `coach_slot_status(uuid)` (§6).
- **New RPC** `admin_set_coach_package(p_coach_id, p_package_key, p_custom_qty,
  p_notes)` — SECURITY DEFINER, `is_admin()` only; upserts `coach_subscriptions`
  and resolves `client_limit` from the package (custom → `custom_qty`). This is
  how packages are assigned without a payment provider.
- **Edit `create-user`** — add the slot gate (§6). This is the only change to an
  existing edge function; its current authz is untouched.
- **Optional** `request_package_upgrade(p_package_key)` — writes a
  notification/inbox row to admin (reuses `notifications`), letting a coach ask
  for an upgrade. No payment.

## 10. Billing UI design

New sidebar tab **"Billing"** (`role-coach-admin`), distinct from existing
"Subscriptions" (client access). Reuses the porcelain premium card system.

- **Current Plan card:** package label, status, `used / limit` slots with a
  progress ring (reuse `ClientUtil.progressRing`), remaining count.
- **Upgrade grid:** the 6 packages as premium cards with `old_price`
  strikethrough → `price`, current plan marked, higher tiers actionable.
- **Custom calculator:** numeric input (≥60) → live `qty × $0.65` total.
- **Action (no payment yet):** "Request upgrade" → `request_package_upgrade`
  (admin gets notified) **or**, for admin viewing a coach, "Assign package" →
  `admin_set_coach_package`. Copy must never imply a charge occurred.
- Empty/over-limit states drive the same messaging used at client creation.

## 11. Admin business-tracking design

Admin-only **"Business"** section (or a tab within Billing). Backed by
`v_coach_business` (admin-only):

- coach name, coach email, package, status, `client_limit`, used slots,
  remaining, created date, **client emails** (aggregated array), revenue estimate
  (= package price, or `custom_qty × 0.65`).
- **PII rule:** emails yes (for offers/marketing); **passwords never** — the view
  reads only `profiles`/`coach_subscriptions`, never `auth.users` secrets.
- Client-side **CSV export** + search/filter by coach/package/status.
- Revenue estimate is **estimated MRR from assigned packages**, clearly labelled
  "estimated" (not collected revenue — there is no payment provider yet).

## 12. Client account lifecycle

1. Coach/admin creates client via `create-user` (now slot-gated). Role `client`,
   `assigned_coach` set, `email_confirm:true`.
2. **Temporary password shown once** at creation (current flow) — never
   retrievable later. (Later option: email invite + set-password link via
   `send-email`; deferred, not required for launch.)
3. Client logs in → `Auth` detects `role='client'` → client gate (active/grace) →
   client shell only.
4. Client access governed by `subscriptions` (unchanged). A client **consumes one
   coach slot** for as long as the `profiles` row exists with that
   `assigned_coach`.
5. Delete (admin) via `delete-user` → frees the slot (slot is a live count of
   `profiles`, so deletion is automatically reflected).

## 13. Coach onboarding-tour design

- **State:** `profiles.onboarding_completed_at` (null = not done). First login
  with `role∈{coach}` and null flag → launch tour. Skipping or finishing stamps
  the timestamp (resumable until then).
- **Tour:** premium guided overlay (reuse design tokens; not a childish library)
  walking: Dashboard → Clients → New Assessment → Program generation → Publishing
  → Recovery Pulse → Notifications → **Billing / packages / client limits**.
  Skippable, step-resumable, dismiss persists.
- **No new dependency** — a small bespoke spotlight/coach-mark module fits the
  existing vanilla-IIFE pattern.

## 14. Program-management design

Current: `programs` (history records) + `client_programs` (the published `jsonb`,
F8/Option A — the client's active program). Immutable-published rule stands.

- **Add / Edit:** edit a **draft**; publishing writes `client_programs`
  (`published=true`). **Never mutate a published record consumed by client
  history/replay** — editing a published program = clone → edit draft →
  republish (new published snapshot).
- **Clone / copy across clients:** deep-copy a source program's `jsonb` to a
  target client as an **unpublished draft** (so similar cases reuse work safely);
  coach reviews → publishes. RLS already scopes both clients to the coach.
- **Delete:** prefer soft (`programs.is_active=false`); hard delete behind a
  confirmation modal, admin/owning-coach only, and **must not** cascade-break
  `workout_sessions.program_id` (it's `ON DELETE SET NULL` — safe).

## 15. Session-management design

- **Gap:** `workout_sessions` RLS gives coach SELECT/INSERT/UPDATE but **no
  DELETE** — coaches cannot remove mistaken/duplicate sessions today.
- **Add** a DELETE policy (admin / stamped `coach_id` / client's assigned coach).
  Clients keep FOR ALL on their own rows.
- **UI:** confirmation modal; deleting a `completed` session **cascades its
  `workout_exercise_logs`** and therefore alters history/progression analytics —
  surface this in the confirm copy ("this removes the logged sets and affects
  progress charts"). No silent success.

## 16. Workout-history analytics design

**Data layer is already complete — no schema change.** `workout_exercise_logs.sets`
= `[{n,reps,weight,rpe?}]`; `workout_sessions` has `duration_seconds`,
`intensity_rating`, `status ∈ active|completed|abandoned`, `started_at`.

- **Today renders:** per-session (status badge, duration) + per-exercise set
  lines ("Set 1: 8 reps @ 50 kg") in `workoutSession.js`.
- **Gap = longitudinal coach view:** weight/volume progression per exercise over
  time, compliance % (completed vs abandoned), set/rep completion trends, last-vs-
  current deltas — "is the client progressing, what weight, what effort,
  compliance." Build as an **aggregation + charts** layer (reuse the bundled
  `chart.js`) reading existing tables via a coach-scoped read (RLS already
  permits coach→assigned-client sessions).
- **RPE:** column/jsonb supports it; the *input* UI currently captures reps+weight
  only. Adding an RPE input is a small optional enhancement (no schema change).
- **No fabricated history** — charts render only real logged rows; empty states
  where a client hasn't logged.

## 17. Security risks (and mitigations)

| # | Risk | Mitigation |
|---|---|---|
| S1 | Slot bypass via frontend only | Enforce in `create-user` edge + `coach_slot_status` RPC; UI is UX-only. |
| S2 | Coach self-grants slots | `coach_subscriptions` writes = `is_admin()` only; `client_limit` never coach-writable. |
| S3 | Coach sees other coaches' clients | Unchanged Option A RLS; new policies follow the same `assigned_coach` scoping. |
| S4 | Client reaches coach/admin screens | RLS row-blocks data; Phase-1 `showSection` role-guard cleans UX. |
| S5 | Admin business view leaks passwords | View reads `profiles`/`coach_subscriptions` only; **never** `auth.users`. Emails only. |
| S6 | Concurrent creates race past limit | Count+gate server-side in one edge call; optional insert-trigger hardening later. |
| S7 | Backfill locks out existing coaches | `client_limit = GREATEST(current_count, limit)`; admin = unlimited. |
| S8 | Fake payment / "charged" copy | No payment provider wired; Billing only requests/admin-assigns. No success-of-charge messaging. |
| S9 | Onboarding flag lets privileged self-update | Flag is non-privileged; protected-column trigger still guards `role`/`assigned_coach`. |
| S10 | Session delete corrupts analytics | Confirmation copy states cascade impact; `program_id` FK is SET NULL (safe). |
| S11 | Secrets in repo | None added; service-role only inside edge; cron via Vault. |

## 18. Implementation phases

> Adopts the requested 8-phase shape, re-ordered by dependency and risk. Each
> phase ends with the **mandatory guard workflow** (mechanical checks →
> clean-code-guard → security/permission review → docs-guard → re-verify) before
> commit, then deploy + production smoke + per-block report.

- **Phase 1 — Auth/role audit + login-routing safety.** ✅ Audit done here. Adds
  defensive role-guard in `Dashboard.showSection` (clients bounced to their
  dashboard). **Presentation-only, no DB. Can start immediately.**
- **Phase 2 — Coach packages + Billing model.** `coach_subscriptions` table +
  backfill + `js/packages.js` catalog + `coach_slot_status`/`admin_set_coach_package`
  RPCs + Billing UI (read-only slots + upgrade grid + calculator).
  **Needs DB/RLS/RPC approval.** Foundation for 3–5.
- **Phase 3 — Slot enforcement.** Slot gate in `create-user`; UI block + spec
  messaging; disabled Create at limit. **Needs edge deploy.** Depends on Phase 2.
- **Phase 4 — Coach onboarding tour.** `onboarding_completed_at` + premium tour.
  **Tiny DB column.** Independent of 2/3.
- **Phase 5 — Admin business tracking.** `v_coach_business` + admin Business
  section + CSV export + revenue estimate. **Needs DB view + RLS.** Depends on 2.
- **Phase 6 — Program / session management.** Program clone/edit-as-version/
  soft-delete + session DELETE policy + confirm modals. **Needs one RLS policy
  (session delete); rest app-layer.**
- **Phase 7 — Workout-history analytics.** Longitudinal coach charts on existing
  data (no schema change). Optional RPE input. **App-layer + read.**
- **Phase 8 — Cleanup.** Hide Gait sidebar item + standalone `section-gait`
  (keep the engine — it's wired into New-Session generation; full code removal
  only after a generation-pipeline audit). Remove obsolete routes; polish.
  **Presentation-only. Can start immediately.**

## 19. Rollback plan

- Every migration ships a paired `rollbacks/<name>_down.sql` (repo convention):
  `coach_subscriptions` drop, RPC drops, `v_coach_business` drop, session-delete
  policy drop, `onboarding_completed_at` drop.
- `create-user` slot gate is reversible by redeploying the prior function (kept
  in git history); the gate is additive and fails **closed** (blocks over-limit)
  — rollback simply removes the block.
- Backfill is data-only and reversible (`delete from coach_subscriptions`); since
  enforcement keys off these rows, removing them returns the system to today's
  unlimited behavior.
- UI phases (Billing, Business, tour, analytics, gait-hide) are additive and
  revert by git revert with no data impact.
- Client-access subscription system is **never touched** → no rollback surface
  there.

## 20. Verification plan

Per block (mandatory guard workflow):
1. **Mechanical:** `node --check` on changed JS; `npm run build`; browser smoke
   where UI changed; DB/RLS verification (`execute_sql` policy + counter checks)
   where SQL changed; edge invocation tests where edge changed.
2. **clean-code-guard** on the diff (real findings only).
3. **Security/permission review** against the §17 matrix — explicitly prove:
   coach can't exceed slots (over-limit `create-user` → 403 `SLOT_LIMIT`); coach
   can't write `coach_subscriptions`; coach sees only own clients/slots; client
   can't load coach sections; admin sees business view; no password exposure.
4. **docs-guard** when product/billing/RLS docs change (this file kept current).
5. **Re-verify** after any fix.
6. Deploy (Pages action) → production smoke (puppeteer harness) → per-block
   report (files, checks, guard findings, security verdict, commit hash, residual
   risk, readiness).

Dedicated smoke scenarios to add: (a) over-limit client creation blocked
server-side; (b) admin assigns package → slot count updates; (c) coach cannot
read another coach's `coach_subscriptions`; (d) client cannot reach `clients`
section; (e) admin business view returns coaches+emails, zero for non-admin.

---

## Post-plan recommendation

- **Start immediately (no DB/RLS approval needed):** **Phase 1** (login-routing
  role-guard) and **Phase 8** (hide Gait from sidebar) — low-risk,
  presentation-only quick wins that harden UX while the schema is reviewed.
- **First DB-bearing phase = Phase 2 (Coach packages + Billing model)** — the
  foundation for slot enforcement, admin tracking, and the Billing tab.
- **Requires DB/RLS/edge approval before coding:** Phases 2, 3, 5 (and the single
  session-delete policy in 6). **Risk level:** Phase 2 = medium (new table +
  RLS + backfill that must not lock out existing coaches); Phase 3 = medium-high
  (edge gate on the account-creation path — security-critical); Phases 1, 4, 7, 8
  = low.
- **Should wait (explicit separate approval):** real **payment provider /
  Stripe** integration — out of scope until you approve it; until then packages
  are admin-assigned and Billing never fakes a charge.

**Stopping here for approval. No implementation will begin until you approve the
plan (and specifically the DB/RLS/edge changes for Phases 2/3/5).**
