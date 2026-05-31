# PRODUCT_AUDIT.md — NeuCore Platform

**Audit date:** 2026-05-31
**Branch:** `claude/interesting-buck-452459` · HEAD `4d907a7`
**Auditor:** Claude (session continuation post-compaction)
**Inputs:** PROJECT_STATUS.md · FEATURE_STATUS.md · NEXT_STEPS.md · live source scan of `app.html` + 7 JS modules + `supabase/migrations/*`

This is an **architecture-level review + product audit done from the perspective of each role walking every workflow.** Findings are grounded in the actual current code (file + line cited where relevant), not in the handoff doc claims.

---

## ⚡ Status as of 2026-05-31 post-Reliability-Sweep

The following findings have been **closed**:

| ID | Closed by |
|---|---|
| C1 (TD1 + TD9) localStorage Programs/sessions | Reliability + Defect Sweep — Priority A |
| C2 (TD2 + TD17) Anthropic in browser + silent fail | Reliability + Defect Sweep — Priority B |
| C3 (TD11) Client dashboard "Loading…" placeholders | Reliability + Defect Sweep — Priority C |
| C4 F6 missing | Feature 6 — `9a8f68b` |
| C5 (TD8) Phase Upgrade has no validation | Reliability + Defect Sweep — Priority D |
| H1 (TD3) login → index.html legacy link | Reliability + Defect Sweep — Priority A bundle |
| H2 (TD4) mobile nav not role-gated | Reliability + Defect Sweep — Priority C bundle |
| H3 (TD10) no client Notifications sidebar entry | Reliability + Defect Sweep — Priority C bundle |
| H5 (TD6) Add-Exercise modal scope mismatch | Reliability + Defect Sweep — H5 |
| H7 (TD5) `stat-sessions` from localStorage | Reliability + Defect Sweep — Priority A |

**Still open (deferred Highs + all Mediums):** H4 (client workout history), H6 (coach reassignment), H8 (onboarding flows), plus all Medium items + a new surfaced gap: `sessions` RLS multi-tenant leak (Medium).

The rest of this document is preserved as the historical record of the original audit. Reading order: this banner → Part 1 (architecture summary) → Part 3 (priority tables) → individual issue blocks for items not yet closed.

---

## Part 1 — Understanding & Roadmap

### 1.1 What NeuCore is

A rehab + movement-coaching SaaS for one-to-one coach-client relationships. The product loop is:

1. **Coach onboards a client** (creates the auth account, attaches a subscription).
2. **Coach runs a structured assessment session** (subjective + 13-domain objective ROM/control/force/neurology + 3D body map + gait engine + AI narrative).
3. **Coach publishes a phased program** (Phase 1 mobility → 2 control → 3 load) split into per-day workouts of warm-up + main + cool-down, plus a daily routine.
4. **Client executes daily** — starts workouts, logs sets/reps/weight, ticks the daily routine, submits RPM phase tripwires, and can request alt-exercises.
5. **Coach reviews progress** via a notifications inbox, a workout history feed, a four-score progression engine, and a one-to-many Community / Case Studies / referral surface.
6. **Phase upgrade celebration** when the client clears a phase.

The Supabase backend is the only persistence layer. The browser ships as a single `app.html` with role-aware sidebar visibility (no SPA router; section-DOM-swap loaders).

### 1.2 Current architecture — verified summary

| Layer | What | Where |
|---|---|---|
| Shell | `app.html` 2,344 lines · 24 `.section` blocks · role-class CSS gating · sidebar + mobile bottom-nav | `app.html` |
| Auth | Supabase email/password · profile + role + cached subscription state · `SubscriptionInactiveError` takeover screen | `js/auth.js` |
| Subscription | View `v_client_subscription_state` (active/grace/expired/pending) · `SubscriptionService` (cache + reactivate RPC) · `Auth.canWrite()` write-gate | `js/subscriptionService.js`, migration F1 |
| Sessions | Local-only `localStorage` cache `ast9_sessions_v2` (NOT in DB) + `sessions` DB row best-effort persist | `js/dashboard.js:11-18, 745` |
| Assessment | Structured wizard (13 NeuCore aims) + free-form fallback · objective ROM grid · 3D body map · gait engine | `app.html` tabs in `#section-new-session` |
| Program publish | `client_programs` JSON shape with `workouts[].{warmup,main,cooldown}[]` arrays; F5 evolved entries to include optional `exercise_id` | `js/programPublish.js` |
| Workout tracking | `workout_sessions` + `workout_exercise_logs`; one active per client; sets stored as `jsonb` | `js/workoutSession.js`, migration F2 |
| Notifications | `notifications` (insert via `notify()` RPC only) + 6 DB triggers for cross-module retrofit · realtime channel + 60s poll | `js/notificationsService.js`, migration F3 |
| Progression | View `v_client_progression` (Compliance · Recovery · Performance · Overall; formula v1.0) · inline SVG gauges | `js/progressionEngine.js`, migration F4 |
| Exercise library | `exercises` table + `ExercisePicker` modal (7 filter chips) + `ExerciseInstructions` helper · YouTube embed | `js/exercise{Library,Picker,Instructions,UI}.js`, migration none (F5 = zero migrations) |
| Daily routine | `daily_routine_logs` (live shape: `completed bool, battery_pct int`) | `js/dailyRoutine.js` |
| Community | 6-tab section: Messages · Referrals · Case Shares · Client Feed · Support Groups · Privacy | `js/community.js`, `js/communityUI.js` |
| RPM | Reactive Graph builder + phase submission/approval queue + ML feedback loop | `js/rpm/*` |
| Client home | Role-aware Home: `#section-client-dashboard` for clients (3D Load Visualizer + progression gauges + Chart.js metric trio + Assessment Report card + Peer Success Gallery) | `js/clientDashboard.js` |
| Coach home | `#section-dashboard` — 4 stat cards + Recent Sessions + Recent Clients | `app.html`, `js/dashboard.js:319` |

### 1.3 Completed features — confirmed status

✅ Frozen (Features 1–4) + ✅ live (Feature 5, not yet formally signed off):

| # | Feature | Status |
|---|---|---|
| F1 | Subscription Grace + Write-Gate Service | 🔒 frozen, live |
| F2 | Workout Session Tracking | 🔒 frozen, live |
| F3 | Notifications + Alt-Exercise + cross-module retrofit | 🔒 frozen, live |
| F4 | Progression Engine v1 | 🔒 frozen, live (formula v1.0 immutable in place) |
| Tier 1 | Spec compliance + FK guards + Phase Upgrade notif | ✅ live |
| Tier 2 | Advisor hardening (REVOKE + search_path) | ✅ live |
| F5 | Exercise Video Integration | ✅ live, not yet "frozen" |

### 1.4 Outstanding gaps & deferred items — confirmed inventory

From NEXT_STEPS §3 plus what I observed in the live source:

- **Feature 6 — Alt-Exercise Replacement** (architecture preview locked, not yet implemented). Today's "alt-exercise request" lets a client ask, and the coach can write a free-text reply, but the program does not actually swap. Half-finished from the client's POV.
- **Feature 7 — Assessment Results / 3D Hologram Integration** (client dashboard's Assessment Report card has hard-coded "Loading…" placeholders for True Driver / Reported Symptoms / Coach's notes — never resolves).
- Email/SMS push (Resend exists, only used for `subscription_activated` + `phase_upgrade` direct calls; not wired through the notification severity tiers).
- Notification deep-link pre-select on target loaders.
- Daily pg_cron for `ensure_subscription_notifications` (today only fires on a client login).
- Progression v2 (nutrition + RPM phase signals).
- Nutrition Plan whole feature.
- Per-exercise skip tristate in workout tracker.
- "Unpublished program" indicator coach-side.
- Username vs email at signup (spec misalignment).
- Three competing coach progress surfaces (Progression / Workout History / Progress Charts) not unified.

### 1.5 Technical debt + risks — discovered in this audit

| # | Item | Severity | Where |
|---|---|---|---|
| TD1 | **Sessions data is in `localStorage`.** "Programs" page, the "Sessions" stat card, and the Recent Sessions panel all read `_sessions` from `localStorage` key `ast9_sessions_v2`. Coach loses everything on cache clear / different browser / device. | 🔴 critical | `js/dashboard.js:11-18, 343, 377, 575, 860, 892` |
| TD2 | **Anthropic API called directly from the browser without an API key.** `fetch('https://api.anthropic.com/v1/messages', ...)` with no `x-api-key` header — every request will 401. AI narrative silently falls back to the stub `'[AI narrative unavailable — check API key]'`. Should route through an edge function with a server-held secret. | 🔴 critical | `js/dashboard.js:547` |
| TD3 | **Login page links back to `index.html`** (the deprecated legacy AST9 shell). "Back to NeuCore" button on the login screen sends users *out* of the active app. | 🟠 high | `app.html:32` |
| TD4 | **Mobile bottom nav exposes coach-only sections to clients.** 4 hardcoded buttons (Home · Session · Community · Programs) with no role gating — a client tapping "Session" or "Programs" lands on a `display:none`-via-CSS section and sees nothing. | 🟠 high | `app.html:1576-1590` |
| TD5 | **`stat-sessions` on coach dashboard counts `_sessions.length`** (localStorage). Wrong across devices; meaningless on a fresh browser. | 🟠 high | `js/dashboard.js:343` |
| TD6 | **Add-Exercise modal scope mismatch with library schema.** Modal lists 3 categories (Rehab, Mobility, Strength) but live `exercises.category` CHECK allows 5 (`Rehab`, `Mobility`, `Strength`, `Neurology`, `Breathing`) — and F5's `ExercisePicker` filters by `tag='conditioning'` but the Add-Exercise modal has no tags input. Coaches can't tag a Conditioning exercise from the UI. | 🟠 high | `app.html:1744-1764`, `js/clients.js:239-258` |
| TD7 | **No coach-side reassignment UI.** Once `assigned_coach` is set, there's no way to change it from the app. Admin has no client-management surface beyond the shared `role-coach-admin` Clients page. | 🟠 high | `js/clients.js` (no reassign action) |
| TD8 | **Phase Upgrade modal doesn't read current phase.** Coach can pick "Phase 2" for a client already on "Phase 3" — silently downgrades them (and fires a celebration). No validation. | 🟠 high | `app.html:1707-1737`, `js/dashboard.js:966-994` |
| TD9 | **`Programs` sidebar entry never reads `client_programs`.** The "Programs" page is `renderProgramsList` from `_sessions` (the broken localStorage stash from TD1); the *actual* published programs table (`client_programs`) is only accessed by the client-side `My Program` renderer. Coach has no UI to list, edit, or unpublish a published program. | 🔴 critical | `js/dashboard.js:857-882` |
| TD10 | **Cross-device notification visibility for clients depends on the bell.** No client sidebar entry for "Notifications" — the bell icon is hidden in the sidebar footer. Mobile clients almost certainly never find it. | 🟠 high | `app.html:235`, no `nav-notifications` for clients |
| TD11 | **Assessment Report card on client dashboard has dead "Loading…" text** that never resolves — visible to every client on Home. Looks like a perpetually-broken widget. | 🔴 critical | `js/clientDashboard.js:154-165` |
| TD12 | **Community tabs are not role-gated.** All 6 tabs (Messages, Referrals, Case Shares, Client Feed, Support Groups, Privacy) show for any role. A client clicking "Referrals" or "Case Shares" sees coach-shaped UI. | 🟡 medium | `app.html:1140-1153` |
| TD13 | **`#section-rpm-approvals` mixes coach + admin concerns.** Section is `role-coach-admin` but its body includes `#case-approvals-root` which the inline comment says is "Admin-only" — relies on JS to conditionally render. Coach loading the page may briefly see admin controls. | 🟡 medium | `app.html:1555-1572` |
| TD14 | **`previewWeb` still ships legacy AST9 branding.** The blob HTML literal contains `<div class="logo">⚡ AST9</div>` and a footer "AST9 Elite Coaching Platform" — leaks the deprecated brand to clients who get a generated program preview link. | 🟡 medium | `js/dashboard.js:842, 851` |
| TD15 | **`coaches-tbody` "Clients" column hard-codes "–"** instead of counting clients per coach. Admin can't see workload distribution. | 🟡 medium | `js/clients.js:160` |
| TD16 | **No "client-search/filter" on Clients page.** Coach with 50 clients must scroll. | 🟡 medium | `js/clients.js:11-66` |
| TD17 | **AI narrative quietly missing breaks the "Generate" experience.** Toast says "Program generated!" while the actual AI section displays the error string — appears successful. | 🟠 high | follow-on of TD2 |
| TD18 | **No client-side workout history.** Clients can only see today's tracker; can't review what they did last week or any trends. Coach gets the only history view. | 🟠 high | `js/dashboard.js:122-128` (loader is coach-only) |
| TD19 | **`Nutrition Plan` section is a static "Coming soon" with no input pipeline.** Linked from sidebar (client-only) — a dead-end visible to every client. | 🟡 medium | `app.html:261-274` |
| TD20 | **`Gait Analysis` coach section is a placeholder** — loader is `/* placeholder — wired in future phase */`. Sidebar entry visible to coaches/admins. Dead-end. | 🟡 medium | `js/dashboard.js:104`, `app.html:1396-1413` |
| TD21 | **No service-worker / offline support.** A client logging a workout in a gym with weak signal will lose the write. | 🟡 medium | architecture |
| TD22 | **`grace_days` always 7** — coach can't override per-client at subscription-creation time. Modal has no field. | 🟢 low | `app.html:1654-1689` |
| TD23 | **Welcome greeting falls back to "Coach"** for any client whose `full_name` is empty — clients see "Good morning, Coach 👋". | 🟢 low | `js/dashboard.js:41` |
| TD24 | **12 pre-existing security advisor warnings** untouched by Tier-2 hardening (out of scope for that pass but still open). | 🟡 medium | Supabase advisors |

### 1.6 Recommended roadmap — my view, post-audit

My recommendation differs from the standing "F6 next" plan in NEXT_STEPS. Reasoning: F6 closes a half-finished feature, but the audit reveals **two critical defects (TD1 + TD2 + TD9 + TD11) that are silently broken in production right now** — fixing those buys more user trust per hour than building a new feature.

**Proposed order:**

1. **Critical defects pass** (one commit, ~1 day): TD1 + TD9 (move sessions/programs off localStorage), TD2 + TD17 (move Anthropic to an edge function), TD11 (kill the dead "Loading…" placeholders on client dashboard or wire them up), TD3 (kill the back-to-index.html link), TD8 (phase-upgrade validation).
2. **Feature 6 — Alt-Exercise Replacement** (per NEXT_STEPS, ready to go, ~155 lines + 1 migration). Closes the half-finished F3 promise.
3. **Feature 7 — Assessment Results integration** (replaces the TD11 placeholders properly).
4. **Notifications hardening** — client sidebar entry (TD10), email/SMS push for high-severity (deferred from F3), daily pg_cron for sub expiring (deferred from F1).
5. **Coach productivity polish** — workload counts (TD15), client search (TD16), unpublished-program indicator, three-surfaces unification.
6. **Nutrition Plan** — needs its own architecture pass (currently a dead "Coming soon" — TD19).

If you want to **strictly preserve the standing plan**, the next feature is F6. But if you accept the audit's premise that broken-in-production is worse than missing, the **critical defects pass goes first**.

---

## Part 2 — Workflow audits, per role

### 2.1 Coach workflow audit

I walked every coach-reachable surface in `role-coach-admin` from login to inbox response.

| Step | Workflow | Working? | Friction / gap |
|---|---|---|---|
| 1 | Coach signs in | ✅ | Subscription state not loaded for coaches (correctly — gate is client-only). Login itself fine. |
| 2 | Coach lands on Dashboard | ⚠ | Greeting works. 4 stat cards: `stat-clients`, `stat-subs`, `stat-expiring` come from DB; `stat-sessions` comes from localStorage (TD1/TD5) — meaningless. Recent Sessions also localStorage; Recent Clients is DB ✅. |
| 3 | Coach views Clients list | ⚠ | Loads ✅. No search/filter (TD16). No bulk actions. "+ Session" row action prefills name + phase but skips age, goal, injury_history that already exist on the profile. Reassign-coach action missing (TD7). |
| 4 | Coach adds a new client | ✅ | Modal validates required fields, requires coach assignment (Tier-1 fix C ✅). Calls edge function `create-user`. Temp password shown plaintext (no email-link option). |
| 5 | Coach creates subscription | ✅ | Modal works. `grace_days` defaults to 7, no override (TD22). Pending/Activate split is clean. |
| 6 | Coach reactivates an expired client | ✅ | Reactivate button only renders for expired/grace rows; SubscriptionService is the single path (architecture rule honored). |
| 7 | Coach runs **New Session** assessment | ⚠ | 5 tabs work. Picking a client populates name/phase but does *not* fetch their last subjective so coach starts blank every time. The 3D body map auto-sync on numeric inputs is excellent. |
| 8 | Coach generates a program (the marquee feature) | 🔴 | **AI narrative silently fails (TD2/TD17).** Local engines + ProgramPublish render fine — coach won't notice the failure unless they look at the "Generation panel" closely. PDF export depends on NeuPDF being loaded. |
| 9 | Coach publishes the program | ✅ | ProgramPublish editor is solid. F5 library autosuggest + library button both work. |
| 10 | Coach revisits "Programs" sidebar | 🔴 | **Reads only localStorage `_sessions` (TD9)**, not the real `client_programs` table. On a fresh browser this list is empty even if the coach published 30 programs. No coach surface lists published programs from DB. No "unpublish", no "republish", no "show as of date" — all missing. |
| 11 | Coach checks Exercise Library | ⚠ | Loads. Add-Exercise modal only offers 3 categories (TD6). No tag input. No upload (only YouTube URL). Inline ✕ delete with `confirm()`. |
| 12 | Coach views Workout History | ✅ | F2 mountCoachView works. No aggregation/trendlines/PRs (TD18-adjacent: there's no analytics over workouts at all). |
| 13 | Coach checks Progression | ✅ | F4 overview works. Performance score stuck at 50 by design (acknowledged v1 limit). |
| 14 | Coach opens Progress Charts | ⚠ | Loader populates client picker (Tier-1 fix L). Then delegates to `Charts.renderClientProgressPage` — works. Duplicates Progression page concerns (TD: three surfaces overlap). |
| 15 | Coach views Notifications inbox | ✅ | Bell, realtime channel, deep-link pre-select (partial — lands on section, not on item). Alt-request sub-panel present. |
| 16 | Coach responds to an Alt-Exercise request | ⚠ | Free-text response works. **Cannot actually substitute the exercise (F6 not built).** Client sees the response in their inbox but their program is unchanged — broken promise. |
| 17 | Coach upgrades a client's phase | ⚠ | Modal works but **doesn't read the current phase (TD8)** — can silently downgrade. Sends celebration regardless. |
| 18 | Coach reviews RPM phase approvals | ✅ | Phase submissions appear in queue. ML feedback modal works. |
| 19 | Coach uses Community → Messages | ⚠ | Loads. No role gating on tabs (TD12) — coach sees same surface as client; coach-vs-client roles within a thread depend on backend. |
| 20 | Coach shares a Case Study | ⚠ | Submission flow works, goes to admin queue. Coach approval is a separate `case-approvals-root` shown inside the RPM Approvals section (TD13 — mixed surface). |
| 21 | Coach Sign Out | ✅ | Footer icon. Works. |

**Coach-side missing/critical:**

- **TD9 — Programs page is a fiction** for any device where the program wasn't generated.
- **TD8 — Phase Upgrade is dangerous.**
- **F6 missing — half-finished alt-request promise.**
- **TD2/TD17 — AI narrative silently broken.**

---

### 2.2 Client workflow audit

I walked every client-reachable surface starting from a fresh login on a clean cache.

| Step | Workflow | Working? | Friction / gap |
|---|---|---|---|
| 1 | Client signs in | ✅ | Subscription gate fires correctly. Inactive state shows `#screen-subscription-inactive` instead of an inline toast (Feature 1 ✅). |
| 2 | Client lands on Client Dashboard | ⚠ | Subscription pill + grace banner work. 3D Load Visualizer mounts when `window.LoadVisualizer` is ready — else placeholder. **Assessment Report card shows "Loading…" forever (TD11)** — looks broken to every user. Peer Success Gallery is "Coming soon" empty state — looks dead. |
| 3 | Client opens My Program | ✅ | `ProgramPublish.renderClientProgram` does its job; F5 library metadata + thumbnails + ▶ Preview + ℹ Instructions all render when linked. Legacy free-text rows fall through cleanly. |
| 4 | Client starts a workout | ✅ | One-active-per-client constraint correct. Live timer ticks. |
| 5 | Client logs sets/reps/weight | ✅ | Debounced upsert. F2 contract honored. |
| 6 | Client requests an Alt-Exercise | ⚠ | Modal works · DB insert → coach inbox notification fires. **Client is then told to "wait for coach response," but the response (today) is free-text only — exercise is not actually swapped (F6).** Disconnects expectation from outcome. |
| 7 | Client finishes workout | ✅ | Intensity rating + session notes captured. Status flips to `completed`. |
| 8 | Client checks workout history | 🔴 | **No client-side workout history view (TD18).** Only the coach has the history page. Client can't review last week's effort. |
| 9 | Client does Daily Routine | ✅ | Tracker mounts. Check-off works. Backed by `daily_routine_logs.completed + battery_pct`. |
| 10 | Client views Nutrition Plan | 🔴 | **Dead-end "Coming soon" empty state (TD19)** with no roadmap promise. Visible in sidebar to every client. |
| 11 | Client visits My Graph | ✅ | RPMGraphViewer mounts. Phase submission flow works. |
| 12 | Client opens Community | ⚠ | All 6 tabs visible (TD12). Referrals/Case Shares irrelevant to clients — confusing surface. |
| 13 | Client browses Case Studies | ✅ | PlatformExtras carousel — public-style content. Reasonable. |
| 14 | Client opens Notifications inbox | ⚠ | **No sidebar entry for clients (TD10)** — only the small bell icon in the footer. Mobile clients won't find it. |
| 15 | Client opens Settings | ✅ | Email + name + change-password + sub state. Solid. |
| 16 | Client gets a phase-upgrade celebration | ⚠ | Trigger fires `notify()` per Tier-1 fix; client sees it in inbox (if they find the bell). The full-screen confetti is **coach-side only** (`showCelebration` is only called in `submitPhaseUpgrade`); client experiences it as a single inbox row. |
| 17 | Subscription enters grace | ✅ | Banner renders; pill turns rose; client can still write (per write-gate rule). |
| 18 | Subscription expires | ✅ | Login blocked → `#screen-subscription-inactive` takeover. |
| 19 | Client tries Demo / Guest | ✅ | `loginAsGuest` throws typed `DEMO_UNAVAILABLE`; UI catches and shows a clean error. |

**Client-side missing/critical:**

- **TD11 — dead "Loading…" placeholders right on Home** — every client sees this on every visit.
- **TD18 — no own workout history.**
- **TD10 — no Notifications nav entry.**
- **TD19 — Nutrition Plan is a phantom feature.**
- **F6 — alt-request UX is half-complete.**
- **No celebration moment on the client side** for phase upgrade — it's coach-only confetti.
- **No onboarding flow** — first-time client lands on a dashboard where 3 of 5 cards are "Loading…" or "Coming soon."

---

### 2.3 Admin workflow audit

Admin role is the thinnest — the sidebar gives them `Coaches` and `Settings` as `role-admin-only`, plus all `role-coach-admin` items.

| Step | Workflow | Working? | Friction / gap |
|---|---|---|---|
| 1 | Admin signs in | ✅ | Same as coach. |
| 2 | Admin lands on Dashboard | ⚠ | Same coach Home — counts `clientCount` across all clients (no `assigned_coach` filter when `isAdmin()`). |
| 3 | Admin manages Coaches | ⚠ | List loads. "Clients" column **hard-codes `–`** (TD15) — admin can't see workload distribution. Remove-coach hits `delete-user` edge fn — no warning about orphaned clients (their `assigned_coach` will be null, breaking notification triggers via `_profile_exists` guard, ✅ safe, but no UX cue). |
| 4 | Admin adds Coach | ✅ | Modal works. |
| 5 | Admin views all Clients | ⚠ | Uses the same `role-coach-admin` Clients page → query has no `assigned_coach` filter when `isAdmin()` ✅. But still no search, no coach reassignment, no admin-specific bulk ops (TD7, TD16). |
| 6 | Admin Settings | ⚠ | Static info card. Lists Supabase project ID + Resend service — looks like a status page, not an editor. No platform toggles, no role-management UI, no admin password rotation beyond personal change-password. |
| 7 | Admin approves Case Studies | ⚠ | Lives inside `#section-rpm-approvals` mixed with phase approvals (TD13). No dedicated nav entry. |
| 8 | Admin reviews Notifications | ✅ | Same inbox. Trigger guards apply. |
| 9 | Admin views Analytics | ⚠ | Loader calls `Charts.renderDashboardAnalytics?.()` — module may not be present; page may fall to nothing. No platform-level KPIs documented. |
| 10 | Admin views Gait Analysis | 🔴 | Placeholder section, no implementation (TD20). |

**Admin-side missing/critical:**

- **No dedicated admin client overview.** Admin sees the coach Clients page but with no per-coach grouping, no orphaned-client report, no churn dashboard.
- **No coach-workload visibility (TD15).**
- **No reassignment / migration tools (TD7).**
- **No platform-level analytics surface.**
- **No invoice / billing / payment surface** (subscriptions are tracked but the *money* side isn't modelled — no Stripe integration visible, no per-client revenue view).
- **No audit log / activity feed.**

---

## Part 3 — Prioritized findings

Findings are bucketed by user-impact severity (not engineering effort).

### 🔴 Critical (silently broken in production OR blocks core promise)

| ID | Finding | Impact |
|---|---|---|
| C1 | **TD1+TD9** Programs/sessions live in `localStorage` only. Coach loses their work across devices/browsers and has no way to list published programs from the DB. | Coach can't reliably review their own output. The "Programs" sidebar entry is a lie on any fresh browser. |
| C2 | **TD2+TD17** Anthropic API called from the browser with no key. AI narrative always fails → silently falls back to stub. Toast says success. | The marquee "AI program generation" is a mirage. Coaches don't know it's broken. |
| C3 | **TD11** Client dashboard's Assessment Report card has hardcoded "Loading…" that never resolves. | Every client sees a perpetually-broken widget on their Home, every visit. Trust killer. |
| C4 | **F6 missing** Alt-Exercise Request → coach response → program does not swap. | Client requests an alternative, coach replies "OK, do X instead" — the program still shows the original. Mismatch between conversation and what the client actually sees. |
| C5 | **TD8** Phase Upgrade modal doesn't validate current phase. Coach can silently downgrade. | Sends a confetti email saying "Phase Complete!" for a downgrade. Embarrassing. |

### 🟠 High (significant UX/operational damage; visible to users)

| ID | Finding | Impact |
|---|---|---|
| H1 | **TD3** Login page links back to deprecated `index.html`. | Active users get bounced to the dead legacy shell. |
| H2 | **TD4** Mobile bottom nav exposes coach-only sections to clients. | Mobile clients tap "Session" → blank screen. |
| H3 | **TD10** No client sidebar entry for Notifications inbox. | Mobile clients miss every alt-request response, phase upgrade, grace notice. |
| H4 | **TD18** No client-side workout history. | Client can't review their own progress between sessions. |
| H5 | **TD6** Add-Exercise modal can't create Neurology / Breathing / Conditioning-tagged exercises. | Library can't be extended via the UI to cover the very filters F5 advertised. |
| H6 | **TD7** No coach reassignment UI. | When a coach leaves, admin has to write SQL. |
| H7 | **TD5** `stat-sessions` on coach dashboard is meaningless. | Wrong number on the most prominent KPI. |
| H8 | **No onboarding flow** for either coaches or clients. | New user lands on a screen with multiple "Loading…" / "Coming soon" cards and zero guidance. |

### 🟡 Medium (noticeable friction, partial coverage)

| ID | Finding | Impact |
|---|---|---|
| M1 | **TD12** Community tabs not role-gated. | Clients see Referrals/Case Shares panes built for coaches. |
| M2 | **TD13** RPM Approvals section mixes coach + admin roles. | Coach may flash admin controls during render. |
| M3 | **TD14** Legacy "AST9" branding on `previewWeb` preview. | Brand confusion when client opens a preview link. |
| M4 | **TD15** Coaches page "Clients" column hard-coded `–`. | Admin can't see workload. |
| M5 | **TD16** No search/filter on Clients page. | Painful at scale. |
| M6 | **TD19** Nutrition Plan is a "Coming soon" dead-end. | Roadmap promise visible to every client. |
| M7 | **TD20** Gait Analysis coach page is a placeholder. | Sidebar entry leads nowhere. |
| M8 | **TD21** No service-worker / offline support. | Gym-floor weak-signal writes drop. |
| M9 | **TD24** 12 pre-existing security advisor warnings. | Tier-2 closed the new ones; the old ones remain. |
| M10 | **Three competing coach progress surfaces** (Progression, Workout History, Progress Charts) not unified. | Coach has to triangulate. |
| M11 | **No admin client list / coach-workload / churn dashboard.** | Admin role is under-served. |
| M12 | **Phase-upgrade celebration is coach-only** — client sees one inbox row instead of confetti. | Asymmetric milestone moment. |

### 🟢 Low (polish)

| ID | Finding |
|---|---|
| L1 | **TD22** No `grace_days` override at subscription-create time. |
| L2 | **TD23** "Coach" fallback greeting for clients with empty `full_name`. |
| L3 | Per-exercise skip tristate missing (deferred F2 slice). |
| L4 | Notification deep-link doesn't pre-select target item (deferred F3 slice). |
| L5 | No notification preferences / mute / unsubscribe UI. |
| L6 | No service-status indicator (Supabase paused/cold takes 30-90s — Auth knows but doesn't show users). |
| L7 | "Username vs email at signup" spec misalignment. |

---

## Part 4 — Recommended next feature

The user asked for an audit-driven recommendation — not "what's next on the priority list." So I'll separate the two answers.

### 4.1 Standing-plan answer

Per NEXT_STEPS §2, **Feature 6: Alternative Exercise Replacement** is queued and architecturally ready. Locked-out architecture preview, three open questions for the user, one migration, ~155 lines. If you simply want to execute the plan, that's the answer.

### 4.2 Audit-driven answer (my actual recommendation)

The audit reveals that **what's silently broken in production hurts more than what's missing**. So instead of starting Feature 6, I recommend a single short **"Production Reliability + Defect Sweep"** as the next chunk of work — then F6.

**Reliability + Defect Sweep — proposed scope (one focused commit, ~1 day):**

| Bucket | Fix | Reason |
|---|---|---|
| C1 | Migrate `_sessions` + Programs list off `localStorage` onto the existing `sessions` + `client_programs` tables. Add coach-side "Programs" reader that queries `client_programs` with coach filter. | The Programs sidebar entry must mean what it says. |
| C2 | Move the Anthropic call into a Supabase edge function (`generate-program-narrative`) with the API key as a Supabase secret. UI calls the edge fn, edge fn calls Anthropic. | Stops the silent fall-back to a stub. Closes a real API-key exposure risk. |
| C3 | Wire the client dashboard Assessment Report card to the latest `assessments` + `rehab_objective_assessments` + coach notes. (Replaces TD11 dead text with real data.) | This is essentially Feature 7's first slice — natural to ship now. |
| C4 / F6 | Lock the F6 architecture from NEXT_STEPS §2 (one column + ~155 lines). Coach response actually swaps the exercise. | Closes the half-finished promise. Architecturally already designed. |
| C5 / TD8 | Add current-phase guard to Phase Upgrade modal. Disable downgrade selection; refuse same-phase. | Two-line fix. |
| H1 / TD3 | Replace "Back to NeuCore" `index.html` link with sign-out or remove. | Single-line. |
| H2 / TD4 | Add role gating to mobile bottom-nav buttons (`role-client-only` vs `role-coach-admin`). | Single CSS class change per button. |
| H3 / TD10 | Add `nav-notifications` sidebar entry visible to clients (and reuse for coaches). Bell stays as the quick-access in footer. | Single nav entry. |
| H7 / TD5 | Replace `stat-sessions` count with a DB query (sum of `sessions` or `client_programs` rows for this coach). | Single function rewrite. |

**Why this ordering:** every item above is either silently-broken-in-prod or breaks the promise of a feature already shipped. Each is small. Together they restore trust in everything else before we ship the next thing.

After the sweep, **Feature 6** is the next net-new feature (per the original plan), with the F6 architecture preview locked from NEXT_STEPS.

### 4.3 Two questions for you before I do anything

1. **Sweep first, then F6 — or skip the sweep and go straight to F6?** The sweep is defensible because it fixes silent breakages; F6 is defensible because it's the planned next milestone. Your call.
2. **If sweep first: does it ship as one commit or one-per-fix?** One commit is a tight changelog; one-per-fix is easier to revert.

---

## Summary

- 5 features shipped + verified · 2 hardening passes · 7 migrations live · architecture is sound.
- **24 distinct technical-debt / UX gap items identified** in this audit, grounded in code citations.
- **5 critical defects** are silently broken in production today (Programs page, AI narrative, Assessment Report card, F6 promise, Phase Upgrade safety).
- **8 high-severity gaps** affect everyday use across roles.
- The standing roadmap puts **F6 next**; the audit puts a **reliability + defect sweep first, then F6**.

No code was written. No migrations were applied. Awaiting your call on which of the two roadmaps to execute.
