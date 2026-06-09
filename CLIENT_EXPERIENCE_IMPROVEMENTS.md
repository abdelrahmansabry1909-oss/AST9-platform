# CLIENT_EXPERIENCE_IMPROVEMENTS.md

**Type:** Design + architecture review. **Analysis only** — no code changed, nothing committed/deployed, no Feature 8 work. This document is the only output.
**Date:** 2026-06-06 · **Branch:** `claude/interesting-buck-452459` · **HEAD:** `f453382`
**Evidence:** static source trace + live Supabase RLS probe (read-only). File:line and RLS references are cited per item.

**Effort key:** S ≤ ½ day · M ≈ 1–2 days · L ≈ multi-day. **Risk:** likelihood × blast radius of the *change*.

---

## 1. Program / Workout Experience — HIGH PRIORITY

**Current behavior** (`js/programPublish.js` → `renderClientProgram`, ~L481–709)
- One big "Your Training Program" card. A row of schedule chips ("Day 1 · Workout A", …), then **every distinct workout is rendered stacked vertically**; within each workout, **all** Warm-Up / Main / Cool-Down exercises are listed via `_roExerciseRow` (number + thumb + name + **always-visible notes** + Preview/Instructions buttons + sets/reps).
- No day-level navigation; the client scrolls one long page. Descriptions/notes are never collapsed. `WorkoutSession.mountWorkouts` adds Start/Finish + per-exercise logging inline at the bottom of each workout.
- Reached two reveals deep: Train → "Your full plan".

**Desired behavior:** day list → tap a day → that day's workout screen (Start Workout, exercise list, progress, prev/next), with compact, expand-on-demand exercise cards.

**Gap analysis**
- The data model **already supports days**: `program.workouts[]` (each `{id,label,warmup,main,cooldown}`) + `program.schedule[]` (day→workout id) + `days_per_week`. So **no backend/schema change is needed** — this is a pure presentation rebuild.
- Missing today: (a) a day-list index view; (b) per-day metadata (exercise count, est. duration, completion status); (c) compact collapsible exercise cards; (d) a focused in-session mode.
- Completion status source already exists (`workout_sessions` / `workout_exercise_logs` from F2) and daily routine logs.

**Recommended architecture**
- **Pattern: master → detail (list → drill-in)**, the canonical mobile pattern.
  1. **Day list (index):** vertical list of **Day cards**, one per `schedule[]` entry. Each card: day name (e.g. "Day 1 · Lower Body" from `workout.label`), exercise count (sum of warmup+main+cooldown), **estimated duration** (derive client-side: Σ sets × (work + rest); fall back to ~`exercises × 4 min`), and **completion status** (badge: Not started / In progress / Done today — from `workout_sessions` for that workout key + date).
  2. **Day workout screen:** header (day name + meta) → **Start Workout** CTA → **exercise list** (compact cards) → progress indicator (e.g. "3 / 8 done").
- **Exercise card (compact):** thumbnail (small) + **title prominent** + prescription inline (sets × reps · rest); **description / coach notes / instructions collapsed** behind a chevron (`ClientUtil.disclosure` from QA §5 S-1); media (video) opens inline within the expanded card or a focused player. Removes the always-on notes + button row that causes today's vertical bloat.
- **Step-by-step vs full-list → HYBRID (recommended):**
  - **Full-list (default, "planning" view):** the compact card list above — lets the client preview the whole day, scannable, minimal scroll because cards are collapsed.
  - **Step-by-step ("execution" view):** tapping **Start Workout** enters a focused one-exercise-at-a-time flow with **Previous / Next**, a progress bar, the current exercise's media + prescription, and a per-exercise "log set" tying into the existing `WorkoutSession` logging. This minimizes scrolling during the actual session and keeps focus.
  - Rationale: overview needs a list; doing the workout needs focus. One mode for each, switched by Start Workout. Reuse `WorkoutSession.mountWorkouts` as the logging engine behind the step view rather than rebuilding it.
- **Information hierarchy:** Program → **Day** → **Workout** → **Exercise** (title > prescription > [expand: description/media]). Days are the primary objects the client navigates.
- **Routing:** add this as a sub-view inside the existing **Train** tab (Train already owns "Your full plan"); replace the stacked render with the day list. No new top-level nav. Optional deep param to open a specific day.

**Risk:** Medium (largest visible client change; touches `renderClientProgram` + `WorkoutSession` integration; must preserve F2 logging + F5 media + F6 alt-request inside the new cards).
**Effort:** **M–L** (real screen rebuild; presentation-layer only).
**Should fix before merge?** **No** — current experience is functional and lives on a secondary surface (Train → full plan). It is the **#1 fast-follow**. Pull pre-merge only if a strong first-impression on the program is required.

---

## 2. Case Studies permissions

**Current behavior**
- UI: `communityUI.js` `renderCaseShares` (L380) renders a **"+ Share Case"** button + submit modal with **no role gate** — any viewer of the Community → Case Studies tab sees it. Copy targets coaches ("help fellow coaches learn"), and submissions go to admin review.
- RLS (live): `case_shares` **INSERT** `WITH CHECK (auth.uid() = coach_id)` — **no role check**, so a client can insert a (pending) case with `coach_id = self`. **SELECT** requires `status='approved' OR owner OR admin`. **UPDATE** (approve/publish) is `is_admin()` only.
- Community tabs are not role-gated, so a client reaching More → Community sees the Case Studies tab.

**Desired behavior:** Coaches/Admins create/edit/publish; clients **read-only**.

**Gap analysis**
- **Create:** clients **can** create (ungated button + permissive INSERT). This is the real gap.
- **Publish:** already correctly admin-only (RLS UPDATE = `is_admin()`); approved-only visibility is enforced. So "publish" is safe today.
- Severity is **Low** (created cases are pending and never auto-visible; worst case = junk in the admin queue), but it is an explicit product-correctness violation.

**Recommended architecture**
- **UI (presentation):** gate the "+ Share Case" button + submit modal behind `Auth.isAdminOrCoach()`. Clients keep **read-only** access to approved cases (or hide the tab entirely for clients — see item 6/community gating).
- **RLS (defense-in-depth, backend):** tighten `case_shares` INSERT to `WITH CHECK (auth.uid() = coach_id AND is_admin_or_coach())` via migration. Independent of the redesign branch.

**Risk:** Low (UI gate is additive; RLS tightening is a small migration). **Effort:** UI **S**; RLS **S–M**.
**Should fix before merge?** **Yes** for the UI gate (trivial; removes an obviously-wrong client path). RLS hardening: After Merge.

---

## 3. Coach Messaging restrictions

**Current behavior**
- `communityUI.js` `renderMessaging` (L56): a coach-oriented thread UI. "+ New" opens a modal with a **coach `<select>`** ("Send to Coach — Select Coach —") populated by `Community.loadOtherCoaches()`; empty states say "another coach"/"Choose a coach". So a client on Community → Messages who taps "+ New" gets a **coach picker** (the reported issue).
- Data layer: `messages` is direct user↔user (`sender_id`, `receiver_id`); RLS INSERT `WITH CHECK (sender_id = auth.uid())` (any receiver), SELECT = own (sender/receiver). So **client→assigned_coach is fully supported by the schema**; only the UI is coach-shaped.
- The redesign's **Coach tab** "Contact your coach" currently uses a **mailto** (not this in-app system).
- `profiles.assigned_coach` (uuid) is on the client's own row and is client-readable.

**Desired behavior:** client communicates **only** with `profiles.assigned_coach`; no coach selection / directory / search; "Contact Coach" opens that one conversation directly.

**Gap analysis**
- No selector should ever be shown to a client. The schema already supports a direct thread; the work is UI + targeting.
- Two viable end-states: (a) keep mailto as the interim "Contact Coach" and simply remove the client's access to the coach-picker UI; (b) build a real in-app client↔assigned_coach thread on the existing `messages` table.

**Recommended architecture**
- **Immediate correctness (pre-merge, cheap):** hide the coach-oriented Community **Messages** (and Referrals) tabs from clients (role-gate the tab buttons). This removes the coach-picker path entirely. Clients keep the mailto "Contact Coach" on the Coach tab.
- **Target experience (post-merge / Feature 8):** make "Contact Coach" open an **in-app direct thread** with `assigned_coach`:
  - On tap, resolve `receiverId = Auth.getProfile().assigned_coach`; open the thread directly (reuse `openConversation(receiverId)` + `sendMessage(receiverId, …)`); **no selector, no `loadOtherCoaches`**.
  - Coach side already supports the inverse thread (they message the client back).
  - Optional RLS hardening: restrict client INSERTs so `receiver_id` must equal the sender's `assigned_coach` (policy referencing `profiles`). Defense-in-depth; not required for the product behavior.
- **Does the existing implementation already support direct assignment?** **Yes at the data layer** (direct `messages` + readable `assigned_coach`); **no at the UI layer** (it shows a coach picker). So this is mostly a UI/targeting change, optionally plus an RLS tightening.

**Risk:** Pre-merge tab hide = Low (S). In-app direct messaging = Medium (M — new client UI, realtime, unread counts). **Effort:** hide **S**; full in-app **M–L**.
**Should fix before merge?** **Partial — Yes** to hide the coach-picker path for clients (cheap correctness); **No** for the full in-app direct thread (post-merge/F8).

---

## 4. Referral system strategy

**Current behavior:** `communityUI.js` `renderReferrals` + `Community.loadReferrals` — referrals are **coach → coach clinical hand-offs** (`from_coach_id`, `to_coach_id`; client options filtered to the coach's own clients via `assigned_coach`). It is **not** a growth/acquisition referral and is not a client feature. The Referrals tab is currently (incorrectly) visible to clients but contains coach-only data.

**Desired:** evaluate A (client→clients), B (coach→coaches), C (client→coaches), D (hybrid) and recommend.

**Evaluation**
| Model | Business | Growth | UX | Verdict |
|---|---|---|---|---|
| **A — client refers clients** | Lowest CAC; rehab clients trust peers; recurring-revenue clients are the volume segment | Strong viral loop (word-of-mouth is how rehab/coaching spreads) | Simple: share a link/code from the client app | **Best primary engine** |
| **B — coach refers coaches** | Grows *supply* (capacity), not demand; useful once client demand exists | Slow, professional network | Coach-only | Useful **secondary** (supply-side) |
| **C — client refers coaches** | Misaligned — clients rarely know coaches to recruit; weak intent | Weak | Confusing for a client | **Not recommended** |
| **D — hybrid (A + B)** | Demand engine (A) + supply safety valve (B), kept as **separate** programs | Best overall | Each audience sees only its own program | **Recommended end-state** |

**Recommendation:** **Hybrid (D), led by Option A.** Build the **client→client** referral first (it is the demand engine and the best UX), and keep the existing **coach→coach** flow as the separate supply-side program (rename it "Clinical Referral" to avoid confusion with growth). Do **not** pursue C. Concretely: a client-facing "Invite a friend" with a referral code/link + attribution on signup; reward both sides (e.g. statement credit / free week) subject to business rules. This is a **new feature** (schema for referral codes/attribution + reward logic) → **Feature 8+**, not part of this redesign.

**Risk:** N/A (no current change). **Effort (when built):** **L** (new feature, schema + UI + reward rules).
**Should fix before merge?** **No** — strategy/new-feature; also, hide the coach-only Referrals tab from clients as part of the item-3 community gating.

---

## 5. Community performance (empty until you navigate away and back)

**Current behavior / root cause** (confirmed)
- There is **no `community` loader** in `js/dashboard.js` `showSection`, and `CommunityUI.initCommunitySection()` is **defined and exported but never called** (only a stale comment in `app.html` L1215 references it).
- Community panels render **only on tab click** (`app.html` L2388–2410 wires `.tab-btn` clicks → `renderMessaging/renderCaseShares/renderClientFeed/…`). On the **first** `showSection('community')`, the default-active panel (`comm-messaging`) is an empty `<div>` and nothing renders.
- Result: Community looks empty until the user **clicks a tab** (or navigates away and returns and then interacts). For clients it is worse — even if `initCommunitySection` were called, it only runs `renderClientFeed()` for non-coaches, while the **active** tab is Messages, so the visible panel stays blank.

**Is it a real bug or a race?** **A real lifecycle bug** (missing initial-render trigger), not a timing race and not a data problem.
**Severity:** **Medium** (section appears broken on first visit; pre-existing, affects all roles; secondary surface).

**Recommended architecture**
- Add a `community` entry to the `showSection` loaders that calls `CommunityUI.initCommunitySection()`; make `initCommunitySection()` **render the currently-active tab** (not just client feed) and **pick a role-appropriate default tab** (client → Client Feed; coach/admin → Messages). Guard against double-render on revisit.
- Pairs naturally with the item-2/3 community client-gating (hide coach-oriented tabs for clients), so the client's Community defaults to a populated, appropriate tab.

**Risk:** Low (small, additive wiring). **Effort:** **S**.
**Should fix before merge?** **No** (pre-existing, secondary), but it is a **cheap, high-value fast-follow** — recommend bundling with the community client-gating as the first post-merge community pass. Pull pre-merge if doing the community gating anyway.

---

## 6. Mobile UX audit (client)

**Screens still too dense / cards too large / excessive scrolling**
- **Program / workout (item 1)** — the single biggest density problem: every day + every exercise + inline notes stacked. *Critical UX fix.*
- **Community (client view)** — coach-oriented tabs (Messages picker, Referrals, Case-share create) shown to clients; dense and partly broken on first load (item 5). *Recommended fix (gate + lifecycle).*
- **Progress → Advanced insights** — dense (gauges + 3 charts) but already correctly behind progressive disclosure; acceptable. *Nice-to-have only.*

**Repeated information**
- Subscription state appears as the Today pill, the attention card, and (for lapsed) the CTA — intentional and consistent; not a problem.
- `my-graph` reachable via More + (desktop) sidebar — intended parity.

**Poor mobile interactions**
- Workout media/notes always expanded (item 1) → fix via collapse-on-demand.
- Community Messages textarea + coach picker on a small screen (item 3) → removed by gating.
- (Known, tracked) footer bell routes desktop clients to raw inbox (QA N-1 / Deploy L-1).

**Critical fixes:** item 1 (program/workout day-based redesign).
**Recommended improvements:** items 2 + 3 (community client gating) + item 5 (community lifecycle).
**Nice-to-have:** Progress advanced-panel chart compaction; the QA §5 `/simplify` helpers (S-1 disclosure, S-2 screenHeader, S-3 CSS utility classes); pause 3D under reduced-motion.

**Risk:** per underlying item. **Effort:** per underlying item.
**Should fix before merge?** **No** for the big rebuilds; the only pre-merge items are the cheap correctness gates (2 UI, 3 tab-hide).

---

## Per-item summary

| Item | Current | Desired | Risk | Effort | Fix before merge? |
|---|---|---|---|---|---|
| 1 Program/Workout day-based | All stacked, notes inline, no day nav | Day list → day screen → compact cards + hybrid step/list | Med | M–L | No (top fast-follow) |
| 2 Case study create gate (UI) | Ungated "+ Share Case" | Coach/admin only; client read-only | Low | S | **Yes (UI)** |
| 2 Case study INSERT RLS | `auth.uid()=coach_id` only | + `is_admin_or_coach()` | Low | S–M | No (after) |
| 3 Hide coach-picker for clients | Client sees coach selector | No selector/directory for clients | Low | S | **Yes (hide)** |
| 3 In-app direct client↔coach msg | mailto only | Direct thread to `assigned_coach` | Med | M–L | No (after/F8) |
| 4 Referral growth model | Coach→coach clinical only | Hybrid led by client→client | N/A | L | No (F8+) |
| 5 Community initial-render | Empty until tab click | Loader + render active tab + role default | Low | S | No (cheap fast-follow) |
| 6 Mobile density | See items 1/2/3/5 | — | — | — | No (except 2/3 gates) |

---

## FINAL RECOMMENDATION

### Must Fix Before Merge
*(cheap, presentation-only correctness — removes client-facing paths the product explicitly forbids)*
- **2-UI** — Gate the "+ Share Case" create button/modal behind `isAdminOrCoach()` (clients read-only). **S.**
- **3-hide** — Role-gate the coach-oriented Community tabs (Messages coach-picker, Referrals) so clients cannot reach the coach-selection flow. **S.**
> These two are one small `app.html`/`communityUI.js` gating change. They are the only items that should block the merge, and only because they are trivial and close obviously-wrong client paths.

### Fix Immediately After Merge
- **1** — Program/Workout **day-based mobile redesign** (master→detail + compact collapsible cards + hybrid full-list/step-by-step). The top UX win; presentation-only; reuse `WorkoutSession`. **M–L.**
- **5** — Community **initial-render lifecycle** fix (+ role-appropriate default tab). **S.**
- **2-RLS** — tighten `case_shares` INSERT to coach/admin (migration). **S–M.**

### Can Wait For Feature 8+
- **3-full** — real in-app **client↔assigned_coach** direct messaging (replace mailto), optional RLS targeting. **M–L.**
- **4** — **Referral growth program** (hybrid, client→client first; rename coach→coach to "Clinical Referral"). New feature + schema. **L.**
- **6-nice** — Progress chart compaction; `/simplify` helpers; reduced-motion 3D pause.

**Net deployment guidance:** the redesign remains **safe to merge** after the two small pre-merge gates (2-UI, 3-hide). Everything else is fast-follow or future feature work and does not block the merge. Recommended order after merge: **item 1 (program) → item 5 (community lifecycle) + items 2/3 community gating polish → 2-RLS**, then evaluate items 3-full and 4 as Feature-8-class work.
