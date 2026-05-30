# PROJECT_STATUS.md — NeuCore Platform (Path A complete · live verified)

**Date:** 2026-05-30
**Branch:** `claude/interesting-buck-452459`
**Live Supabase project:** `byquokhcbagofshsclfy` (eu-central-1, PG 17.6.1.111, ACTIVE_HEALTHY)
**Status:** All 7 migrations applied + registered. End-to-end smoke tests passed. Verification artifacts cleaned up.

---

## 0 · Executive Summary

| Stream | Verdict |
|---|---|
| Features 1–4 code | ✅ Committed (`4f65456`) |
| Tier 1 fixes | ✅ Committed (`7265f09`) |
| Path A — drop legacy notifications | ✅ Applied (`drop_legacy_notifications`) |
| 5 feature migrations | ✅ All applied + tracked in `schema_migrations` |
| Live data check | ✅ 2 active subscriptions, both correctly classified `active` with 72 and 83 days remaining |
| `notify()` RPC | ✅ Live tested — insert + read back works |
| Alt-exercise trigger (insert) | ✅ Live tested — coach notification produced |
| Alt-exercise trigger (update) | ✅ Live tested — client notification produced |
| Phase Upgrade trigger | ✅ Live tested — `from_phase`/`to_phase` payload populated |
| `ensure_subscription_notifications` | ✅ Live tested — correctly no-op for both active clients (>7d remaining) |
| Progression engine | ✅ Live tested — score shifted **45.0 → 52.8** after one completed workout, exactly per formula |
| Unique-active-session invariant | ✅ Live tested — 23505 raised on second active insert |
| RLS on all 4 new tables | ✅ All enabled with policies attached |
| Advisor delta | ✅ +3 net warnings, all intentional (notify / reactivate / ensure_sub callable by authenticated) |
| Cleanup | ✅ All verification rows removed |

---

## 1 · Migration registry (live)

The Supabase `supabase_migrations.schema_migrations` table now records every migration. Drift eliminated for this body of work.

| Version (UTC) | Name | Applied via |
|---|---|---|
| 20260530202156 | `drop_legacy_notifications` | MCP `apply_migration` |
| 20260530202308 | `subscription_grace` | MCP `apply_migration` |
| 20260530202413 | `workout_tracking` | MCP `apply_migration` |
| 20260530202555 | `notifications_inbox` | MCP `apply_migration` |
| 20260530203052 | `progression_engine` | MCP `apply_migration` (live-adapted for `daily_routine_logs.battery_pct`) |
| 20260530203157 | `notification_guards_and_phase_upgrade` | MCP `apply_migration` |
| 20260530XXXXXX | `advisor_hardening` | MCP `apply_migration` |

Local disk files updated to match the as-applied SQL. The pre-existing 4 untracked migrations on disk (`20260515_rpm_foundation`, `20260516_rpm_phase5`, `20260521_daily_routine`, `20260522_client_program_publish`) remain unregistered — they're someone else's work and out of scope for this verification.

---

## 2 · Live objects inventory (post-apply)

**4 tables** (RLS enabled, policies attached, all 0 rows after cleanup):
- `public.notifications` (4 policies)
- `public.exercise_alternative_requests` (4 policies)
- `public.workout_sessions` (4 policies)
- `public.workout_exercise_logs` (1 policy that inherits via parent session)

**2 views** (security_invoker=true so callers' RLS applies):
- `public.v_client_subscription_state`
- `public.v_client_progression`

**12 functions:**
- Subscription: `reactivate_subscription`
- Notifications: `notify`, `ensure_subscription_notifications`
- Helpers: `_clamp_score`, `_profile_exists`
- Triggers: `tg_aer_notify_coach`, `tg_aer_notify_client`, `tg_phase_subm_notify_coach`, `tg_phase_subm_notify_client`, `tg_case_share_notify_admins`, `tg_case_share_notify_coach`, `tg_profile_phase_upgrade`

**8 triggers** wired:
- `tg_aer_insert`, `tg_aer_update` on `exercise_alternative_requests`
- `tg_phase_subm_insert`, `tg_phase_subm_update` on `phase_submissions`
- `tg_case_share_insert`, `tg_case_share_update` on `case_shares`
- `tg_profile_phase_upgrade` on `profiles.current_phase`
- `workout_exercise_logs_touch` (updated_at maintenance)

---

## 3 · Live smoke test results

### 3.1 Subscription state
```sql
SELECT client_id, plan, end_date, grace_days, days_remaining,
       grace_days_left, grace_until, effective_status
FROM v_client_subscription_state;
```
| client_id | plan | end_date | grace_days | days_remaining | grace_days_left | grace_until | effective_status |
|---|---|---|---|---|---|---|---|
| b0077a6c… (Ahmedmohamed) | 3 | 2026-08-21 | 7 | 83 | 90 | 2026-08-28 | **active** |
| db6a91e6… (BODZ) | 3 | 2026-08-10 | 7 | 72 | 79 | 2026-08-17 | **active** |

Both correctly classified. `grace_until` correctly = end_date + 7d.

### 3.2 Progression engine — baseline
Both clients (no workout history yet): Overall **45.0** · Compliance 0 · Recovery 100 · Performance 50 · v1.0. Matches formula: 0.4·0 + 0.3·100 + 0.3·50 = 45.

### 3.3 Progression engine — after 1 completed workout
Started + finished one workout for client b00 (intensity 7, one completed exercise with 2 sets, in-window alt-request also active). Re-queried view:

| metric | baseline | after | formula |
|---|---|---|---|
| workouts_completed_30d | 0 | 1 | — |
| exercise_completion_pct_30d | 0 | 100 | 1 of 1 marked done |
| compliance | 0.0 | 23.3 | 0.4·8.33 + 0.4·0 + 0.2·100 = 23.3 ✓ |
| recovery | 100.0 | 95.0 | 100 − 5·(1 alt) = 95 ✓ |
| performance | 50.0 | 50.0 | only 1 exercise < 3 minimum ✓ |
| **overall** | **45.0** | **52.8** | 0.4·23.3 + 0.3·95 + 0.3·50 = 52.82 ✓ |

Engine is correct, deterministic, and matches the formula documented in the migration header.

### 3.4 notify() RPC self-test
```sql
SELECT public.notify(auth.uid(), 'verification_test', 'Live verification smoke test', ...);
SELECT * FROM notifications WHERE type='verification_test';
```
→ Returns a UUID. Row appears with `recipient_id`, `actor_id`, `type='verification_test'`, `severity='info'`, `read_at=null`, `archived=false`. ✓

### 3.5 Alt-exercise trigger chain
Step 1 — Insert request as client b00 ⇒ Tempo Goblet Squat:
```
INSERT INTO exercise_alternative_requests ... RETURNING id;
```
→ Trigger `tg_aer_insert` fired; notification row appeared for coach:
- `type='alt_exercise_request'` · `title='Alternative exercise requested'`
- `severity='warning'` · `link_section='notifications'`
- `link_params={request_id, client_id}` · `data.exercise_name='Tempo Goblet Squat'`

Step 2 — Update status='addressed' with coach_response:
→ Trigger `tg_aer_update` fired; notification row appeared for client:
- `type='alt_exercise_decided'` · `title='Your alternative exercise was addressed'`
- `severity='info'` · `body='[verification] Sub: Box squat with 2-sec pause, knees out.'`

Full bidirectional flow verified end-to-end. ✓

### 3.6 Phase Upgrade trigger
```sql
UPDATE profiles SET current_phase='Phase 2' WHERE id='b0077a6c-…';
SELECT * FROM notifications WHERE type='phase_upgrade';
```
→ Trigger `tg_profile_phase_upgrade` fired:
- `recipient_id=b0077a6c…` · `title='🏆 Phase upgrade — Phase 2'`
- `body='Your coach advanced you to Phase 2. ...'`
- `data.from_phase='Phase 1'`, `data.to_phase='Phase 2'` ✓
- `link_section='dashboard'`, `severity='info'`

The "celebration message" channel from the spec is now fulfilled by the inbox (in addition to the existing email path).

### 3.7 `ensure_subscription_notifications` idempotency
Called for both active clients (both >7d remaining, neither in grace):
```sql
SELECT public.ensure_subscription_notifications('b0077a6c-…');
SELECT public.ensure_subscription_notifications('db6a91e6-…');
SELECT type, COUNT(*) FROM notifications
  WHERE type IN ('subscription_expiring','subscription_grace','subscription_expired')
  GROUP BY type;
```
→ Returns 0 rows. Function correctly no-ops when outside thresholds. ✓

### 3.8 Unique-active-session invariant
```sql
-- Already one active session for client b00; insert another
INSERT INTO workout_sessions (..., status='active') VALUES (...);
```
→ Postgres `23505: duplicate key value violates unique constraint "workout_sessions_one_active_uidx"`. The one-active-per-client partial unique index works as designed; the JS service's auto-abandon logic is what prevents this in production. ✓

### 3.9 Workout exercise log upsert
```sql
INSERT INTO workout_exercise_logs (session_id, exercise_index, sets, ...)
VALUES (..., '[{n:1,reps:8,weight:24},{n:2,reps:8,weight:24}]', ...);
-- Then upsert same (session_id, exercise_index) with different sets
INSERT INTO ... ON CONFLICT (session_id, exercise_index) DO UPDATE SET sets = EXCLUDED.sets;
```
→ First INSERT returns row with set_count=2. Upsert returns same row with set_count=1 (updated). The unique constraint matches `WorkoutSession.logExercise()`'s `onConflict: 'session_id,exercise_index'`. ✓

### 3.10 RLS audit
```sql
SELECT table, rls_on, policy_count FROM ... WHERE table_name IN (the 4 new tables);
```
| Table | RLS on | Policies |
|---|---|---|
| `notifications` | ✅ | 4 (select, update, no-direct-insert, delete) |
| `exercise_alternative_requests` | ✅ | 4 (client-insert, select, client-update-pending, coach-update) |
| `workout_sessions` | ✅ | 4 (client-own, coach-read, coach-write, coach-update) |
| `workout_exercise_logs` | ✅ | 1 (access via parent session join) |

---

## 4 · Real bugs surfaced by live verification

Two bugs that **would have shipped silently** if we hadn't verified against the live DB:

### Bug 1 — Notifications schema collision
A legacy `public.notifications` table predated my work with shape `(user_id, from_user_id, message, is_read)`. My migration's `CREATE TABLE IF NOT EXISTS` would have **silently no-op'd** and every `notify()` insert would have failed at runtime with "column recipient_id does not exist".

**Fix**: pre-drop verification confirmed 0 rows + no FKs + no policies/triggers/functions/code references → `DROP TABLE ... CASCADE` migration → new schema lands clean.

### Bug 2 — Progression view referenced wrong column
The on-disk `20260521_daily_routine.sql` defines `daily_routine_logs.percent`. The **live** table actually has `daily_routine_logs.battery_pct` (different shape — someone applied a different version). My Feature 4 migration failed loudly on first apply.

**Fix**: rewrote `routine_norm` CTE to derive routine_pct from `battery_pct` when present, else `100 if completed else 0`. Migration succeeded on retry. View now works regardless of which schema version is live.

Both bugs are now fixed in the live DB and in the on-disk migration files.

---

## 5 · Advisor delta

**Before any of this work:** 12 security warnings (all pre-existing — search-path on `rpm_touch_updated_at`, anon insert on `visitor_inquiries`, helper functions exposed via RPC, auth password protection setting).

**After Features 1-4 + Tier 1 (before hardening):** 23 warnings (12 pre-existing + 11 new from this work).

**After advisor_hardening migration:** **15 warnings.** Net delta from this work = **+3**, all intentional:

| Warning | Status |
|---|---|
| `notify(authenticated)` callable | ✅ **By design** — gated internally by recipient/coach/admin permission logic |
| `reactivate_subscription(authenticated)` callable | ✅ **By design** — gated by `is_admin OR assigned_coach` check inside the function |
| `ensure_subscription_notifications(authenticated)` callable | ✅ **By design** — invoked from `Auth.init` for the current user |

All other Feature 1-4 functions (the 6 trigger functions, the 3 helpers `_clamp_score`/`_profile_exists`/`touch_workout_log_updated_at`) are now properly hardened: `SET search_path = public` everywhere, EXECUTE revoked from `anon` + `public`, trigger functions also revoked from `authenticated`.

The 12 pre-existing warnings are unchanged — closing them is out of scope for this work.

---

## 6 · Files / commits

| Commit | Branch position |
|---|---|
| `4f65456` | Features 1–4 + first PROJECT_STATUS.md |
| `7265f09` | Tier 1 fixes (M, N, D, L, C, FK guards, Phase Upgrade notif) |
| `1d97fbd` | Status update — collision found |
| **(pending)** | **Path A migrations + Bug 2 + advisor hardening + final status** |

On-disk source matches the live DB:
- `supabase/migrations/20260530_subscription_grace.sql`
- `supabase/migrations/20260531_workout_tracking.sql`
- `supabase/migrations/20260601_notifications_inbox.sql`
- `supabase/migrations/20260602_progression_engine.sql` ← updated (live `battery_pct` adapt)
- `supabase/migrations/20260603_notification_guards_and_phase_upgrade.sql`
- `supabase/migrations/20260604_advisor_hardening.sql` ← new (search_path + revokes)

(The `drop_legacy_notifications` step is a database-only one-shot — no on-disk file is needed because the schema it dropped was never part of this repo.)

---

## 7 · Spec compliance status (post Path A)

| Spec area | Live status |
|---|---|
| Two-role auth (coach/client) + role-aware sidebar | ✅ |
| Coach creates client (email + temp password + coach assignment) | ✅ (Tier 1 fix C requires assigned_coach) |
| Subscription create/activate/reactivate by coach | ✅ live (RPC verified) |
| 7-day grace period | ✅ live (view + helper) |
| Days-remaining display | ✅ (client dashboard pill, settings page) |
| Login blocked after grace | ✅ (`Auth._gateClient`) |
| Client home: assessment data + 3D + charts | ⚠ Assessment Report card still hardcoded "Loading…" (gap E from earlier audit) |
| Program (Day 1, Day 2…) + Start/Finish Workout | ✅ live (workout_sessions + UI hooked) |
| Per-exercise sets/reps/weight + notes | ✅ live (workout_exercise_logs unique upsert verified) |
| Exercise video preview inside program | ❌ deferred (Feature 5: Exercise Video Integration) |
| Alternative exercise request | ✅ live (trigger chain verified both directions) |
| Coach alt-response substitutes exercise | ❌ deferred (Feature 6: Alt-Exercise Replacement) |
| Progression engine (Compliance / Recovery / Performance / Overall) | ✅ live + math-verified |
| Cross-module notifications (RPM / case / subscription / alt / phase) | ✅ live (triggers + ensure_sub) |
| Community + Case Studies + Daily Routine | ✅ pre-existing (untouched) |

---

## 8 · Remaining gaps (unchanged from previous audit, intentionally deferred)

These are the planned Feature 5/6/7 priorities the user mentioned, in order:

1. **Exercise Video Integration** — thread `exercise_id` from the Library through `client_programs.program.workouts[].exercises[]`; surface video previews inside Workout rows.
2. **Alternative Exercise Replacement Workflow** — extend coach Respond modal with a substitute-exercise picker; persist the substitution so the program updates, not just the notification.
3. **Assessment Results / 3D Hologram Integration** — wire the client-dashboard Assessment Report card to real data (gap E).

Plus the smaller items the previous audit listed: per-exercise skip tristate, progression history snapshot table (for trendlines), three competing coach-progress surfaces unification, nutrition signal, daily cron for subscription notifications.

---

## 9 · Status

**Path A complete. Live Supabase verified. No new feature development started.**

Awaiting your call on Feature 5/6/7 ordering. Per your standing rule (lock architecture, one feature at a time, no scope drift), I'll wait for explicit go-ahead before any further work.
