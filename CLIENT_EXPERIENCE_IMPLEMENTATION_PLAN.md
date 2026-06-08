# CLIENT_EXPERIENCE_IMPLEMENTATION_PLAN.md

**Not Feature 8.** A refinement pass on the Client Mobile Redesign.
**Type:** plan + recommendation **before** implementation. No code written yet (per "Final recommendation before implementation"; item 4 awaits approval).
**Branch:** `claude/interesting-buck-452459` · **HEAD:** `f453382`
**Companion analysis:** `CLIENT_EXPERIENCE_IMPROVEMENTS.md` (deep per-item analysis + evidence). This document is the actionable plan.
**Ground rules honored:** presentation-layer first; reuse existing data models; no new backend architecture unless required.

---

## 0. Phasing overview (one commit per phase, verify each)

| Phase | Covers | Backend? | Effort | Gate |
|---|---|---|---|---|
| **CX0 — Client correctness gates** | Item 2 (case-study create) + Item 3 (no coach picker) + Item 5 (hide coach tabs) | No (UI gating) | S | Required before merge |
| **CX1 — Program / Workout day-based redesign** | Item 1 (+ Item 6 for Program/Workout) | No | M–L | After CX0 |
| **CX2 — Community lifecycle + client focus** | Item 5 (+ Item 6 for Community) | No | S–M | After CX1 |
| **CX3 — Client ↔ assigned-coach messaging** | Item 3 full (+ Item 6 for Coach) | No (reuse `messages`); optional RLS | M–L | After CX2 |
| **Item 4 — Referral model** | Recommendation only | — | — | Decision pending (no build) |
| *(optional)* **CX4 — RLS hardening** | Item 2/3 defense-in-depth | Yes (migrations) | S–M | Independent track |

Recommended sequence: **CX0 → CX1 → CX2 → (merge to main) → CX3**, with item 4 and CX4 scheduled separately. Mobile UX (item 6) is applied *within* each phase, not as a separate phase.

---

## 1. Item analyses + per-item plan

### Item 1 — Program / Workout day-based redesign  (Phase CX1)

**Analysis.** `programPublish.renderClientProgram` renders all workouts + all warm-up/main/cool-down exercises stacked, notes always visible (one long page two reveals deep in Train). Data already supports days: `program.workouts[]`, `program.schedule[]`, `days_per_week`. Completion/duration are derivable from `workout_sessions` (`workout_key`, `status`, `started_at`/`ended_at`, `duration_seconds`). **Presentation-layer only.**

**Plan (3 views, master → detail → execution):**
1. **Program Overview** = list of **Day cards** (one per `schedule[]` entry). Each card: day name + workout title (`workout.label`), exercise count (warmup+main+cooldown length), **estimated duration** (history-aware: avg `duration_seconds` of finished sessions for that `workout_key`; else heuristic Σ sets×(work+rest) or `count×4min`), **completion state** (badge from latest `workout_sessions` for that key+today: Not started / In progress / Done). **No exercise list here.**
2. **Day Detail** = workout title + short description + **Start Workout** CTA, then the exercise list as **compact cards**.
3. **Compact exercise card.** Visible: name, sets, reps, rest. Collapsed behind "Show details": long coaching notes, descriptions, instructions, media. (Reuse `ClientUtil.disclosure` — to be promoted from QA §5 S-1.) Keep F5 media + F6 ⇄ alt-request inside the expanded area.
4. **Guided execution.** Start Workout → focused **one-exercise-at-a-time** flow with **Previous / Next** + progress indicator ("Exercise 3 of 8"); the whole workout is not shown at once. Reuse `WorkoutSession.mountWorkouts` as the logging/session engine behind each step (Start/Finish + per-exercise log already exist).

**Routing.** Lives inside the existing **Train** tab (replaces the stacked "Your full plan" reveal with the day list → day detail → execution). No new top-level nav; optional `{openDay}` param.

**Reuse:** `ProgramPublish` (data resolution: workouts, schedule, libMap, F6 substitutions); `WorkoutSession.mountWorkouts` (execution + logging + active-session state + duration); `workout_sessions` (completion/duration); `ExerciseInstructions`/`AltExercise` (inside cards); `ClientUtil` (disclosure/skeleton/offline/esc). **No new data model.**

**Permission changes:** none.

**Risk:** **Medium** — largest visible change; must preserve F2 logging, F5 media, F6 alt-request inside the new structure; the existing `renderClientProgram` is also used as the standalone `#section-my-program` (now hidden in nav but kept) — verify both, or have the day-view supersede it. **Effort:** **M–L.**

**Verification:** node --check + build; F2 start/finish + log a set; F5 video opens; F6 alt-request still submits; day completion badges reflect `workout_sessions`; coach Programs/publish untouched.

---

### Item 2 — Case Studies permissions  (Phase CX0, + optional CX4)

**Analysis.** `renderCaseShares` shows an **ungated** "+ Share Case" button + submit modal. RLS: `case_shares` INSERT `WITH CHECK (auth.uid()=coach_id)` (no role check) → clients can create pending cases; publish/approve already `is_admin()`-only; visibility already approved-only.

**Plan.**
- **CX0 (UI, required):** wrap the "+ Share Case" button + submit modal so they render only when `Auth.isAdminOrCoach()`. Clients keep **read / browse / search** of approved case studies (via the existing `case-studies` showcase section reached from More → Resources). Remove all create/edit/submit actions from client surfaces.
- **CX4 (RLS, optional defense-in-depth):** migration tightening `case_shares` INSERT to `WITH CHECK (auth.uid()=coach_id AND is_admin_or_coach())`.

**Reuse:** existing role gating (`Auth.isAdminOrCoach`), existing showcase for client read. **Risk:** Low. **Effort:** UI **S**; RLS **S–M**.
**Permission changes:** UI gating (no backend); optional RLS migration (CX4).

---

### Item 3 — Client messaging to assigned coach  (CX0 hide now; CX3 full build)

**Analysis.** `renderMessaging` is coach-shaped: "+ New" → coach `<select>` from `loadOtherCoaches`. `messages` is direct user↔user (`sender_id`/`receiver_id`; INSERT check `sender_id=auth.uid()`, SELECT own). `profiles.assigned_coach` is on the client's own (readable) row. The redesign Coach tab currently uses **mailto**. **Data layer already supports client→assigned_coach; only the UI is wrong.**

**Plan.**
- **CX0 (required):** hide the coach-oriented Community **Messages** + **Referrals** tabs from clients (role-gate the tab buttons). This removes the coach-picker path immediately; clients keep the mailto "Contact Coach" as the interim.
- **CX3 (target):** Coach tab opens a **direct thread with `assigned_coach`** — no selector, no directory, no multi-coach:
  - Resolve `receiverId = Auth.getProfile().assigned_coach`; render "My Coach" (name + avatar/monogram) + thread; reuse `Community.openConversation/loadMessages/sendMessage/subscribeToMessages` targeted at `receiverId`. Never call `loadOtherCoaches`.
  - If a coach is not yet assigned, fall back to the current mailto/"Contact Coach".
  - Coach name/avatar caveat: RLS lets a client read only their own profile row; use `profiles.coach_name` (already on the client row) or, if a readable source is needed, a tiny RPC/`assigned_coach`-scoped policy — **only if required** (prefer reusing `coach_name`).
- **CX4 (optional RLS):** restrict client `messages` INSERT so `receiver_id = sender's assigned_coach`.

**Reuse:** `messages` table + `Community` messaging fns; `ClientUtil`; the Coach tab shell. **Risk:** CX0 hide Low (S); CX3 Medium (new client thread UI + realtime + unread). **Effort:** hide **S**; full **M–L**.
**Permission changes:** CX0 UI only; CX3 optional RLS targeting.

---

### Item 4 — Referrals architecture (review only — DO NOT IMPLEMENT)

**Recommendation: Hybrid (D), led by Option A (client → clients).** Current system is coach→coach **clinical hand-off** (`from_coach_id`/`to_coach_id`), not growth. Best business + growth + UX is a **client→client** referral (lowest CAC, natural word-of-mouth, simple "invite a friend" UX); keep the existing coach→coach flow as a **separate** supply-side program (rename to "Clinical Referral"). Reject Option C (client→coaches: misaligned intent). Build later as a new feature (referral codes/attribution + reward rules) → Feature 8+. **No implementation now; awaiting your approval of the model.**

---

### Item 5 — Community lifecycle + client focus  (Phase CX2)

**Analysis.** Root cause confirmed: no `community` loader in `dashboard.js`; `initCommunitySection()` is exported but **never called**; panels render only on tab **click** (`app.html` L2388–2410) → empty on first open. Community tabs are not role-gated → clients see coach-oriented tabs.

**Plan.**
- **Lifecycle:** add a `community` loader in `showSection` that calls `CommunityUI.initCommunitySection()`; make `initCommunitySection()` render the **currently-active** tab and pick a **role-appropriate default** (client → Client Feed; coach/admin → Messages); guard against double-render on revisit. → loads on first open, correct tab immediately, no refresh/navigation workaround.
- **Client focus (tab gating):** for clients, show only client-appropriate tabs and hide coach-oriented ones:
  | Tab | Client | Action |
  |---|---|---|
  | Messages (coach picker) | hide | gated in CX0/CX3 |
  | Referrals (coach→coach) | hide | gated in CX0 |
  | Case Studies (create board) | hide create (browse via showcase) | CX0 |
  | Client Feed | keep | client can post (`canPost` already includes client) |
  | Support Groups | keep (join; create already coach/admin-gated) | — |
  | Privacy | keep (client's own settings) | — |

**Reuse:** `CommunityUI.initCommunitySection` (already exists, just wire it), existing render fns, `showSection` loader pattern. **Risk:** Low (additive wiring + role gating). **Effort:** **S–M.**
**Permission changes:** UI tab gating only; no backend.

---

### Item 6 — Mobile UX audit (applied within CX1–CX3)

Apply per phase, not separately:
- **Program/Workout (CX1):** collapse notes/descriptions; compact cards; one-exercise execution to kill scrolling; 44px targets; one-handed reach for Prev/Next/Start.
- **Community (CX2):** fewer tabs for clients; populated default tab; reduce dense coach copy.
- **Coach (CX3):** "My Coach" thread is single-purpose; large send target; safe-area input.
- Cross-cutting: progressive disclosure everywhere; trim copy; reuse `ClientUtil.skeleton`/`offlineNote`; respect reduced-motion (already in place).

---

## 2. Risk assessment (summary)

| Phase | Risk | Main hazards | Mitigation |
|---|---|---|---|
| CX0 | Low | Over-hiding (gate a coach path too) | Gate by `role`/`isAdminOrCoach`; verify coach/admin still see everything |
| CX1 | Medium | Breaking F2/F5/F6 inside new cards; dual use of `renderClientProgram` (also `#section-my-program`) | Reuse `mountWorkouts` as-is; regression-test logging/media/alt-request; decide whether day-view supersedes the legacy standalone render |
| CX2 | Low | Double-render on revisit; wrong default tab | Idempotent init; role-based default |
| CX3 | Medium | Coach name/avatar RLS; realtime/unread correctness | Prefer `profiles.coach_name`; reuse existing `messages` + subscribe; mailto fallback |
| CX4 (opt) | Low–Med | RLS over-restriction | Test client send to assigned coach + coach reply |

All phases are presentation-layer except optional CX4 (RLS migrations). No new backend architecture is required for CX0–CX3.

---

## 3. Reuse opportunities (no new data models)

- **Data:** `client_programs.program` (`workouts[]`/`schedule[]`/`days_per_week`), `workout_sessions` (completion + duration), `messages` (+ `assigned_coach`/`coach_name`), `case_shares`, community tables — all existing.
- **Modules:** `ProgramPublish` (resolution + F6 substitutions), `WorkoutSession.mountWorkouts` (execution/logging), `ExerciseInstructions`, `AltExercise`, `Community` (messaging/feed), `CommunityUI.initCommunitySection`, `ClientUtil` (esc/skeleton/offline/disclosure-to-be), `Auth` role helpers.
- **Patterns:** `showSection` loader; `ClientUtil.disclosure` (promote S-1 once, reuse in CX1 cards + existing Progress disclosures).

---

## 4. Required permission changes

- **CX0 (required, UI only):** gate case-study create to coach/admin; hide coach-oriented community tabs (Messages, Referrals) from clients. No backend.
- **CX3 (UI; optional backend):** client messaging targets `assigned_coach` only (UI). Optional RLS to enforce client `messages.receiver_id = assigned_coach`.
- **CX4 (optional, backend):** `case_shares` INSERT → coach/admin; (with CX3) messages receiver restriction. Migrations only; no new architecture.
- Everything else: **no permission changes.**

---

## 5. FINAL RECOMMENDATION (before implementation)

1. **Approve CX0 first** — the small, required client correctness gates (case-study create hidden; coach-picker/Referrals hidden for clients). One commit, presentation-only.
2. **Then CX1** — the Program/Workout day-based redesign (the highest-value UX win), as its own phase/commit, reusing `WorkoutSession`.
3. **Then CX2** — community lifecycle fix + client tab focus.
4. **Merge to `main`** at an approved checkpoint (after CX0, or after CX0–CX2 for a fully polished first deploy — your call).
5. **Then CX3** — direct client↔assigned-coach messaging (replaces mailto).
6. **Item 4 (referrals):** approve the **Hybrid/Option-A** model before any build; it is Feature-8-class and not part of this pass.
7. **CX4 (RLS hardening):** optional, separate track; recommended but not required for the UX goals.

**No code has been written.** Recommend starting with **CX0** on your go-ahead ("Approved, proceed with CX0"), one phase at a time, verifying after each. Feature 8 remains not started.
