# CX_REVIEW_REPORT.md

**Type:** Post-implementation review of CX0–CX3 + product recommendations. **Analysis only** — no code modified, nothing committed/deployed, no Feature 8 work. This document is the only output.
**Date:** 2026-06-08 · **Branch:** `claude/interesting-buck-452459` · **HEAD:** `f6bc41c`
**Method:** static source trace + production build + `dist/` inspection + git scope diff + live RLS facts already captured during CX0/CX3. All checks read-only.

**Commits under review**
| CX | Commit | Title | Files | +/− |
|----|--------|-------|-------|-----|
| CX0 | `47fabf7` | client correctness gates (case studies + community tabs) | 2 | +15/−6 |
| CX1 | `711b8f6` | day-based program & guided workout experience | 5 | +798/−133 |
| CX2 | `1270fc9` | community renders correct default tab on first open | 2 | +25/−7 |
| CX3 | `f6bc41c` | direct assigned-coach conversation on the Coach tab | 2 | +221/−26 |

---

## 1. Verification results

| Check | Result | Evidence |
|---|---|---|
| **Build succeeds** | ✅ PASS | `vite build` → `✓ built in 2.60s`; only the pre-existing 1.04 MB chunk-size + non-module `<script>` warnings (unchanged baseline). |
| **Dist contains all changes** | ✅ PASS | `dist/js/clientProgram.js` present; `dist/app.html` script tag (1); `resolveClientProgram` (3), `ClientProgram.render` in clientTrain (2); `'community'` loader + `initCommunitySection` (1/1); `defaultTab` (3); `loadLatestMessage` (3); `Open Conversation` (2); `canAuthor` (4); `comm-messaging`/`comm-referrals` role-gated (1/1). |
| **No coach/admin regressions** | ✅ PASS | Coach publish (`render`/`_draw`/`getProgram`) intact; coach messaging (`renderMessaging`/`openNewMsgModal`/`loadOtherCoaches`/`renderReferrals`) intact; `mountCoachView` intact. CX0 case-share gate keeps the create button for coaches (`canAuthor` true). |
| **No F1–F7 regressions** | ✅ PASS | F2 `workoutSession.js` **untouched** (no commits in range). F5/F6 resolution preserved — moved verbatim into shared `resolveClientProgram` (subMap overlay + libMap + name overwrite) and consumed by both the legacy and new renderers. F1 write-gate reused via `Auth.canWrite()` in CX1 execution. |
| **No broken routes** | ✅ PASS | Every `Dashboard.showSection('…')` nav target and every More-sheet `data-section` resolves to a loader and/or `#section-*`. CX2 added the previously-missing `community` loader. |
| **No orphaned code** | ⚠️ **1 found** | CX1 left `renderClientProgram` + `#section-my-program` + the client `WorkoutSession.mountWorkouts` tracker UI reachable **only** through `#nav-my-program` which is `style="display:none"`. See **F-1**. |
| **No duplicate implementations** | ✅ (minor) | Program resolution is unified (single `resolveClientProgram`). Messaging data layer is unified (`Community.*`). One small new presentational dup: message-bubble renderers. See **F-3**. |

**Overall verdict: CX0–CX3 are sound and production-safe.** No functional regressions, no broken routes, no duplicated logic. The only structural issue is one orphaned legacy path (F-1) and minor debt (F-2…F-5).

---

## 2. Findings by severity

### 🟠 High

**F-1 — Orphaned legacy program path (introduced by CX1).**
`js/dashboard.js:111` still wires `'my-program' → ProgramPublish.renderClientProgram('#my-program-host')`, but `#nav-my-program` (`app.html:214`) is `style="display:none"` and **nothing else navigates to `my-program`** (no More-sheet link, no CTA). Before CX1, `renderClientProgram` was reached via Train → "Your full plan"; CX1 repointed Train to `ClientProgram`, so the legacy stacked renderer, the `#section-my-program` markup, and (transitively) the client-side `WorkoutSession.mountWorkouts` full-list tracker UI are now **dead in normal navigation**.
- *Not a duplicate of logic* (it shares `resolveClientProgram`), but it is dead presentation + the only remaining client consumer of `mountWorkouts`'s in-page tracker.
- *Risk of leaving it:* confusion, drift, and a second program UI that can silently rot. *Risk of removing it:* low (single hidden caller).
- **Recommendation:** in a dedicated cleanup commit, delete `#section-my-program`, the `my-program` loader, `#nav-my-program`, and `renderClientProgram` (+ its nested `roSection`/`_roExerciseRow`/`_thumbHTML`). Keep `resolveClientProgram` (now the shared resolver) and `WorkoutSession.mountWorkouts` (F2 public API used by tests/coach docs). Do **not** bundle into CX work — it's a deliberate debt-paydown.

### 🟡 Medium

**F-2 — Community realtime subscriptions are never torn down (pre-existing; surfaced by the CX2 lifecycle fix).**
`communityUI.js` opens channels in `openConversation` (`L178 subscribeToMessages`) and `renderClientFeed` (`L619 subscribeToClientPosts`) but the **community tab flow never calls `unsubscribeMessages`/`unsubscribePosts`** on tab switch or re-open. Now that CX2 makes the section actually render on every open, switching tabs / reopening Community can stack channels.
- CX3's `clientCoach` thread *does* tear down (`unsubscribeMessages` on render/back) — so the client Coach tab is clean; the gap is the **coach/community** side.
- **Severity Medium** (slow channel growth in long coach sessions; not a crash). **Recommendation:** unsubscribe the prior channel at the top of each `render*` that subscribes (one-line guard, mirrors CX3). Backend-free.

**F-3 — Two message-bubble renderers (minor dup introduced by CX3).**
`clientCoach._bubble` (CX3) and `communityUI._msgBubble` are ~5-line functions that emit the same `.msg-bubble/.msg-text/.msg-time` markup; they differ only in time helper (`ClientUtil.ago` vs `_timeAgo`).
- **Recommendation:** acceptable as-is (different modules, client vs coach). If consolidating, expose a tiny `Community.renderBubble(m, uid)` and have both call it. Low priority.

### 🟢 Low / Info

**F-4 — `case_shares` INSERT RLS is role-permissive (defense-in-depth gap).**
CX0 correctly gates the "+ Share Case" UI behind `Auth.isAdminOrCoach()`, but the DB policy is still `INSERT WITH CHECK (auth.uid() = coach_id)` with **no role check**. A client calling the API directly could still insert a *pending* case (never auto-visible; SELECT requires `approved OR owner OR admin`). Product-correctness is satisfied in the UI; the backend is not hardened. **Out of scope now (no RLS changes).** Recommend the one-line migration `… AND is_admin_or_coach()` as a future hardening (already logged in `CLIENT_EXPERIENCE_IMPROVEMENTS.md` item 2-RLS).

**F-5 — `coach_messages` receiver is not RLS-restricted to the assigned coach (defense-in-depth gap).**
Policy is `auth.uid() = sender_id OR auth.uid() = receiver_id` (participants). CX3 restricts the client UI to `assigned_coach`, but a client calling the API directly could send to any user id. No data exposure (still scoped to participants). **Out of scope now.** Optional future tightening: client INSERT `WITH CHECK (receiver_id = (SELECT assigned_coach FROM profiles WHERE id = auth.uid()))`.

**F-6 — Per-day completion is keyed by `workout_key`, not by day index.**
CX1 marks a day "Completed" if a completed `workout_sessions` row exists for that workout id this week. If two schedule days reuse the same workout id, both show Completed once either is done. Honest given the current schema (sessions store `workout_key`, not day index). Precise per-day state needs a backend change → defer (see §9 Program recs).

**F-7 — `_ncOpenProgram` global flag (CX1 express path).** Uses the same `window._*` deep-link pattern as existing `_cpOpen`/`_wsPreselectClient`/`_notifParams`. Consistent, low-risk; noted for awareness (it's consumed-and-cleared in `clientTrain`).

---

## 3. Technical debt introduced (net)

| ID | Debt | Origin | Cost to carry | Cost to fix |
|----|------|--------|---------------|-------------|
| F-1 | Orphaned `renderClientProgram` + `my-program` + client `mountWorkouts` UI | CX1 | Two program UIs; rot risk | S (delete hidden path) |
| F-2 | No unsubscribe on community channels | pre-existing, surfaced by CX2 | Channel growth in long coach sessions | S |
| F-3 | Duplicate bubble renderer | CX3 | ~5 lines × 2 | XS |
| F-6 | Completion keyed by workout, not day | CX1 (schema limit) | Mild ambiguity on repeated workouts | M (needs schema) |

No debt added to F1–F7 features, coach/admin flows, schema, RLS, or the build pipeline.

---

## 4. Cleanup opportunities

1. **Remove the orphaned `my-program` path** (F-1) — biggest single cleanup; removes ~250 lines and a whole dead section.
2. **Add unsubscribe guards** to `communityUI` subscribing renderers (F-2).
3. **Optional:** unify the two message-bubble renderers (F-3).
4. **Pre-existing, not CX:** multiple private `esc()` and time-ago helpers across modules (`communityUI._timeAgo`, `ClientUtil.ago`, `workoutSession._fmtDuration`). Could converge on `ClientUtil`, but it spans coach modules too — leave unless a broader simplify pass is scheduled.

---

## 5. Components — merge vs keep separate

**Should be merged / consolidated**
- **`renderClientProgram` → delete in favor of `ClientProgram`** (F-1). The day-based view supersedes the stacked view; both already share `resolveClientProgram`, so only the dead presentation remains to remove.
- **Message-bubble rendering** (F-3) — optional single helper.

**Should remain separate (correctly)**
- **`ClientProgram` (client, day-based) vs `ProgramPublish` coach editor** — different audiences/altitudes; they correctly share only the data resolver. Keep separate.
- **`clientCoach` thread (client, nc-token mobile chat) vs `communityUI.renderMessaging` (coach two-pane inbox + picker)** — fundamentally different IA (one assigned thread vs multi-conversation directory). They correctly share only the `Community.*` data layer. Keep separate.
- **`resolveClientProgram` (data) vs the renderers (presentation)** — good separation; single source of truth for F5/F6.
- **`ClientProgram` guided execution (step UI) vs `WorkoutSession.mountWorkouts` (full-list tracker)** — guided builds on the F2 **data layer**, not the F2 UI, by design ("don't show the whole workout"). Keep separate; do not try to merge the two execution UIs.

---

## 6. Mobile UX issues still remaining

1. **No rest timer** in CX1 guided execution — the single biggest gap vs a "modern workout app" feel (see §9). 
2. **Completion feedback is light** — finish shows a 🎉 step + toast, then recomputes status on return; there's no immediate "Day ✓" stamp animation. 
3. **Community client panels are desktop-styled** — Case Studies / Support Groups / Privacy / Feed render in the legacy `.section` + `.tab-row` chrome (not the premium `--nc-*` client shell). They're functional and were de-risked by CX0/CX2 gating, but visually inconsistent with Today/Train/Progress/Coach. Cosmetic, not blocking.
4. **Day status "Today's Session" is a heuristic** (next-incomplete), not calendar-aware — fine for most, mildly confusing if a client trains days out of order.

## 7. Desktop UX inconsistencies still remaining

1. **Redesigned client screens are phone-width columns on desktop** (`max-width:520px` centered) — Today/Train/Progress/Coach **and now CX1/CX3** render as a narrow centered column on wide screens, while coach/admin screens are full desktop layouts. This is an intentional redesign decision (mobile-first client app), but it is a desktop inconsistency worth a conscious product call.
2. **Footer bell → raw inbox for desktop clients** (pre-existing, tracked as QA N-1 / Deploy L-1) — not a CX regression.
3. **Hidden `my-program` nav item** (F-1) lingers in the desktop sidebar markup (display:none) — remove with the F-1 cleanup.

---

## 8. Product recommendations (no code)

### 8A. Program Experience (review of CX1)

| Area | Current (CX1) | Recommendation | Priority |
|---|---|---|---|
| **Day cards** | Eyebrow "Day N" + workout title + count + est. duration + word-status; today's card teal-tinted | Keep. Add a small **focus tag** (e.g. "Lower body") derived from the dominant main exercise when `workout.label` is generic | Med |
| **Workout organization** | Warm-up/Main/Cool-down groups; >6 exercises collapses warm-up & cool-down | Keep. Consider collapsing **all** non-main groups whenever ≥1 group exists (consistency), not only when total >6 | Low |
| **Exercise cards** | Name + sets×reps + rest visible; notes/cues/media/alt behind "Show details" | Keep — this is the core density win. Add a **completed tick** per exercise once logged | Med |
| **Guided flow** | One-at-a-time, progress bar, Prev/Next, finish step | Keep. Add **set-by-set check-off** within an exercise before "Next" | Med |
| **Rest timer** | ❌ none | **Add an optional rest countdown** (presentation-only `setInterval`) after marking a set done, seeded from `exercise.rest`; skippable. Biggest perceived-quality gap | **High** |
| **Progress visibility** | "Exercise N of M" + bar | Add a **session summary** at finish (sets logged, volume, duration) | Med |
| **One-handed use** | Bottom CTAs, ≥44–54px targets | Good. Keep primary actions in the bottom third | — |
| **Completion feedback** | 🎉 finish step + toast + status recompute | Add an immediate **"Day ✓ Completed" stamp** on return to overview + streak nudge | Med |

**Specific assessments asked for**
- **Day 1/2/3 naming — adequate, not pure.** CX1 already renders **"Day N" as an eyebrow + the workout title as the headline** (e.g. *Day 1 · Lower Body Strength*), which is the right hybrid. Pure "Day 1/2/3" alone would be too generic. **Weak spot:** when a coach leaves `workout.label` blank it falls back to "Workout A". **Recommend:** derive a focus label from the main lift when `label` is missing.
- **Workout descriptions — not too long now.** Default is a short synthesized line ("A guided N-exercise session…"). **Risk:** a coach-authored `description` is shown in full (uncapped). **Recommend:** clamp the day-detail description to ~2 lines with an expand.
- **Exercise details behind expanders — yes, correct.** Keep notes/cues/long descriptions/media/alternatives behind "Show details"; keep name/sets/reps/rest always visible. No change.
- **Estimated duration — accurate enough, improving over time.** Priority chain is right (historical avg → program-defined → computed `sets×~1.5min` → `20–30 min` fallback) and never shows 0/Unknown. Early-on the computed estimate is coarse. **Recommend:** light per-modality weighting later (e.g. mobility vs strength) once data exists; not urgent.
- **Completion states — clear, with one caveat.** Word badges (Completed / In Progress / Today's Session / Upcoming) are good. Caveat F-6: completion is keyed by `workout_key`, so repeated workouts share state. **Recommend:** if precise per-day completion matters, add a nullable `day_index`/`schedule_slot` to `workout_sessions` (backend; defer).

### 8B. Client permissions — verification & gaps

| Requirement | UI enforced? | Backend (RLS) enforced? | Verdict |
|---|---|---|---|
| Clients **cannot create** case studies | ✅ CX0 gates button+modal behind `isAdminOrCoach()`; `openCaseShareModal`/`submitCaseShare` guarded | ⚠️ **No** — `case_shares` INSERT = `auth.uid()=coach_id` only (F-4) | **UI-correct; backend gap** |
| Clients **can only view** case studies | ✅ read-only browse | ✅ SELECT = `approved OR owner OR admin` | **PASS** |
| Clients **cannot choose** coaches | ✅ CX3 removed picker; Community Messages/Referrals tabs hidden (CX0); Coach tab targets `assigned_coach` | ✅ n/a (no selection surface) | **PASS** |
| Clients **only communicate with assigned coach** | ✅ CX3 sends to `assigned_coach` only | ⚠️ **No** — `coach_messages` allows any receiver among participants (F-5) | **UI-correct; backend gap** |
| Clients **cannot access coach referral workflows** | ✅ Referrals tab is `role-coach-admin` (hidden); not in client default | ✅ referral rows are coach-scoped | **PASS** |

**Gaps:** F-4 and F-5 are **defense-in-depth backend gaps only** — every client-facing UI path is correctly closed. Because this pass forbids RLS changes, they remain recommendations (small migrations) for a future hardening pass.

### 8C. Referrals architecture review (recommendation only — do not implement)

| Option | Growth impact | User experience | Operational complexity | Abuse risk | Revenue potential |
|---|---|---|---|---|---|
| **A — client → client** | **Highest.** Rehab/coaching spreads by peer word-of-mouth; clients are the volume segment → strongest viral loop, lowest CAC | **Simplest.** "Invite a friend" link/code from the client app; both sides rewarded | **Medium.** Needs referral codes, signup attribution, reward ledger, fraud checks | **Medium.** Self-referrals / fake signups for rewards → needs verified-conversion gating | **High** (new paying clients = recurring revenue) |
| **B — coach → coach** | **Low-moderate.** Grows *supply/capacity*, not demand; matters only once demand exists | Coach-only; professional | **Low-Medium.** This already exists as the clinical hand-off flow (`from_coach_id`/`to_coach_id`) | **Low** (small, trusted, professional network) | **Indirect** (capacity to serve more clients) |
| **C — client → coach** | **Weak.** Clients rarely know coaches to recruit; intent mismatch | **Confusing** for a client | **Medium** | **Low-Medium** | **Low** |
| **D — hybrid (A + B, separate programs)** | **Best overall** — demand engine (A) + supply valve (B) | Each audience sees only its own program; no confusion | **Higher** (two programs, two reward models) but B already exists | Managed per-program | **Highest** combined |

**Final recommendation: Option D (Hybrid), led by Option A.**
- Build **client → client ("Invite a friend")** first — it is the demand engine, the best UX, and the highest revenue lever. Mechanics: per-client referral code/link → attribution on new-client signup → two-sided reward (e.g. free week / statement credit) gated on a **verified conversion** (completed signup + first paid period) to contain abuse.
- Keep the existing **coach → coach** flow as a **separate, renamed "Clinical Referral"** program (supply side) to remove the current naming confusion with growth referrals.
- **Do not build Option C.** Drop it.
- Classification: this is **new feature work (schema for codes/attribution/rewards + UI + fraud rules)** → **Feature 8+**, not a CX refinement. Reaffirms the recommendation already in `CLIENT_EXPERIENCE_IMPROVEMENTS.md` §4 with the added 5-dimension breakdown above.

### 8D. Community review — remaining lag / rendering

**Initial load:** ✅ Fixed by CX2. `showSection('community')` → `community` loader → `initCommunitySection()` activates the role-correct default tab and renders **only that panel** (client → Feed, coach/admin → Messages). No blank-first-view, no duplicate render. Verified in `dist`.

**Root causes of any *remaining* perceived lag (and fixes):**
1. **Realtime channel churn (F-2).** Tabs/threads subscribe but don't unsubscribe → channels accumulate across opens/switches; the realtime client does more work over time. **Fix:** unsubscribe at the top of each subscribing render (1 line each). *Primary remaining issue.*
2. **No fetch memoization.** Every tab click and every section re-open re-fetches from Supabase (e.g. `renderClientFeed`, `renderCaseShares`). For a calm UX, cache the last result per tab for a short TTL (or only refetch on explicit pull-to-refresh). **Fix:** small in-module cache keyed by tab; optional.
3. **Coach `loadConversations` fetches *all* messages then groups client-side** (`community.js:22`). Fine at small scale; O(n) growth for heavy coaches. **Fix (later):** server-side latest-per-conversation (view/RPC) — backend, defer.
4. **`initCommunitySection` runs on every open** and re-renders the default tab each time. Acceptable (cheap), but combined with (1)/(2) it repeats network work. Lowest priority.

**Net:** the *correctness* lag (empty-until-navigate) is resolved. The remaining items are **efficiency polish**, led by the unsubscribe fix (F-2). All are presentation/data-layer — **no schema/RLS changes**.

---

## 9. Prioritized next steps (all optional; none block)

**Cleanup (debt paydown, presentation-only)**
1. **F-1** — delete the orphaned `my-program` path (`renderClientProgram` + `#section-my-program` + `#nav-my-program`). *S.*
2. **F-2** — add unsubscribe guards to community subscribing renderers. *S.*
3. **F-3** — (optional) unify message-bubble renderer. *XS.*

**Program polish (CX1 fast-follows)**
4. **Rest timer** in guided execution. *S–M, High value.*
5. Completion stamp + session summary + per-set check-off. *M.*
6. Description 2-line clamp + focus-label fallback for missing `workout.label`. *S.*

**Backend hardening (separate migration pass — not in this branch's scope)**
7. **F-4** `case_shares` INSERT `+ is_admin_or_coach()`. *S.*
8. **F-5** `coach_messages` receiver = sender's `assigned_coach`. *S–M.*
9. **F-6** per-day completion (`day_index` on `workout_sessions`). *M.*

**Future feature**
10. Referrals **Hybrid (A-led)** — Feature 8+ (schema + UI + reward/fraud rules).

---

### Bottom line
CX0–CX3 are **clean, regression-free, and production-safe**: build green, dist verified, F1–F7 and coach/admin untouched, routes intact, logic de-duplicated. The only structural item is the **F-1 orphaned legacy program path** (a deliberate cleanup, not a bug). Everything else is efficiency polish (F-2), tiny dup (F-3), or backend defense-in-depth (F-4/F-5) that the current scope intentionally defers. Top recommended next move: **F-1 cleanup + the rest-timer program polish**, with **referrals (Hybrid, A-led)** reserved for Feature 8.
