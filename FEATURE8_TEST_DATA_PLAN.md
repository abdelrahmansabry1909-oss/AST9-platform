# FEATURE 8 · S1–S3 — Test-Data Setup Plan (Recovery Pulse)

**Status:** Architecture / safety plan only. **No accounts created, no data inserted, no migrations applied, no destructive actions run.** Awaiting approval before any execution (per `AI_WORKFLOW_GUARDRAILS.md` §2 + §8 — this touches **auth · roles · RLS · subscriptions**).

**Goal:** a *safe, repeatable, fully reversible* set of clearly-labeled TEST accounts + seeded data that drives every `v_client_pulse` state, so we can authenticate-and-smoke the client Recovery Pulse card (S2), the coach Needs Attention panel (S3), role isolation, View Recovery, Send Nudge, and Reactivate — **without touching real users or sending real messages.**

---

## 0. Guardrails framing (§2)

- **Objective:** create the test fixtures only (accounts + seed rows); no product code, no schema, no deploy.
- **Files / surfaces touched at execution time (after approval):** Supabase **data** only — `auth.users` (via `create-user`), `public.profiles`, `client_programs`, `daily_routine_logs`, `workout_sessions`, `progress_snapshots`, `subscriptions`. **No repo source files. No migrations. No edge-function code changes.**
- **Data / RLS / Edge impact:** Inserts test rows on the **production** Supabase project (`byquokhcbagofshsclfy`) — there is no staging. Uses the existing `create-user`/`delete-user` edge functions (no new functions). RLS is **not modified**; we rely on it and will **verify it empirically per role**.
- **Risk level:** **Medium** — production data writes + the seeded expired subscription could be seen by the subscription-checker cron and the real admin's all-clients view (mitigations below). Fully reversible via the cleanup script.
- **Verification plan:** after seeding, query `v_client_pulse` **as service role and impersonating each role** (client/coach/admin via JWT claims), confirm the expected state table (§4), then run the §6 smoke checklist, then clean up (§5).

---

## 1. Account creation plan

### Mechanism decision (item 5 of the brief)
Use the project's **existing hardened `create-user` edge function**, called **as the admin** (real admin JWT). Rationale:
- It is the same path the admin "Add Coach / Add Client" UI uses (app-consistent, already audited — C-1).
- It creates an **email-confirmed** auth user *and* upserts the matching `profiles` row (id, email, full_name, role, assigned_coach, current_phase) in one call — no separate profile insert, no fighting the `handle_new_user` trigger.
- Admin caller may create `role: 'client'` **and** `role: 'coach'`; it rejects `admin`. For clients it validates `assigned_coach` references a real coach/admin.

**Rejected alternatives:**
- *SQL-only into `auth.users`* — fragile (encrypted password, `auth.identities`, confirmation columns); not recommended.
- *Supabase Dashboard → Auth → Add User + SQL role update* — works (the C2 guard exempts service-role SQL, so a `role`/`assigned_coach` UPDATE would pass), but it's two manual steps vs. one function call. Keep as fallback only.

### Accounts (7) — all `@ast9.test`, all display names prefixed `TEST -`
Create the **coach first** (need its id), then the 6 clients pointing `assigned_coach` at it.

| Order | Email | `full_name` | role | assigned_coach |
|---|---|---|---|---|
| 1 | `test.coach@ast9.test`    | `TEST - Coach Pulse`       | coach  | — |
| 2 | `pulse.new@ast9.test`     | `TEST - Pulse New`         | client | test.coach |
| 3 | `pulse.track@ast9.test`   | `TEST - Pulse On Track`    | client | test.coach |
| 4 | `pulse.slipping@ast9.test`| `TEST - Pulse Slipping`    | client | test.coach |
| 5 | `pulse.risk@ast9.test`    | `TEST - Pulse At Risk`     | client | test.coach |
| 6 | `pulse.regress@ast9.test` | `TEST - Pulse Regressing`  | client | test.coach |
| 7 | `pulse.expired@ast9.test` | `TEST - Pulse Expired`     | client | test.coach |

- **Password:** one shared, disposable test password for all 7 (to be supplied/confirmed at approval; not stored in the repo).
- **Request shape** (per account, POST to `create-user` with the admin's bearer token):
  `{ "email": "...", "password": "...", "full_name": "TEST - ...", "role": "coach|client", "assigned_coach": "<coach id or null>" }`

**Isolation guarantees (by construction):**
- Real users are all `@gmail.com`; test users are all `@ast9.test` → cleanup filters on `email LIKE '%@ast9.test'` and can never match a real user.
- Test clients are assigned to the **test coach**. **⚠ Verified finding (§11):** the `profiles` SELECT policy is *"Coaches and admins read all profiles"* (`is_admin_or_coach() OR id = auth.uid()`) — so **every coach sees every client**; assignment does **not** scope coach read-visibility. The test clients therefore appear to the test coach **and** the real admin while present, and the test coach also sees the 2 real clients. (Mutation paths remain gated; this is read-visibility only.)

---

## 2. Seed-data plan (proposed — apply only after approval)

All seed SQL is **id-agnostic** (keys off the test email), idempotent-friendly, and runs via MCP `execute_sql` (service role → bypasses RLS, and is exempt from the C2 column guard). `current_date`/`now()` make states stable regardless of run day.

> **Confirmed `v_client_pulse` rules (from the live view):** evaluated in order **new → regressing → at_risk → slipping → on_track**.
> - `f_new` = program not published **OR** no `published_at` **OR** `published_at > now()-7d` **OR** (no activity **AND** 30-day adherence = 0). ⇒ every non-new client needs a **published program ≥ 8 days old** *and* some activity/adherence.
> - `f_regressing` = ≥2 snapshots **AND** `composite_latest ≤ composite_prev − 5`.
> - `f_at_risk` = `adherence_7d < 40` **OR** `workouts_completed_7d = 0` **OR** `days_since_activity ≥ 14` **OR** (lapsed **AND** `adherence_7d < 50`).
> - `f_slipping` = `40 ≤ adherence_7d < 70` **OR** `delta_7d_routine ≤ −15`.
> - `momentum` = up (`delta ≥ 5`) / down (`delta ≤ −5`) / flat. `churn_risk` = lapsed **AND** `adherence_7d < 50`.

### Per-client recipe

**`pulse.new`** → `new` (sev 0): **seed nothing.** Profile alone yields adherence 0 / no program ⇒ `f_new`. (Verifies onboarding card; excluded from coach panel.)

**`pulse.track`** → `on_track` (sev 1), momentum **up**:
- `client_programs`: `published=true`, `published_at = now() - 10d`.
- `daily_routine_logs`: last 7 days `battery_pct = 88`; days 8–28 `battery_pct = 74` ⇒ `adherence_7d ≈ 88` (≥70), `adherence_30d ≈ 78`, `delta ≈ +10` (up).
- `workout_sessions`: 1 row `status='completed'`, `ended_at = now() - 2d` ⇒ `workouts_completed_7d = 1`.
- `subscriptions`: `status='active'`, `end_date = current_date + 60`.

**`pulse.slipping`** → `slipping` (sev 2), momentum **down**:
- program `published_at = now() - 10d`.
- routine logs: days 8–28 `battery_pct = 72`; last 7 days `battery_pct = 50` ⇒ `adherence_7d = 50` (40–70 band) **and** `delta ≈ −22` (≤ −15). Both routes to slipping; momentum down.
- 1 completed workout `ended_at = now() - 2d` (so **not** at_risk).
- active subscription.

**`pulse.risk`** → `at_risk` (sev 3):
- program `published_at = now() - 10d`.
- routine logs: a few rows ~20 days ago `battery_pct = 30` (so `adherence_30d > 0` ⇒ not `new`); **no logs in last 7 days** ⇒ `adherence_7d = 0` (< 40).
- 1 completed workout `ended_at = now() - 10d` ⇒ `workouts_completed_7d = 0`, `days_since_activity = 10`.
- active subscription (so it's a pure engagement at_risk, not churn).

**`pulse.regress`** → `regressing` (sev 4):
- program `published_at = now() - 10d`; routine logs last 7 days `battery_pct = 75`; 1 completed workout `ended_at = now() - 2d` (so only the regression flags).
- `progress_snapshots`: `session_date = current_date - 16`, `composite_score = 78`; `session_date = current_date - 2`, `composite_score = 62` ⇒ latest 62 ≤ 78−5 ⇒ `f_regressing`.

**`pulse.expired`** → `at_risk` (sev 3) **+ churn_risk + expired sub** (drives Reactivate **and** read-only card):
- program `published_at = now() - 10d`; a few routine logs ~20 days ago `battery_pct = 25` (not new); none in last 7 days ⇒ `adherence_7d = 0`.
- 1 completed workout `ended_at = now() - 10d` ⇒ `workouts_completed_7d = 0`.
- `subscriptions`: **`status='expired'`**, `start_date = current_date - 60`, `end_date = current_date - 30`, `grace_days = 7`, **`notified_7d = true`, `notified_exp = true`** (status='expired' + notified flags ⇒ the `subscription-checker` cron has nothing to act on — see §7). ⇒ `effective_status = expired`, `churn_risk = true`, lapsed ⇒ **Reactivate button shows**; client is non-writable ⇒ **read-only card path**.
  - *Grace alternative (optional):* `status='active'`, `end_date = current_date - 3`, `grace_days = 7` ⇒ `effective_status = grace`, `grace_days_left = 4` ("Plan ends in 4 days"). Pick one at approval.

### Proposed seed SQL (illustrative — **do not run until approved**)
```sql
-- helper: resolve a test client's id by email
-- (used as a scalar subquery throughout)

-- 1) PUBLISHED PROGRAMS (track, slipping, risk, regress, expired) — 10 days old
insert into client_programs (client_id, coach_id, program, published, published_at)
select p.id,
       (select id from profiles where email='test.coach@ast9.test'),
       '{}'::jsonb, true, now() - interval '10 days'
from profiles p
where p.email in ('pulse.track@ast9.test','pulse.slipping@ast9.test',
                  'pulse.risk@ast9.test','pulse.regress@ast9.test','pulse.expired@ast9.test');

-- 2) DAILY ROUTINE LOGS
--   track: last 7d @88, days 8-28 @74
insert into daily_routine_logs (client_id, log_date, completed, battery_pct)
select (select id from profiles where email='pulse.track@ast9.test'), d::date, true, 88
from generate_series(current_date-6, current_date, interval '1 day') d;
insert into daily_routine_logs (client_id, log_date, completed, battery_pct)
select (select id from profiles where email='pulse.track@ast9.test'), d::date, true, 74
from generate_series(current_date-28, current_date-7, interval '1 day') d;
--   slipping: last 7d @50, days 8-28 @72
insert into daily_routine_logs (client_id, log_date, completed, battery_pct)
select (select id from profiles where email='pulse.slipping@ast9.test'), d::date, true, 50
from generate_series(current_date-6, current_date, interval '1 day') d;
insert into daily_routine_logs (client_id, log_date, completed, battery_pct)
select (select id from profiles where email='pulse.slipping@ast9.test'), d::date, true, 72
from generate_series(current_date-28, current_date-7, interval '1 day') d;
--   risk: only ~20d ago @30
insert into daily_routine_logs (client_id, log_date, completed, battery_pct)
select (select id from profiles where email='pulse.risk@ast9.test'), d::date, true, 30
from generate_series(current_date-22, current_date-18, interval '1 day') d;
--   regress: last 7d @75
insert into daily_routine_logs (client_id, log_date, completed, battery_pct)
select (select id from profiles where email='pulse.regress@ast9.test'), d::date, true, 75
from generate_series(current_date-6, current_date, interval '1 day') d;
--   expired: only ~20d ago @25
insert into daily_routine_logs (client_id, log_date, completed, battery_pct)
select (select id from profiles where email='pulse.expired@ast9.test'), d::date, true, 25
from generate_series(current_date-22, current_date-18, interval '1 day') d;

-- 3) WORKOUT SESSIONS (completed)
insert into workout_sessions (client_id, coach_id, workout_key, status, started_at, ended_at, intensity_rating)
select p.id, (select id from profiles where email='test.coach@ast9.test'),
       'test', 'completed', age_at - interval '40 min', age_at, 6
from (values
  ('pulse.track@ast9.test',    now() - interval '2 days'),
  ('pulse.slipping@ast9.test', now() - interval '2 days'),
  ('pulse.regress@ast9.test',  now() - interval '2 days'),
  ('pulse.risk@ast9.test',     now() - interval '10 days'),
  ('pulse.expired@ast9.test',  now() - interval '10 days')
) v(email, age_at)
join profiles p on p.email = v.email;

-- 4) PROGRESS SNAPSHOTS (regress only — declining composite)
insert into progress_snapshots (client_id, session_date, composite_score)
select (select id from profiles where email='pulse.regress@ast9.test'), current_date-16, 78;
insert into progress_snapshots (client_id, session_date, composite_score)
select (select id from profiles where email='pulse.regress@ast9.test'), current_date-2, 62;

-- 5) SUBSCRIPTIONS
--   active (track, slipping)
insert into subscriptions (client_id, plan, start_date, end_date, status, created_by, notified_7d, notified_exp)
select p.id, 3, current_date-30, current_date+60, 'active',
       (select id from profiles where email='test.coach@ast9.test'), false, false
from profiles p where p.email in ('pulse.track@ast9.test','pulse.slipping@ast9.test');
--   expired (expired) — cron-neutralized
insert into subscriptions (client_id, plan, start_date, end_date, status, created_by, notified_7d, notified_exp)
select (select id from profiles where email='pulse.expired@ast9.test'),
       3, current_date-60, current_date-30, 'expired',
       (select id from profiles where email='test.coach@ast9.test'), true, true;
```

---

## 3. Exact tables touched

| Table | Operation | Notes |
|---|---|---|
| `auth.users` | INSERT (via `create-user`) | 7 rows; cascades to `profiles`. |
| `public.profiles` | INSERT/UPSERT (via `create-user`) | 7 rows; role + assigned_coach set by the function. |
| `client_programs` | INSERT | 5 rows (published, 10d old). |
| `daily_routine_logs` | INSERT | ~80 rows across 5 clients. |
| `workout_sessions` | INSERT | 5 rows (completed). |
| `progress_snapshots` | INSERT | 2 rows (regress). |
| `subscriptions` | INSERT | 3 rows (2 active, 1 expired). |
| *(smoke-time)* `coach_messages` | INSERT (Send Nudge) | test coach → test client only. |
| *(smoke-time)* `subscriptions` | INSERT (Reactivate) | one extra active row for `pulse.expired` only. |

**Not touched:** any repo source, any migration, any edge-function code, `notify()`/triggers, cron, RLS policies, real users.

---

## 4. Expected `v_client_pulse` output per client

| Client | `pulse_status` | `severity` | `momentum` | `churn_risk` | `effective_status` | In coach panel? | Reactivate btn? | Client card word |
|---|---|---|---|---|---|---|---|---|
| `pulse.new`      | `new`        | 0 | — (hidden) | false | (none) | **No** | No | Getting started |
| `pulse.track`    | `on_track`   | 1 | up   | false | active  | **No** | No | On track |
| `pulse.slipping` | `slipping`   | 2 | down | false | active  | **Yes** (Losing momentum) | No | Keep momentum |
| `pulse.risk`     | `at_risk`    | 3 | flat | false | active  | **Yes** (Needs attention) | No | Let's reconnect |
| `pulse.regress`  | `regressing` | 4 | flat | false | active  | **Yes** (Recovery dipping) — top | No | Let's check in |
| `pulse.expired`  | `at_risk`    | 3 | flat | **true** | **expired** | **Yes** (Needs attention + Expired chip) | **Yes** | *(read-only)* Let's reconnect → "Your plan has paused" |

- **Coach panel (test coach login):** **4 rows** pass the panel filter (regress, at_risk, expired, slipping), ranked regress → at_risk(×2) → slipping. **⚠ Verified:** the coach actually *sees all 8 clients* in `v_client_pulse` (6 test + 2 real) due to the global staff-read policy; the 2 real clients are `new` (sev 0) so they fall outside the filter — but the coach is **not** restricted to assigned clients (§11).
- **Admin panel:** same 4 test rows (real clients are `new` ⇒ still hidden); admin sees all 8.

---

## 5. Cleanup-script strategy (full teardown)

Single idempotent script, safe to re-run. Order: child rows by `client_id`, then the auth users.

```sql
-- ids of the test set (the only selector — matches no real user)
-- delete child/seed rows first
delete from coach_messages      where sender_id   in (select id from profiles where email like '%@ast9.test')
                                   or  receiver_id in (select id from profiles where email like '%@ast9.test');
delete from progress_snapshots  where client_id in (select id from profiles where email like '%@ast9.test');
delete from workout_sessions    where client_id in (select id from profiles where email like '%@ast9.test');
delete from daily_routine_logs  where client_id in (select id from profiles where email like '%@ast9.test');
delete from client_programs     where client_id in (select id from profiles where email like '%@ast9.test');
delete from subscriptions       where client_id in (select id from profiles where email like '%@ast9.test');
```
Then remove the accounts via the **`delete-user`** edge function (admin) for each of the 7 `@ast9.test` ids — this deletes the `auth.users` row and **cascades** the `profiles` row (`ON DELETE CASCADE`). *(Fallback if needed: `delete from auth.users where id in (select id from profiles where email like '%@ast9.test')` via service role, which cascades to `profiles`.)*

> `coach_messages` columns verified against the live table: `sender_id`, `receiver_id`, `content`.

---

## 6. Smoke-test checklist (using the seeded accounts)

**Read-only / role safety first (zero mutation):**
1. **Client cards** — log in as each `pulse.*` client; confirm the card word/chip/reason/action in §4. Confirm **no raw enum** ever shown. `pulse.new` shows onboarding warmth (no chip, no warning). `pulse.expired` shows the read-only "Your plan has paused" path (no chip, action → coach).
2. **Coach panel** — log in as `test.coach`; confirm exactly the 4 rows, correct ranking, headlines, reasons, last-activity hints, and the **Expired** chip on `pulse.expired`. Confirm `new`/`on_track` absent.
3. **Role isolation** — confirm a `pulse.*` client cannot see the coach panel (section is `role-coach-admin` + `Auth.isAdminOrCoach()` guard) and reads only its **own** pulse row (**verified: 1 row**). **⚠ Verified finding:** the test coach is **not** assigned-scoped — it sees all clients (incl. the 2 real ones); only `new`/low-severity clients fall outside the panel filter (§11).
4. **Admin panel** — log in as the real admin; confirm the same 4 test rows appear (admin = all) and real clients remain hidden.
5. **View Recovery** — open on any row → existing F7 read-only modal. (read-only, safe)
6. **Calm-fail** — (optional) confirm Today still renders if the pulse query is forced to error.

**Destructive actions LAST, against test accounts only:**
7. **Send Nudge** — as test coach, on `pulse.risk`/`pulse.expired`: confirm prompt → `Community.sendMessage` → message lands in **that test client's** Coach tab. (test→test only)
8. **Reactivate** — as test coach/admin, on `pulse.expired` (lapsed): confirm prompt (1–24 mo) → `reactivate_subscription` inserts an **active** sub → toast → panel refresh drops the row / clears the Reactivate button. Re-seed the expired sub afterward if re-testing.

**Verification gates:** 0 uncaught console errors / unhandled rejections on Today and Clients (benign three.js add-on 404s excluded); per-role `v_client_pulse` output (queried via service role + JWT-claims impersonation) matches §4.

---

## 7. Production risks

| Risk | Severity | Mitigation |
|---|---|---|
| Seeding runs on **production** Supabase (no staging). | Medium | Test set is fully isolated by `@ast9.test` + `TEST -`; complete teardown in §5; tiny row count; no PII. |
| Test clients visible in the **real admin's** all-clients list + Needs Attention panel while present. | Low–Med | Clearly labeled `TEST -`; assigned to the **test coach** (not the admin's coach scope); removed immediately after smoke. |
| Seeded **expired** subscription picked up by the `subscription-checker` **cron** (could flip status / send email to `pulse.expired@ast9.test`). | Medium | Seed it as `status='expired'` with `notified_7d=true,notified_exp=true` ⇒ nothing for the checker to action; the test address is owned/non-deliverable. **No cron/edge code is changed.** |
| **Send Nudge** / **Reactivate** are real writes (message + subscription). | Medium | Restricted to **test accounts only**; never a real `@gmail.com` user; reversed by §5. |
| **Coach visibility is global, not assigned-scoped** — `profiles` policy *"Coaches and admins read all profiles"*; `v_client_pulse` (security_invoker) therefore returns **every** client to any coach. A coach's Needs Attention panel lists every client meeting the filter, regardless of assignment. | **Finding — report, do not fix here** | Pre-existing platform RLS, **not** introduced by F8; but F8 surfaces client recovery data to *any* coach. Whether coach reads should be assigned-scoped is a separate, architecture-gated RLS decision. Latent today (1 admin / 0 real coaches). |
| Accidentally matching a real user in cleanup. | Low | Selector is `email LIKE '%@ast9.test'`; all real users are `@gmail.com`. Real ids recorded below are never referenced. |

**Protected real ids (never touch):** admin `deeed121-a425-4913-98b5-1f856fd9d398`; clients `db6a91e6-fac5-4a0e-81f3-87690a69df1e`, `b0077a6c-c325-4938-a06f-0f42ccb952d2`.

---

## 8. Rollback plan

This is **data-only** — no schema, no migration, no code. Rollback = **run the §5 cleanup script**, which fully reverses the setup (deletes seed rows + the 7 test accounts). Verify with `select count(*) from profiles where email like '%@ast9.test'` → expect `0`. `v_client_pulse` is a view and needs nothing dropped. If any action created extra rows (Nudge messages, Reactivate subs), §5's `coach_messages`/`subscriptions` deletes cover them. No deploy and no migration down-path are involved.

---

## 9. Safe vs destructive (summary)

- **Safe (reads / isolated test writes):** all `v_client_pulse` reads; creating the isolated test accounts; seeding their data; client/coach/admin render checks; View Recovery; role-isolation checks.
- **Destructive but contained to test accounts:** Send Nudge (test→test message), Reactivate (test sub insert).
- **Watch item:** the seeded expired subscription × `subscription-checker` cron — neutralized via `status='expired'` + notified flags.
- **Never:** touching real users, sending real messages, reassigning real clients, changing RLS/cron/edge code.

---

## 10. Approval checklist (please confirm before any execution)

1. ☐ Create the **7 `@ast9.test` accounts** via `create-user` as admin (coach first, then 6 clients assigned to it).
2. ☐ Disposable **test password** to use for all 7 (you provide, or I generate one and report it).
3. ☐ Approve the **seed recipes / SQL** in §2 (states per §4).
4. ☐ Approve `pulse.expired` as **expired** (default) — or switch to the **grace** variant.
5. ☐ Accept that test accounts are **visible to the real admin** while present (removed at teardown).
6. ☐ Approve the **expired-sub cron-neutralization** approach (`status='expired'` + notified flags).
7. ☐ Approve the **cleanup/rollback** strategy (§5) keyed on `email LIKE '%@ast9.test'`.
8. ☐ Confirm the **seed + cleanup scripts stay local/uncommitted** (dev artifacts, per the §6 "never commit smoke harnesses" rule) — not added to the repo.

**On approval**, the next phase is: create the dedicated seed script + cleanup script (local), run account creation, apply the seed, verify §4 per role, then stop and report — **before** any destructive smoke action.

---

## 11. Execution & verification findings (applied run)

**Mechanism used:** accounts were created via **service-role SQL** (approved deviation — the approved `create-user` path needs an interactive admin/coach JWT that can't be minted here). End-state is identical to `create-user`: email-confirmed, login-capable `auth.users` + `auth.identities`, with role + `assigned_coach` set. Local (uncommitted) scripts: `.smoke-d079a9f/f8-accounts.sql`, `f8-seed.sql`, `f8-cleanup.sql`.

**Verification results (all green except the noted finding):**
- **Accounts:** 7/7 exist, email-confirmed, 1 identity each; `test.coach` role=coach, 6 clients assigned to it. ✓
- **Seeded rows:** present per recipe (programs/routine/workouts/snapshots/subs). ✓
- **`v_client_pulse` states (service role):** `new` · `on_track` · `slipping` · `at_risk` · `regressing` · `at_risk`+`expired`+`churn_risk` — all 6 present & correct. ✓
- **Client self-visibility** (`pulse.track`): **1 row** (own). ✓
- **Admin visibility:** **8 visible / 4 in panel.** ✓
- **Coach visibility:** **8 visible / 4 in panel — NOT assigned-scoped** (see §7 finding). ⚠

**Rollback/cleanup:** run `.smoke-d079a9f/f8-cleanup.sql` (deletes all `@ast9.test` data + accounts; final SELECT must show `profiles_left=0, users_left=0`).

---

*No S4. No alerts. No referrals. No destructive smoke actions. No real users created or modified — only isolated `@ast9.test` test data, fully reversible via §5.*
