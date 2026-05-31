# FEATURE_6_ARCHITECTURE.md — Alternative Exercise Replacement Workflow

**Status:** Proposal · NOT yet approved · NO code written
**Author:** Claude (continuation session)
**Date:** 2026-05-31
**Branch target:** `claude/interesting-buck-452459` (HEAD `4d907a7`)
**Depends on:** F1 (write-gate) · F2 (workout tracker) · F3 (notifications + alt-request) · F5 (ExercisePicker + libMap threading)

---

## 0 · TL;DR

Today, a client asks for an alternative exercise (F3); the coach can reply with text but **the program does not change** — the client opens My Program and still sees the original exercise. This is the half-finished promise PRODUCT_AUDIT.md flagged as critical (C4).

F6 closes the loop:

1. Add **one column** to `exercise_alternative_requests`: `substitute_exercise_id uuid REFERENCES exercises(id) ON DELETE SET NULL`.
2. **Override layer** (NOT program mutation): My Program + Workout Tracker query the active substitutions table at render time and swap the exercise row before painting.
3. ExercisePicker (already reusable from F5) becomes the coach's "🔄 Pick substitute" UX inside the existing Respond modal.
4. The existing `tg_aer_notify_client` trigger fires unchanged — only the notification *body text* gets enriched to mention the substitute's name when one is set.
5. Workout logs already carry `exercise_id`; substituted workouts will naturally log against the substitute's id — Progression Engine v1 keeps working.

**~155 lines of JS · 1 migration (one ALTER TABLE + one trigger fn refresh) · zero new modules.**

---

## 1 · Complete client workflow

This is the workflow as it exists today, with the F6 additions called out inline.

### 1.1 Client requests an alternative — **unchanged from F3**

| Step | Surface | Code |
|---|---|---|
| Client opens My Program | `#section-my-program` → `ProgramPublish.renderClientProgram('#my-program-host')` | `js/programPublish.js:445+` |
| Client starts the workout | `WorkoutSession.mountWorkouts` paints the live tracker into each `[data-workout-tracker-host]` slot | `js/workoutSession.js:182` |
| Each exercise row shows a ⇄ Alt button (top-right of the row) | `_renderExerciseLogRow` → `[data-ws-alt-request]` | `js/workoutSession.js:373-376` |
| Click ⇄ Alt → `AltExercise.openModal({ programId, workoutKey, exerciseIndex, exerciseName, exerciseId })` | `AltExercise.openModal` checks `Auth.canWrite()` + `profile.assigned_coach` | `js/altExerciseRequest.js:27-97` |
| Modal asks for a **required reason** (textarea + send button) | Existing F3 modal — empty reason is rejected with toast | `js/altExerciseRequest.js:77` |
| INSERT into `exercise_alternative_requests` (status default `pending`) | RLS: `aer_client_insert` requires `client_id = auth.uid()` | migration `20260601_notifications_inbox.sql:181-184` |
| DB trigger `tg_aer_insert` fires `notify()` → coach inbox | severity `warning` · link_section `notifications` · link_params `{request_id, client_id}` | migration L211-241 |
| Client sees toast "Request sent — your coach will respond shortly." | | `js/altExerciseRequest.js:91` |

**F6 does not change any of this.** The client-side request flow is already correct.

### 1.2 Request status visibility — **enhanced**

Today, the client gets a single notification when the coach decides (`tg_aer_notify_client`). F6 adds two visible client-side surfaces:

| F6 addition | Where | Why |
|---|---|---|
| **Inline pill on the swapped row** in My Program: "🔄 Substituted by your coach" (tooltip = `coach_response` text + original exercise name) | `programPublish.renderClientProgram` substitution-aware render path (see §4 + §5) | Spec point: "Request status tracking" — client sees status reflected in the exercise itself, not just an inbox row |
| **Notification body includes the substitute name** when one is set | `tg_aer_notify_client` enriched in F6 migration (still SECURITY DEFINER, still one INSERT) | "We replaced *Goblet Squat* with *Box Step-Up* — see your program." reads better than the generic "addressed" body |
| Client can see their **own request history** filtered by status (pending / addressed / declined) | Already covered by `aer_client_select` RLS; surfaces via the Notifications inbox today. Optional small "My Requests" view inside Client Settings could ship in a follow-up — **out of scope of F6.** | |

### 1.3 Status lifecycle, client-side

```
[no request]
     │
     │  client clicks ⇄ Alt + writes reason + sends
     ▼
  pending  ─── coach decides ──▶  addressed  ─── (with substitute_exercise_id?)
     │                                │
     │                                ├─ yes → program swap visible · "🔄 Substituted" pill
     │                                └─ no  → coach_response shows in notification only
     │
     └─────── coach decides ──▶  declined  (no swap · notification only)
```

The client cannot edit a request after it leaves `pending` (RLS `aer_client_update_pending` already enforces this — migration L191-195).

---

## 2 · Complete coach workflow

### 2.1 Coach receives the request — **unchanged from F3**

| Step | Surface | Code |
|---|---|---|
| Realtime channel + 60s poll fallback | `Notifications.subscribe` listens to inserts on `notifications` where `recipient_id = me` | `js/notificationsService.js` |
| Bell badge increments in sidebar footer | `Notifications.bindBell` | `app.html:235`, `js/notificationsService.js` |
| Coach navigates to Notifications | `#section-notifications` loader mounts inbox + `AltExercise.mountInbox(host)` (coach-only) | `js/dashboard.js:138-154` |
| Pending requests render as cards | `mountInbox` reads from `exercise_alternative_requests` filtered by `status` | `js/altExerciseRequest.js:100-147` |

### 2.2 Coach opens a request — **enhanced**

Coach clicks "Respond" on a request card → existing `_openResponseModal(row, onDone)` opens (`altExerciseRequest.js:175-231`). F6 extends this modal with substitute selection.

| Existing | F6 addition |
|---|---|
| Context block: exercise name + workout_key + client reason | unchanged |
| Textarea "Response to client" (free-text) | unchanged, now **optional** when a substitute is picked (coach can choose to send a substitute with no text) |
| Buttons: `Cancel` · `Decline` · `Mark Addressed` | unchanged — `Mark Addressed` is the path that persists the substitute |
| — | **NEW: "🔄 Pick substitute exercise" button** next to the textarea. Opens `ExercisePicker.open({ defaultFilter: 'all', title: 'Choose a substitute' })` (F5's reusable component) |
| — | **NEW: Selected-substitute preview card** under the button: thumbnail + name + tags + "✕ Clear" link. Renders when `_pickedSubstituteId !== null`. |
| — | **NEW: "🔄 Revert (clear substitute)" button** — only shown when the row already has `substitute_exercise_id` set (i.e., coach is editing an existing decision). Sets `substitute_exercise_id = null` on UPDATE. |

### 2.3 Coach picks the replacement — full UX

```
┌─────────────────────────────────────────────────┐
│ Respond to Alt-Exercise Request          [✕]   │
├─────────────────────────────────────────────────┤
│  Goblet Squat · workout A                       │
│  "Knee pain on the descent today."              │
│                                                 │
│  Response to client (optional)                  │
│  ┌─────────────────────────────────────────────┐│
│  │ Let's swap this for a step-up — same        ││
│  │ pattern, less knee load.                    ││
│  └─────────────────────────────────────────────┘│
│                                                 │
│  Substitute (optional)                          │
│  ┌─────────────────────────────────────────────┐│
│  │ ▶ [thumbnail]  Box Step-Up                  ││
│  │              [hip, knee] [strength]         ││
│  │                                ✕ Clear      ││
│  └─────────────────────────────────────────────┘│
│  [ 🔄 Pick substitute exercise ]                │
│                                                 │
├─────────────────────────────────────────────────┤
│         [Cancel] [Decline] [Mark Addressed]    │
└─────────────────────────────────────────────────┘
```

### 2.4 Coach sends the replacement — write path

`Mark Addressed` button click → single UPDATE:

```js
await sb.from('exercise_alternative_requests').update({
  status:                 'addressed',
  coach_response:         response || null,
  substitute_exercise_id: _pickedSubstituteId || null,  // F6 addition
  responded_at:           new Date().toISOString(),
}).eq('id', row.id);
```

- Existing RLS `aer_coach_update` (migration L198-207) already covers the new column.
- The DB trigger `tg_aer_notify_client` fires on `UPDATE OF status` — unchanged from F3 — but its body text is enriched in the F6 migration to mention the substitute's name when present.
- `Decline` button click: sets `status='declined'`, `substitute_exercise_id` left null (or cleared if previously set). Client sees the existing "declined" notification.

### 2.5 Coach revert path

If the coach changes their mind after sending:

1. Coach reopens the row from inbox (status filter "Addressed" → click "Edit response").
2. Modal re-opens pre-populated with current `coach_response` AND current substitute preview card.
3. Coach clicks ✕ Clear → `_pickedSubstituteId` reset to `null`. Or coach clicks "Pick substitute" again and picks a different exercise.
4. `Mark Addressed` again → UPDATE with new `substitute_exercise_id`.
5. The `tg_aer_notify_client` trigger only fires on `UPDATE OF status` — so a clear/swap *without* status change does NOT spam the client with a new notification. (See §6.3 for the design decision.)

---

## 3 · Database design

### 3.1 Migration — single ALTER + single trigger refresh

```sql
-- supabase/migrations/20260606_alt_exercise_substitute.sql
-- F6: Alternative Exercise Replacement Workflow
-- One column + refresh of one trigger function to enrich the client
-- notification body when a substitute is set.
-- Idempotent — safe to re-apply.

-- ── 1. New column ──────────────────────────────────────────────
ALTER TABLE exercise_alternative_requests
  ADD COLUMN IF NOT EXISTS substitute_exercise_id uuid
    REFERENCES exercises(id) ON DELETE SET NULL;

COMMENT ON COLUMN exercise_alternative_requests.substitute_exercise_id IS
  'When set, the client''s program view swaps the original exercise at '
  '(workout_key, exercise_index) for this library exercise. NULL = no '
  'substitute (free-text response only). ON DELETE SET NULL means deleting '
  'a library exercise auto-clears the substitution and the client falls '
  'back to the original. Persists until the coach clears it or the program '
  'is republished (which clears all addressed requests — see §4.3).';

-- Index supports the per-render lookup in renderClientProgram:
--   WHERE client_id = $1
--     AND status = 'addressed'
--     AND substitute_exercise_id IS NOT NULL
CREATE INDEX IF NOT EXISTS aer_active_substitutes_idx
  ON exercise_alternative_requests(client_id, status)
  WHERE status = 'addressed' AND substitute_exercise_id IS NOT NULL;

-- ── 2. Enrich the trigger fn so the client notification mentions
--     the substitute when one is set. Same auth path, same shape,
--     same RPC — only body text changes.
CREATE OR REPLACE FUNCTION public.tg_aer_notify_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub_name text;
  v_body     text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('addressed','declined') THEN RETURN NEW; END IF;
  -- FK guard (Tier-1 contract — preserved).
  IF NOT public._profile_exists(NEW.client_id) THEN RETURN NEW; END IF;

  IF NEW.status = 'addressed' AND NEW.substitute_exercise_id IS NOT NULL THEN
    SELECT name INTO v_sub_name FROM exercises WHERE id = NEW.substitute_exercise_id;
    v_body := 'Your coach replaced ' || NEW.exercise_name
              || ' with ' || COALESCE(v_sub_name, 'a new exercise')
              || CASE WHEN NEW.coach_response IS NOT NULL AND length(NEW.coach_response) > 0
                      THEN ' — ' || NEW.coach_response ELSE '.' END;
  ELSE
    v_body := COALESCE(NEW.coach_response, 'See details for next steps.');
  END IF;

  PERFORM public.notify(
    p_recipient_id => NEW.client_id,
    p_type         => 'alt_exercise_decided',
    p_title        => CASE WHEN NEW.status = 'addressed'
                           THEN 'Your alternative exercise was addressed'
                           ELSE 'Your alternative request was declined' END,
    p_body         => v_body,
    p_link_section => 'my-program',
    p_link_params  => jsonb_build_object(
                        'request_id',             NEW.id,
                        'substitute_exercise_id', NEW.substitute_exercise_id),
    p_severity     => CASE WHEN NEW.status = 'addressed' THEN 'info' ELSE 'warning' END,
    p_data         => jsonb_build_object('request_id', NEW.id,
                                         'status',     NEW.status,
                                         'substitute_exercise_id', NEW.substitute_exercise_id),
    p_actor_id     => NEW.coach_id
  );
  RETURN NEW;
END;
$$;
-- Trigger itself unchanged — same name, same event (AFTER UPDATE OF status).
-- The CREATE OR REPLACE FUNCTION above just swaps the body.

-- Tier-2 hygiene: revoke EXECUTE on the trigger fn from anon+authenticated
-- (mirrors existing 20260604_advisor_hardening.sql pattern).
REVOKE EXECUTE ON FUNCTION public.tg_aer_notify_client() FROM anon, authenticated, public;
```

### 3.2 What the migration does NOT touch

- **No new table.** Substitutions live on the existing request row — one substitute per request.
- **No new view.** UI queries the table directly with a tight WHERE clause that the new partial index covers.
- **No RLS policy change.** `aer_coach_update` (migration `20260601_notifications_inbox.sql:198-207`) is "coach can UPDATE assigned-client rows" — applies to every column on the row, including the new one.
- **No change to `tg_aer_insert`.** Coach notification on request arrival already says everything it should.
- **No change to `exercises`, `client_programs`, `workout_sessions`, `workout_exercise_logs`.** The program JSON is **not mutated**; substitutions are an override layer (see §4).

### 3.3 Status lifecycle (DB view)

```
status (CHECK pending | addressed | declined)
│
├─ pending                  substitute_exercise_id = NULL  (always)
├─ addressed                substitute_exercise_id IS NULL OR <uuid>
└─ declined                 substitute_exercise_id = NULL  (enforced by JS — see §3.4)
```

### 3.4 Implicit invariants (enforced in JS, not DB)

| Invariant | Why JS not DB | Where enforced |
|---|---|---|
| `status='declined'` implies `substitute_exercise_id IS NULL` | A coach who declines after picking a substitute should clear it. We could add a CHECK but it would forbid valid editing flows (coach toggles between substitute and decline). | `_openResponseModal` "Decline" handler clears the picked-id before UPDATE |
| `status='pending'` implies `substitute_exercise_id IS NULL` | Same reasoning — coach hasn't decided yet. | Never written by the client (RLS); coach never writes pending. |
| Only the **latest** addressed request per `(client_id, program_id, workout_key, exercise_index)` is the active substitution | Multiple historical requests for the same slot are legitimate (client asks again next week). | `renderClientProgram` substitution-map builder picks the most-recent `responded_at` per slot (see §4.4). |

### 3.5 Audit trail

Audit is **already present** — no new columns needed:

- `exercise_alternative_requests.created_at` — when client asked
- `exercise_alternative_requests.responded_at` — when coach decided
- `exercise_alternative_requests.coach_response` — what coach wrote
- `exercise_alternative_requests.substitute_exercise_id` — what was swapped
- `exercise_alternative_requests.status` — final decision
- **History:** because a coach can re-request a different substitute by UPDATE-ing the same row, we lose the *prior* substitute_id. **Deliberate tradeoff** — the request is a conversation, not an audit log. If full audit is needed later, add `exercise_alternative_request_events` table (out of scope for F6).
- **Notifications inbox keeps a forever-archive** of every decision (the `notifications` rows are immutable from the recipient's side; only `read_at` / `archived` toggle). So the "coach said X on date Y" history exists in the notification table.

---

## 4 · Program replacement strategy — TWO options, ONE recommended

This is the most important design decision in F6 and deserves an explicit tradeoff section.

### 4.1 Option A — Override layer (RECOMMENDED)

The published `client_programs.program` JSON is **never mutated**. Instead, every place that renders the program (My Program + Workout Tracker) does a lightweight per-render query:

```sql
SELECT workout_key, exercise_index, substitute_exercise_id, coach_response, exercise_name AS original_name
FROM exercise_alternative_requests
WHERE client_id = $1
  AND status = 'addressed'
  AND substitute_exercise_id IS NOT NULL;
```

Build a `Map<"workoutKey|exerciseIndex", {substituteId, response, originalName}>` and swap matching rows at render time using the *most recent* `responded_at` per slot.

**Pros:**

- ✅ **Honors locked rule #4 from `PROJECT_STATUS.md §1.2`** by analogy — published artifacts (program JSON, progression formula) are immutable in place; new layers come on top.
- ✅ **Easy to revert** — coach clears `substitute_exercise_id` → next render shows the original. No JSON migration logic.
- ✅ **Easy to audit** — the substitution lives in one row; the original program JSON is untouched.
- ✅ **Republish naturally clears overrides** — if the coach republishes the program, the new program's exercises may not match the old `(workout_key, exercise_index)` slots, so the override silently no-ops. Optional sweep (§4.3) deletes them.
- ✅ **Tracker integration is trivial** — the same override map is passed into `WorkoutSession.mountWorkouts`; mutating the in-memory `workouts[]` array before paint is one loop.
- ✅ **Progression engine compatibility is automatic** — see §7. Logs are made against the substitute's `exercise_id`; the view groups by exercise_name and exercise_id naturally.
- ✅ **Zero risk to legacy programs** — programs published before F6 have no addressed-with-substitute requests, so the map is empty, render is identical.

**Cons:**

- ⚠ One extra query per render of My Program / mountWorkouts. **Mitigation:** indexed via `aer_active_substitutes_idx`. Single-digit ms.
- ⚠ Substitution does not appear in PDF exports / coach Programs surface unless they also consult the table. **F6 scope:** My Program + Workout Tracker only; PDF export is out of scope for F6.

### 4.2 Option B — Mutate the program JSON (NOT recommended)

When the coach picks a substitute, write directly into `client_programs.program.workouts[workoutKey][warmup|main|cooldown][exerciseIndex].exercise_id = <substitute>` and `.name = <substitute_name>`.

**Pros:**

- 🟢 No per-render override query. Render is identical to today's code path.

**Cons:**

- 🔴 **Mutates a published artifact.** Loses the original exercise; revert is destructive or requires a separate snapshot table.
- 🔴 Forces the same change into PDF exports, analytics, every downstream consumer — silent surprises.
- 🔴 If two coaches edit a shared client, last-write-wins races on the JSON.
- 🔴 Republish wipes substitutions implicitly (program gets re-generated), with no way to know what was overridden.
- 🔴 Violates the spirit of the locked architectural rule "published artifacts are immutable."

### 4.3 Republish behavior (Option A specifics)

When the coach republishes a program via `programPublish` (which already UPSERTs `client_programs`), we should clear any active substitutions for that program. Otherwise a stale `(workout_key, exercise_index)` substitution from before the republish could swap the wrong exercise in the new program.

**Implementation:** when `programPublish.publish()` does its UPSERT, F6 follows with a single UPDATE:

```js
await sb.from('exercise_alternative_requests')
  .update({
    status:                 'declined',  // close them out so the trigger doesn't refire
    coach_response:         (row.coach_response || '') + '\n[Closed — program republished]',
    substitute_exercise_id: null,
  })
  .eq('client_id', clientId)
  .eq('status', 'addressed')
  .not('substitute_exercise_id', 'is', null);
```

This is ~6 lines in `programPublish.publish` after the existing UPSERT. The trigger `tg_aer_notify_client` fires once per closed request with a "program updated" message — acceptable; coach is in control.

**Alternative if user prefers silent close:** add a `system_closed boolean DEFAULT false` flag and skip notification when set. **Recommendation: skip this complexity — keep the trigger as-is, accept one notification per republished-substituted request.**

### 4.4 "Most recent per slot" tie-break

A client could legitimately request alternatives for the *same* exercise twice (e.g., last week and again today). The renderer builds the override map by sorting `addressed AND substitute_exercise_id IS NOT NULL` requests by `responded_at DESC` and taking the first per `(workout_key, exercise_index)` pair. One pass, no SQL window functions needed.

### 4.5 Recommendation

**Adopt Option A — Override layer.** Lower risk, easier revert, honors the architectural philosophy already locked, and the per-render cost is negligible.

---

## 5 · Workout tracker integration

### 5.1 Where the swap happens

The substitution map is built **once** by `programPublish.renderClientProgram` (which already does the F5 library prefetch — perfect place to add one more query) and **passed down** to `WorkoutSession.mountWorkouts({ workouts, libMap, substitutions })`.

| File | Change | Lines |
|---|---|---|
| `js/programPublish.js` | After F5's `libMap` build (around L490): add the `subMap` fetch. Then walk the `workouts[]` tree and rewrite each `{warmup,main,cooldown}[i]` whose `(wk.id, i)` matches the map: replace `exercise_id`, `name`, and add `_substitutedFrom = originalName` + `_substituteResponse = coach_response` for the UI pill. Pass `substitutions` into `WorkoutSession.mountWorkouts(...)`. | +35 |
| `js/programPublish.js` | `_roExerciseRow` accepts the new flags and renders the "🔄 Substituted by your coach" pill above the exercise name (or as an inline badge). Tooltip = response + "Originally: {originalName}". | +20 |
| `js/programPublish.js` | `publish()` adds the §4.3 sweep after the existing UPSERT. | +8 |
| `js/workoutSession.js` | `mountWorkouts` already accepts `workouts` — no signature change required because the swap happens **upstream** in programPublish. The tracker just sees a workouts array with the new exercise_id and name. **Zero changes here for the swap itself.** | 0 |
| `js/workoutSession.js` | Optional: render the same "🔄 Substituted" pill on the live tracker row. ~10 lines in `_renderExerciseLogRow`. | +10 |
| `js/altExerciseRequest.js` | `_openResponseModal` grows the substitute UI (button, preview card, clear, revert) and the UPDATE call carries the new column. | +50 |
| `js/altExerciseRequest.js` | `_renderRow` (coach inbox card) shows the substitute name pill when one is set. | +8 |
| **Total** | | **~130 lines** |

### 5.2 Video + instructions keep working — automatic

The F5 path is: row has `exercise_id` → `_exMeta(ex)` returns the library row → thumbnail / ▶ Preview / ℹ Instructions render. After the substitution swap in §5.1, `ex.exercise_id` is the *substitute's* id, so `_exMeta` returns the substitute's library row and **all F5 media wiring works unchanged**.

The substitute exercise MUST be a linked library exercise (we picked it via ExercisePicker). So `meta` is always non-null for substitutes — substitutions always have media when the library row has it.

### 5.3 Exercise logging keeps using exercise_id — automatic

`WorkoutSession._wireExerciseRow` calls `logExercise(sessionId, { exerciseId: ex.exercise_id, ... })` (`js/workoutSession.js:419`). After the swap, `ex.exercise_id` is the substitute's id, so `workout_exercise_logs.exercise_id` correctly points at the substitute. **Zero change to logExercise.**

### 5.4 Edge cases handled by Option A

| Edge case | Behavior |
|---|---|
| Coach picks substitute mid-workout (client already started) | Tracker re-render is triggered by `mountWorkouts` only on Start/Finish — substitution appears next render. Coach intervention mid-workout is rare; if needed, client refresh shows it. **Acceptable.** |
| Coach picks substitute for a workout the client never ran | Override appears on every future render until cleared or republish. ✅ |
| Coach picks substitute, then deletes the library exercise | `ON DELETE SET NULL` clears `substitute_exercise_id` → renderer falls back to original. ✅ Per-render check: `if (subMap.has(key) && subMap.get(key).substituteId === null) ignore`. |
| Coach republishes program | §4.3 sweep closes all active substitutions for that client. ✅ |
| Client has substitution for slot `(A, 3)` but new program has only 2 exercises in workout A | Override silently no-ops (no matching slot during render). ✅ |
| Coach removes assignment (client reassigned to different coach) | Old coach's substitutions persist (FK is to `exercises`, not coach). New coach inherits — design choice. If user wants "sweep on reassign," add explicit step — **out of scope of F6.** |

---

## 6 · Notifications

### 6.1 Coach notified on request arrival — **unchanged**

`tg_aer_notify_coach` already fires on INSERT. No change. Severity `warning`. Deep-link to `notifications` section with `{request_id, client_id}` params.

### 6.2 Client notified on coach decision — **enriched body**

`tg_aer_notify_client` already fires on `UPDATE OF status`. F6 migration swaps the function body so:

- When `status='addressed'` AND `substitute_exercise_id IS NOT NULL` → body = "Your coach replaced *Goblet Squat* with *Box Step-Up* — Let's swap this for a step-up, same pattern, less knee load."
- When `status='addressed'` AND `substitute_exercise_id IS NULL` → body = `coach_response` (today's behavior).
- When `status='declined'` → body = `coach_response` (today's behavior, severity `warning`).
- `link_params` now includes `substitute_exercise_id` so a deep-link could pre-highlight the swapped row (UI work optional).

### 6.3 What we DON'T fire

| Event | Notification? | Why |
|---|---|---|
| Coach edits a substituted request → changes the substitute to a different exercise (status stays `addressed`) | **No** | Trigger is `AFTER UPDATE OF status`. Body re-render on render time is enough. Avoids notification spam if a coach iterates. |
| Coach clears the substitute (sets it to NULL, status stays `addressed`) | **No** | Same reason. Client's program reverts on next render. |
| Coach reverts via republish sweep (§4.3) | **Yes — once per closed request** | The sweep sets `status='declined'`, so the existing trigger fires. Body includes "[Closed — program republished]". Acceptable. |
| `_profile_exists(client_id)` returns false (orphaned request after profile deletion) | Trigger no-ops silently (Tier-1 FK guard preserved). | Safety contract from migration `20260603`. |

### 6.4 Notification authorization unchanged

The `notify()` RPC's coach→client authorization (migration L120-124) checks `profiles.assigned_coach`. As long as the assignment is in place, all F6 notifications pass. If the coach is reassigned mid-flight, the trigger may fail authorization — `_profile_exists` is not the issue, the `assigned_coach` check is. **This is the same brittleness Tier-1 documented and is out of F6 scope.**

---

## 7 · Progression compatibility — Feature 4 keeps working

The F4 progression view `v_client_progression` (migration `20260602_progression_engine.sql`) reads from `workout_sessions`, `workout_exercise_logs`, `daily_routine_logs`, and `exercise_alternative_requests`.

### 7.1 Each signal under F6

| Signal | F6 effect | Reasoning |
|---|---|---|
| **Compliance** = 0.4·workout_completion + 0.4·routine + 0.2·exercise_completion | No effect | Counts sessions and completed exercises; doesn't care which exercise. |
| **Recovery** = 100 − 10·overreach − 30·abandonment − 5·alt_requests_30d | **One alt_request still counts as one alt_request even if it ends in a substitute.** Score penalty is 5 either way. | A substituted request is still friction the client experienced. Penalizing it (mildly) keeps the signal honest. **If user wants to NOT penalize successful substitutions, change the `alt` CTE to `WHERE status != 'addressed' OR substitute_exercise_id IS NULL`** — discuss in §10. |
| **Performance** = mean per-exercise (latest vol vs first) over rolling 30d | **Substitute logs against the substitute's name + exercise_id** (because logExercise threads them — §5.3). So if the client does Box Step-Up 3+ times in 30d, it counts as a Box Step-Up progression. | The view groups `ex_top` by `s.client_id, l.exercise_name` (line 94 of progression migration) — substitutions thus contribute to the substitute's progression line, not the original's. Correct attribution. |
| **Overall** = 0.4·C + 0.3·R + 0.3·P | No formula change | F4's locked-in-place rule honored. |

### 7.2 No view migration needed

F6 ships **zero changes** to `v_client_progression`. The view's joins use exercise_name and exercise_id from `workout_exercise_logs` directly; substitutions are reflected naturally because the logs were made with substitute values at write time. Formula v1.0 stays. Any reweighting would still need a v2 migration per the locked rule.

### 7.3 Edge case — partial migration before substitution exists in logs

A client could have an addressed substitution but no logged sessions against it yet. Progression view sees the alt-request (penalty applied), no new performance data point (no change to Performance). This is correct.

---

## 8 · Verification plan

### 8.1 Pre-implementation — confirm assumptions live

Before writing code, the MCP tools (`mcp__f0b78c38-...__execute_sql`) confirm:

1. `exercise_alternative_requests` exists and matches the migration shape (it does — see schema in §3.1's NULL spot).
2. `tg_aer_notify_client` is currently attached and functional.
3. `aer_coach_update` policy exists.
4. `_profile_exists` helper exists and is callable from triggers.
5. The `exercises` table has at least 2 rows we can use as request-original + substitute in the smoke test.

### 8.2 Live database verification — single MCP transcript

After applying `20260606_alt_exercise_substitute.sql` via `apply_migration`:

```sql
-- 1. Column exists with correct FK + ON DELETE SET NULL behavior
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'exercise_alternative_requests'
  AND column_name = 'substitute_exercise_id';

-- 2. Partial index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'exercise_alternative_requests'
  AND indexname = 'aer_active_substitutes_idx';

-- 3. Trigger function bytecode includes the substitute-aware branch
SELECT prosrc FROM pg_proc
WHERE proname = 'tg_aer_notify_client'
  AND prosrc LIKE '%substitute_exercise_id%';

-- 4. End-to-end: insert a pending request, UPDATE with substitute, verify notification body
--    (uses two real library exercise IDs; cleanup at the end)
DO $$
DECLARE
  v_client uuid; v_coach uuid;
  v_ex_orig uuid; v_ex_sub uuid;
  v_req uuid; v_notif_body text;
BEGIN
  SELECT id INTO v_client FROM profiles WHERE role='client' LIMIT 1;
  SELECT assigned_coach INTO v_coach FROM profiles WHERE id = v_client;
  SELECT id INTO v_ex_orig FROM exercises ORDER BY created_at LIMIT 1;
  SELECT id INTO v_ex_sub  FROM exercises WHERE id <> v_ex_orig ORDER BY created_at LIMIT 1;

  -- INSERT pending request (as if client did it)
  INSERT INTO exercise_alternative_requests
    (client_id, coach_id, workout_key, exercise_index, exercise_name, exercise_id, reason)
  VALUES
    (v_client, v_coach, 'A', 3, 'Test Original', v_ex_orig, 'F6 smoke test')
  RETURNING id INTO v_req;

  -- UPDATE → addressed + substitute (coach side)
  UPDATE exercise_alternative_requests
  SET status = 'addressed',
      substitute_exercise_id = v_ex_sub,
      coach_response = 'Try this instead',
      responded_at = now()
  WHERE id = v_req;

  -- Verify client got a notification mentioning the substitute name
  SELECT body INTO v_notif_body FROM notifications
  WHERE recipient_id = v_client
    AND type = 'alt_exercise_decided'
    AND data->>'request_id' = v_req::text
  ORDER BY created_at DESC LIMIT 1;

  RAISE NOTICE 'F6 notif body: %', v_notif_body;
  ASSERT v_notif_body LIKE '%Test Original%', 'body should mention original';
  ASSERT v_notif_body LIKE '%Try this instead%', 'body should include coach_response';

  -- Cleanup
  DELETE FROM notifications WHERE data->>'request_id' = v_req::text;
  DELETE FROM exercise_alternative_requests WHERE id = v_req;
END $$;

-- 5. Active-substitute lookup (the per-render query that renderClientProgram will issue)
SELECT workout_key, exercise_index, substitute_exercise_id, coach_response
FROM exercise_alternative_requests
WHERE client_id = $1
  AND status = 'addressed'
  AND substitute_exercise_id IS NOT NULL
ORDER BY responded_at DESC;
```

### 8.3 End-to-end workflow verification (manual, post-deploy)

In `app.html` against the live DB:

1. Log in as a real client with at least one published program. Open My Program. Start any workout. Click ⇄ Alt on exercise #3. Write a reason. Send.
2. Log in as the assigned coach (separate browser). Notifications inbox shows the pending alt-request card. Click Respond.
3. Type a short response. Click "🔄 Pick substitute exercise". ExercisePicker opens. Pick any exercise. Modal preview card appears with the picked substitute. Click Mark Addressed.
4. Verify the coach inbox card now shows status "Addressed" with the substitute name pill.
5. Switch to the client browser. Notifications bell badge increments. Open notification — body reads "Your coach replaced *X* with *Y* — *response text*".
6. Open My Program → confirm exercise #3 now renders as the substitute (different name, different thumbnail, different ℹ Instructions). Pill above the row says "🔄 Substituted by your coach" — hovering shows the response.
7. Re-enter the workout (Start). Confirm tracker shows the substitute. Log a set. Confirm `workout_exercise_logs.exercise_id` in DB = substitute's id (via MCP SELECT).
8. As coach: edit response, click ✕ Clear, Mark Addressed → client refreshes My Program → original exercise back. No new notification fires (only `status` change triggers; status stayed `addressed`).
9. As coach: republish the program → §4.3 sweep fires → request status flips to `declined` → client gets one notification "[Closed — program republished]" → My Program shows the freshly published program.

### 8.4 Regression verification (Features 1–5)

- **F1 — write-gate:** an expired client tries to click ⇄ Alt → `AltExercise.openModal` checks `Auth.canWrite()` → toast. (Unchanged in F6.)
- **F2 — workout tracking:** the substitute log is upserted on `(session_id, exercise_index)`. Same constraint, no risk. Verify the active-session unique still works.
- **F3 — notifications:** existing alt-request inbox path unchanged. Verify with a second alt-request flow that the body is the F3 form (no substitute) when coach replies free-text without a substitute.
- **F4 — progression:** before and after F6 smoke test, capture `SELECT * FROM v_client_progression WHERE client_id = <test>`. Difference should be: `alt_requests_30d += 1` (Recovery −5), `exercises_tracked_30d` unchanged unless 3+ substitute logs exist.
- **F5 — exercise integration:** confirm the substituted exercise has its thumbnail / ▶ Preview / ℹ Instructions rendering — these were tested for linked-original rows in F5, now we're testing they work for linked-substitute rows. Same code path.

### 8.5 Rollback strategy

F6 is **highly rollback-safe** because:

- The `substitute_exercise_id` column is additive — dropping it removes the feature without orphaning data.
- The trigger function refresh can be reverted by re-applying the `tg_aer_notify_client` body from `20260601_notifications_inbox.sql:244-265`.
- The JS layer is additive: removing the F6 commit restores the F3-only behavior; existing substitution rows in the DB harmlessly become readable but unrendered.

**Rollback script** (would ship as `20260606_alt_exercise_substitute_DOWN.sql` in the worktree, not auto-applied):

```sql
-- Restore the F3 version of the trigger fn (no substitute branch)
CREATE OR REPLACE FUNCTION public.tg_aer_notify_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('addressed','declined') THEN RETURN NEW; END IF;
  IF NOT public._profile_exists(NEW.client_id) THEN RETURN NEW; END IF;
  PERFORM public.notify(
    p_recipient_id => NEW.client_id,
    p_type         => 'alt_exercise_decided',
    p_title        => CASE WHEN NEW.status = 'addressed'
                           THEN 'Your alternative exercise was addressed'
                           ELSE 'Your alternative request was declined' END,
    p_body         => COALESCE(NEW.coach_response, 'See details for next steps.'),
    p_link_section => 'my-program',
    p_link_params  => jsonb_build_object('request_id', NEW.id),
    p_severity     => CASE WHEN NEW.status = 'addressed' THEN 'info' ELSE 'warning' END,
    p_data         => jsonb_build_object('request_id', NEW.id, 'status', NEW.status),
    p_actor_id     => NEW.coach_id
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_aer_notify_client() FROM anon, authenticated, public;

DROP INDEX IF EXISTS aer_active_substitutes_idx;

ALTER TABLE exercise_alternative_requests DROP COLUMN IF EXISTS substitute_exercise_id;
```

JS rollback is `git revert <f6-commit>`.

---

## 9 · Out of scope (locked before building)

| Item | Why deferred |
|---|---|
| Auto-suggest substitute exercises by tag/joint overlap | Separate ML/heuristic feature. F6 keeps coach in full control. |
| Substitution history audit table (`exercise_alternative_request_events`) | Notifications inbox preserves coach-decision history; the request row is intentionally one-substitute-at-a-time. |
| Multi-substitute (alternate progression paths) | One slot, one substitute. Coach changes their mind via UPDATE. |
| `exercises.equivalent_exercises[]` programmatic equivalence | Library polish — separate feature. |
| Client-side "My Requests" history panel | Out of F6; can ride with a future client-settings expansion. |
| PDF export reflects substitutions | F6 scopes to My Program + Workout Tracker; PDF is a different surface. |
| Substitution affects coach-side **Programs** page | TD9 from PRODUCT_AUDIT — that page is broken in a different way (`localStorage` not DB). Out of F6 scope. |
| Notification deep-link pre-selects the substituted row in My Program | Deferred F3 slice (NEXT_STEPS §3); could ride with F6 but adds scope — defer. |
| Email/SMS push for high-severity substitution decisions | Deferred F1/F3 slice. |

---

## 10 · Open questions for the user (must answer before implementation)

These are the only things I need from you before I write a line of code:

### Q1 — Recovery-score penalty for successful substitutions

The F4 progression formula penalizes every alt-request `−5` in Recovery, regardless of outcome. Should a successful substitution (coach picked an exercise) still cost the client 5 points?

- **(a) Yes, still penalize** (current behavior — recommendation: simplest, friction is friction)
- **(b) No, penalize only `pending` + `declined`** (more nuanced; needs view edit which would be v1.1 per the immutable-formula rule)

**My recommendation: (a)** — keep formula v1.0 intact. Revisit in v2 alongside nutrition.

### Q2 — Republish behavior

When the coach republishes a program, what should happen to active substitutions?

- **(a) Auto-close them as `declined` with body "[Closed — program republished]"** (one notification per closed request — recommended, transparent)
- **(b) Silently delete them** (no notification, no audit footprint)
- **(c) Leave them alone** (could swap an unrelated exercise if slots happen to align — risky)

**My recommendation: (a).**

### Q3 — Visibility of original exercise to client

When a substitution is active, should the client see the original exercise name anywhere?

- **(a) Show only the substitute; tooltip on the "🔄 Substituted" pill reveals "Originally: X"** (recommended — keeps the row focused on what they should do)
- **(b) Show both names ("Box Step-Up — replaces Goblet Squat")**
- **(c) Show only the substitute, no reveal at all**

**My recommendation: (a).**

### Q4 — Order in the implementation queue

- **(a) Ship F6 first** (per standing plan in NEXT_STEPS — closes the half-finished promise)
- **(b) Do the PRODUCT_AUDIT.md "Reliability + Defect Sweep" first** (fixes C1–C5 — silently broken in production)
- **(c) Interleave: ship F6 + a subset of the sweep that touches the same files** (e.g., TD11 Assessment Report card is adjacent to F7 not F6 — wouldn't naturally interleave)

**My recommendation: (a) — ship F6 first.** The audit's defects are real but they're orthogonal to F6's touchpoints; tackling them together would muddy the commit.

---

## 11 · Files map

```
Migration (NEW):
  supabase/migrations/20260606_alt_exercise_substitute.sql      (≈70 lines)

JS (EDIT — no new modules):
  js/altExerciseRequest.js                                       (+58 lines)
    └─ _openResponseModal: substitute picker + preview + clear + revert
    └─ _renderRow:         substitute name pill on addressed cards
  js/programPublish.js                                           (+63 lines)
    └─ renderClientProgram: build subMap, swap exercise objects, render pill
    └─ _roExerciseRow:      accept _substitutedFrom / _substituteResponse
    └─ publish:             §4.3 sweep after upsert
  js/workoutSession.js                                           (+10 lines)
    └─ _renderExerciseLogRow: optional inline "🔄 Substituted" pill

No changes:
  js/exercisePicker.js          (reused as-is from F5)
  js/exerciseInstructions.js    (reused as-is from F5)
  js/exerciseLibrary.js         (read-only consumer)
  js/notificationsService.js    (inbox unchanged)
  js/auth.js                    (write-gate unchanged)
  js/subscriptionService.js     (unchanged)
  js/progressionEngine.js       (unchanged — view does the work)
  js/dashboard.js               (no new loaders, no new sections)
  app.html                      (no new sections, no new modals — uses existing inbox + new in-modal UI)
  supabase/migrations/20260602_progression_engine.sql  (formula v1.0 unchanged)
```

**Total: 1 migration + ~131 JS lines spread across 3 existing modules. No new modules. No new HTML sections. No new modals.**

---

## 12 · Approval checklist

Before any code is written, the user confirms:

- [ ] Architecture preview (this document) is approved as-is OR with marked changes
- [ ] Q1 (Recovery penalty) — chosen option
- [ ] Q2 (Republish behavior) — chosen option
- [ ] Q3 (Original-name visibility) — chosen option
- [ ] Q4 (Order vs. PRODUCT_AUDIT sweep) — chosen option
- [ ] Confirm the locked architectural rules from `PROJECT_STATUS.md §1.2` are still binding (write-gate via `Auth.canWrite()`, notify-via-RPC only, no in-place formula edits)
- [ ] Confirm scope: F6 ships in a single feature commit (architecture + migration + JS + verification) — not interleaved with anything else

On approval, the implementation plan is:

1. Apply migration via `apply_migration` (not `execute_sql`).
2. Run the §8.2 verification SQL via MCP.
3. Write the JS changes in 3 small commits (migration / altExerciseRequest / programPublish + workoutSession) OR one tight commit — user choice.
4. Run the §8.3 end-to-end check in `app.html`.
5. Update `FEATURE_STATUS.md` (mark F6 ✅ live), `PROJECT_STATUS.md` (add migration to inventory), `NEXT_STEPS.md` (promote F7 to next).
6. Stop. Await signoff.

---

## STOP

No code will be written until the user approves this architecture and answers Q1–Q4.
