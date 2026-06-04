# NEXT_STEPS.md — NeuCore Platform

**Last updated:** 2026-05-31
**Read after:** `PROJECT_STATUS.md` + `FEATURE_STATUS.md` + `PRODUCT_AUDIT.md` + `FEATURE_6_ARCHITECTURE.md`
**Purpose:** Tell a future Claude session exactly what to build next, in what order, and what's locked vs. open.

---

## 0 · Where we are right now

✅ 6 features + 1 reliability sweep + 1 system stabilization pass shipped + live-verified · 10 migrations applied · 7 new JS modules · System Stabilization Pass just shipped on `claude/interesting-buck-452459`.

🔒 Features 1–6 + Reliability Sweep signed off (frozen). System Stabilization Pass complete + smoke-verified, not yet formally frozen.

✅ **Feature 7 — Assessment Results / 3D Hologram Integration: DONE** (S1–S4, frontend-only). See FEATURE_7_ARCHITECTURE.md.

---

## 1 · Recommended build order

Updated post-Stabilization:
1. ✅ Feature 5: Exercise Video Integration — **DONE + 🔒 frozen**
2. ✅ Feature 6: Alternative Exercise Replacement — **DONE + 🔒 frozen**
3. ✅ Reliability + Defect Sweep — **DONE + 🔒 frozen**
4. ✅ System Stabilization Pass — **DONE** (awaiting signoff to freeze)
5. ✅ **Feature 7: Assessment Results / 3D Hologram Integration** — DONE (S1–S4)
6. ⏸ Deferred Highs: H4 (client workout history), H6 (coach reassignment UI), H8 (onboarding flows) — each needs its own architecture pass
7. ⏸ Logged follow-ups from Stabilization: (a) BEFORE UPDATE trigger pinning `sessions.client_id` + `coach_id` immutability; (b) upstream "offline mode" UI that disables write surfaces when SB unreachable

### Reliability + Defect Sweep — scope locked from PRODUCT_AUDIT.md Part 4

Single focused commit, ~1 day, fixes silently-broken-in-production issues:

| Bucket | Fix | Source |
|---|---|---|
| C1 | Migrate `_sessions` + Programs list off `localStorage` onto `sessions` + `client_programs` tables. Add coach-side "Programs" reader that queries `client_programs` with coach filter. | PRODUCT_AUDIT TD1 + TD9 |
| C2 | Move the Anthropic call into a Supabase edge function (`generate-program-narrative`) with the API key as a Supabase secret. UI calls the edge fn. | PRODUCT_AUDIT TD2 + TD17 |
| C3 | Wire the client dashboard Assessment Report card to the latest `assessments` + `rehab_objective_assessments` + coach notes (replaces TD11 dead text — this is the first slice of F7). | PRODUCT_AUDIT TD11 |
| C5 | Add current-phase guard to Phase Upgrade modal. Disable downgrade selection; refuse same-phase. | PRODUCT_AUDIT TD8 |
| H1 | Replace "Back to NeuCore" `index.html` link with sign-out or remove. | PRODUCT_AUDIT TD3 |
| H2 | Add role gating to mobile bottom-nav buttons. | PRODUCT_AUDIT TD4 |
| H3 | Add `nav-notifications` sidebar entry visible to clients. | PRODUCT_AUDIT TD10 |
| H7 | Replace `stat-sessions` count with a DB query. | PRODUCT_AUDIT TD5 |

After the sweep, F7 lands. F7's first slice (C3) is already part of the sweep — F7 then expands it into the full Assessment / 3D Hologram integration.

---

## 2 · Feature 6 — SHIPPED (architecture record kept for posterity)

This section was a planning preview before F6 shipped. The actual architecture-as-built is documented in `FEATURE_6_ARCHITECTURE.md` (12 sections, all 4 user decisions locked, with the v1.1 progression-formula adjustment forced by Q1 added as a documented v1.0→v1.1 bump in the migration). The text below is preserved as the historical record of what was *planned*.

### ⚠ DIFFERENCES BETWEEN PLAN AND BUILD

- **Migration carried THREE changes, not one** — the architecture preview anticipated only the `substitute_exercise_id` column, but Q1's "no penalty for resolved requests" forced a formula-version bump. F6's migration therefore also `CREATE OR REPLACE`-d `v_client_progression` as v1.1, with the `alt` CTE filtering out successfully-substituted requests. This honored the locked "no in-place silent drift" rule by being an explicit version-stamped migration with a CHANGELOG header.
- **Republish sweep wording** — Q2 specified the exact body: `"Closed — Program Republished"` (not the original preview's "[Closed — program republished]"). Used verbatim.
- **Original-exercise visibility (Q3)** — chose tooltip-only on the badge. Implemented on both surfaces (My Program in `programPublish._roExerciseRow` and Workout Tracker in `workoutSession._renderExerciseLogRow`).
- **JS line count came in at ~155 (estimate matched).** Spread across 3 modules; zero new modules.

---

## 2-OLD · Feature 6 — Architecture preview (the plan, now superseded by FEATURE_6_ARCHITECTURE.md)

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
| 1 | ✅ **F6 Alt-Exercise Replacement** | shipped 2026-05-31 | DONE — closed the spec promise + bumped progression to v1.1 |
| 2 | **Reliability + Defect Sweep** | ~1 day, single commit | Closes PRODUCT_AUDIT C1, C2, C3, C5 + H1, H2, H3, H7 |
| 3 | **F7 Assessment / 3D Hologram Integration** | ~200 lines, builds on sweep's C3 slice | Full expansion of the client-dashboard Assessment Report wiring |
| 4 | Email/SMS push for high-severity notifications | M | Coaches need offline awareness of alt-requests and grace events |

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

1. **Is the Reliability + Defect Sweep formally frozen?** Complete + smoke-verified but not explicitly signed off.
2. **Confirm Feature 7 is next** (vs picking up a deferred High first).
3. **Provision `GEMINI_API_KEY`** in Supabase project secrets if it isn't already. The `generate-program` edge function uses it. Without it, the new honest-toast warning will fire on every Generate (program still saves; only the AI narrative is missing).
4. **(Future, out of Sweep scope)** Tighten the `sessions` RLS so coaches can't read other coaches' sessions. Logged as Medium.
5. **(Optional)** Widen `exercises.category` CHECK to include `'Conditioning'` if you'd prefer it as a category instead of a tag.
6. **(Optional)** Resolve the 12 pre-existing security advisor warnings.
7. **Push to remote?** Nothing has been pushed to origin yet — unpushed commits include F5 + F6 + handoff docs + PRODUCT_AUDIT + FEATURE_6_ARCHITECTURE + RELIABILITY_SWEEP_ARCHITECTURE.

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
