# NEXT_STEPS.md — NeuCore Platform

**Last updated:** 2026-05-30
**Read after:** `PROJECT_STATUS.md` + `FEATURE_STATUS.md`
**Purpose:** Tell a future Claude session exactly what to build next, in what order, and what's locked vs. open.

---

## 0 · Where we are right now

✅ 5 features shipped + live-verified · 7 migrations applied · 7 new JS modules · 12 commits on `claude/interesting-buck-452459` · HEAD at `2627a11`.

⏸ Awaiting user signoff on Feature 5 ("frozen") and a call on Feature 6 priority.

🛑 **No new feature work has been started.** This document is the on-ramp.

---

## 1 · Recommended build order

User-stated priority at the close of Feature 4 (still valid):
1. ✅ Feature 5: Exercise Video Integration — **DONE**
2. ⏸ **Feature 6: Alternative Exercise Replacement Workflow** ← next
3. ⏸ Feature 7: Assessment Results / 3D Hologram Integration

Rationale for keeping that order:
- F6 is **strictly downstream of F5** (it reuses `ExercisePicker` + `exercise_id` threading verbatim — neither would be possible without F5). Shipping F6 next harvests that investment while context is fresh.
- F7 is **standalone** — can be done before or after F6. Picking F6 first because the user said so and because F6's data model affects the alt-exercise pipeline already in production.

If priorities shift, F7 → F6 → smaller-polish-items is also a defensible order. Confirm with user before swapping.

---

## 2 · Feature 6 — Architecture preview (NOT yet locked)

When you (future Claude) get the "go" signal, propose this architecture first, then ask the open questions, then implement.

### 2.1 Goal
Coach gets an alt-exercise request → opens the response modal → can either type a free-text reply (today's behavior, retained) **or** pick a substitute exercise from the Library. When a substitute is set, the client's My Program view shows the substitute in place of the original. Progression engine automatically attributes the workout to whatever was actually performed (because `workout_exercise_logs.exercise_id` is captured at log time).

### 2.2 Schema change (one migration, one column)
```sql
-- supabase/migrations/20260606_alt_exercise_substitute.sql
ALTER TABLE exercise_alternative_requests
  ADD COLUMN IF NOT EXISTS substitute_exercise_id uuid
    REFERENCES exercises(id) ON DELETE SET NULL;

COMMENT ON COLUMN exercise_alternative_requests.substitute_exercise_id IS
  'When set, the client''s program view swaps the original exercise '
  '(workout_key, exercise_index) for this library exercise. Persists until '
  'the coach reverts (sets to null) or the program is republished.';
```

That's the whole DB change. RLS already covers it via the existing `aer_coach_update` policy. No new view, no new function.

### 2.3 JS changes (estimated)
| Module | Change | Lines |
|---|---|---|
| `js/altExerciseRequest.js` | Response modal gains "🔄 Pick substitute" button → `ExercisePicker.open({ defaultFilter, onSelect })`. Stores `substitute_exercise_id` on UPDATE alongside status + coach_response. | +50 |
| `js/programPublish.js` `renderClientProgram` | Pre-fetch active substitutions: `sb.from('exercise_alternative_requests').select('workout_key, exercise_index, substitute_exercise_id').eq('client_id', uid).eq('status', 'addressed').not('substitute_exercise_id', 'is', null)`. Build a Map keyed by `(workout_key, exercise_index)`. In `_roExerciseRow`, swap the rendered library row if a substitute exists. Show a "🔄 Substituted" pill on the swapped row. | +60 |
| `js/workoutSession.js` `mountWorkouts` | Same substitution Map → swap `ex.exercise_id` (and display name) in the active workout tracker so the log row carries the substitute's id. | +30 |
| `js/altExerciseRequest.js` coach inbox | "Revert substitute" button per addressed request that previously had a substitute set. | +15 |

Total: **~155 lines, one migration, zero new modules** (all reusable pieces already exist).

### 2.4 Open questions to ask the user before locking
1. **Substitution scope.** When the coach picks a substitute, does it apply to all future workouts (rolling) or just the next session? **Recommendation:** rolling until the coach reverts or republishes the program. Simplest mental model.
2. **Reverting.** Two reasonable UX paths:
   - (a) Coach edits the response and clears the substitute → sets `substitute_exercise_id = null`
   - (b) Republishing the program automatically clears all substitutions (since the program itself changed)
   - **Recommendation:** both. Coach can clear individually; republish nukes all.
3. **Visible to client.** Should the client see *why* the exercise was swapped (coach_response text shown next to the substituted row)? **Recommendation:** yes — the existing `coach_response` text shows in the inbox notification; mirror it as a hover tooltip on the "🔄 Substituted" pill.

### 2.5 Live verification plan (same shape as F5)
1. Insert an alt-exercise request as test client b00 against an existing library exercise.
2. UPDATE the row from the coach side, setting `substitute_exercise_id` to a second library exercise.
3. Re-render `client_programs` view → confirm `renderClientProgram` would swap the row (via SQL: SELECT the substitution map join).
4. Insert a workout_exercise_logs row simulating the client performing the workout → confirm `exercise_id` = substitute (not original).
5. LEFT JOIN onto `exercises` → analytics correctly point at the substitute.
6. Clear `substitute_exercise_id` → verify the row reverts.
7. Clean up.

### 2.6 Out of scope (lock before building)
- "Suggest alternative" auto-recommendations (e.g. by tag overlap) — separate future feature
- Substitution history (today's row is the current state; no audit trail beyond `responded_at`)
- Multi-substitute (one substitute per request — if coach changes their mind, they UPDATE the same row)
- Programmatic library `equivalent_exercises` table — separate future feature

---

## 3 · Outstanding gaps — full list (priority-ordered)

### 🔥 Should be tackled soon
| # | Gap | Effort | Why now |
|---|---|---|---|
| 1 | **F6 Alt-Exercise Replacement** | ~155 lines + 1 migration | Closes the spec promise "coach response substitutes the exercise" |
| 2 | **F7 Assessment / 3D Hologram Integration** | ~200 lines | Closes the client-dashboard "Loading…" placeholder (gap E from initial audit) |
| 3 | Email/SMS push for high-severity notifications | M | Coaches need offline awareness of alt-requests and grace events |

### 🟡 Useful, can wait
| # | Gap | Effort |
|---|---|---|
| 4 | Notification deep-link pre-select on target loaders | S |
| 5 | Daily pg_cron for `ensure_subscription_notifications` | S |
| 6 | "Unpublished program" indicator on coach Clients table | S |
| 7 | Per-exercise skip tristate in workout tracker | S |
| 8 | Three competing coach-progress surfaces unification (Progression / Workout History / Progress Charts) | M |
| 9 | Workout history → Progress Charts crossover | S |

### 🔵 Whole new domains
| # | Gap | Effort |
|---|---|---|
| 10 | Nutrition Plan feature (table + UI + signal feed) | L |
| 11 | Progression v2 (re-weight after nutrition + RPM phase signals exist) | L |
| 12 | Username vs email at signup (spec misalignment) | S — but needs user discussion first |

### ⚪ Deferred from earlier features (locked-out-of-scope)
| Feature | Deferred slice |
|---|---|
| F1 | Email push, daily cron |
| F3 | Deep-link pre-select, push, auto-archive, preferences UI |
| F4 | Historical snapshot table for trendlines |
| F5 | `default_prescription` auto-fill, polished `instructions` field, equipment/difficulty/duration metadata |

---

## 4 · How a future Claude session should start

1. **Read these three docs in order:** `PROJECT_STATUS.md` → `FEATURE_STATUS.md` → `NEXT_STEPS.md`.
2. **Don't start coding.** Confirm with the user which feature is next.
3. **Architecture first.** Always propose architecture (single message, multiple `## §` sections) and get a "go" before writing code.
4. **Honor the 4 locked architectural rules** (in `PROJECT_STATUS.md §1.2`):
   - Write-gate via `Auth.canWrite()`
   - Subscription state via `Auth.getSubscriptionState()`, never query `subscriptions` from UI
   - Notification inserts via `public.notify()`, never direct INSERT
   - Progression formula immutable in place — ship a v2 view if reweighting
5. **Stay in `app.html`** — never edit `index.html` unless explicitly asked.
6. **Use `apply_migration`** (not `execute_sql`) for any DDL — keeps the registry clean.
7. **Verify live** — for every feature with a DB change, drive at least one MCP smoke test before committing.
8. **One feature at a time** — no scope drift. If a related gap surfaces mid-build, surface it and ask before expanding scope.

---

## 5 · Decision log — choices the user already made

These are settled. Don't re-litigate unless the user signals a change.

| Decision | Settled by | Where |
|---|---|---|
| Use `app.html` only (not `index.html`) | First audit | early conversation |
| Build features one at a time, lock architecture first | User memory + multiple turns | working-style rules |
| Path A: drop legacy `notifications` instead of renaming the new one | User turn "Proceed with Path A" | commit `230f751` |
| Conditioning library filter routes to `tag='conditioning'` (no migration) | F5 proposal accepted | commit `2627a11` |
| Inline expand + fullscreen modal (both supported) | F5 requirements | commit `2627a11` |
| Autosuggest + Library button (both supported) | F5 requirements | commit `2627a11` |
| 7 filter chips: All · Phase 1–3 · Mobility · Strength · Conditioning | F5 requirements | commit `2627a11` |
| Features 1–4 frozen by signoff | User turn "Sign off Features 1-4 as complete" | last user message before F5 |
| F5 architecture: Option A (zero migrations, JSON shape evolution) | F5 proposal accepted | commit `2627a11` |
| ExercisePicker reusable for F6 | F5 architecture | commit `2627a11` |
| F6 will add `substitute_exercise_id` (one column) — not part of F5 | F5 proposal §7 | locked |

---

## 6 · Things only the user can decide (when you next get a turn)

1. **Is F5 formally frozen?** It's complete and verified but not explicitly signed off.
2. **Confirm F6 is next** (vs F7 swap).
3. **Approve the F6 architecture preview in §2** (or request changes).
4. **Answer F6's three open questions in §2.4** (substitution scope, revert UX, client visibility).
5. **(Optional) Widen `exercises.category` CHECK to include `'Conditioning'`** if you'd rather the chip be a category filter instead of a tag filter. 2-line migration.
6. **(Optional)** Resolve the pre-existing security advisor warnings (12 of 15 are pre-existing — out of this work's scope but worth a future cleanup pass).
7. **Push to remote?** Nothing has been pushed to origin yet — 5 unpushed commits on this branch.

---

## 7 · Quick reference — file map

### JS modules touched/created by this work
```
js/
├── auth.js                       ← edits (canWrite, getSubscriptionState, loginAsGuest stub)
├── altExerciseRequest.js         ← NEW (F3) — window.AltExercise
├── clientDashboard.js            ← edits (pill, grace banner, Progression panel)
├── clients.js                    ← edits (require coach, Workouts deep-link)
├── dashboard.js                  ← edits (4 new loaders, populateProgressClientSelect, _renderClientSettings)
├── exerciseInstructions.js       ← NEW (F5) — window.ExerciseInstructions
├── exerciseLibrary.js            ← UNCHANGED (read-only consumer)
├── exercisePicker.js             ← NEW (F5) — window.ExercisePicker (reusable for F6)
├── exerciseUI.js                 ← UNCHANGED (modal player reused)
├── notificationsService.js       ← NEW (F3) — window.Notifications
├── progressionEngine.js          ← NEW (F4) — window.Progression
├── programPublish.js             ← edits (publish editor + renderClientProgram for F5)
├── subscriptionService.js        ← NEW (F1) — window.SubscriptionService
├── subscriptions.js              ← edits (filter chips, grace stat, reactivate)
└── workoutSession.js             ← NEW (F2) — window.WorkoutSession; edits for F3 (⇄ Alt) + F5 (media)
```

### Migrations (all live)
```
supabase/migrations/
├── 20260530_subscription_grace.sql              ← F1
├── 20260531_workout_tracking.sql                ← F2
├── 20260601_notifications_inbox.sql             ← F3 (preceded by drop_legacy_notifications)
├── 20260602_progression_engine.sql              ← F4 (live-adapted for battery_pct schema)
├── 20260603_notification_guards_and_phase_upgrade.sql  ← Tier 1
└── 20260604_advisor_hardening.sql               ← Tier 2
```

### Handoff docs
```
PROJECT_STATUS.md          — big picture, architecture, live state
FEATURE_STATUS.md          — per-feature breakdown
NEXT_STEPS.md              — this file
FEATURE_5_PROPOSAL.md      — kept as the F5 design record
```

---

## 8 · Compaction note

This session was paused for compaction with these three documents as the handoff snapshot. A future Claude session has zero context loss as long as it reads them before acting. If something here contradicts what the user says in the next turn, **the user wins** — these docs were written from this session's vantage and may not reflect later decisions.

Branch `claude/interesting-buck-452459`. HEAD `2627a11`. Nothing pushed. Working tree will be clean after committing these handoff docs.
