# SMOKE_TEST_PLAN.md — Client Mobile Redesign

**Purpose:** the manual, real-device/browser smoke test that gates the merge of the redesign branch into `main` (per `PRE_MERGE_ACTION_PLAN.md`, item M-3). A human executes this checklist and records Pass/Fail.
**Branch:** `claude/interesting-buck-452459` · **HEAD:** `f453382`
**Type:** test plan only — no code, no commit, no deploy.

---

## 0. Setup

### 0.1 Where to run
- **Pre-merge (recommended):** build the branch locally and serve the production bundle.
  - `npm ci` → `npm run build` → `npm run preview`, then open the app entry (`/app.html`). Or `npm run dev` for the dev server.
- **Post-merge (re-confirm):** after merging to `main` and the Pages deploy is green, repeat the critical rows against the live URL `https://abdelrahmansabry1909-oss.github.io/AST9_HUB/app.html`.

### 0.2 Devices / viewports
- **Mobile:** a real iOS device (Safari) **and** a real Android device (Chrome). At minimum, Chrome DevTools device emulation at ≤768px with `viewport-fit=cover` (notch) simulated.
- **Desktop:** Chrome + one of Firefox/Safari, window width > 768px.

### 0.3 Test accounts (roles)
| Role | Needed for | Notes |
|---|---|---|
| Client — active subscription | A/B mobile + desktop client flows | e.g. an active client with assessment + program + routine data |
| Client — expired / grace subscription | read-only tests (A7/B5) | may require setting `subscriptions.end_date` in test data; if unavailable, mark those rows **Blocked** |
| Client — brand new / no data | first-run/empty tests (A8.2) | optional; if unavailable, mark **Blocked** |
| Coach | C — coach protection | confirm coach sees the legacy sidebar, not the tab bar |
| Admin | D — admin protection | confirm admin workflows |

### 0.4 Legend
- **Result:** ☐ Pass ☐ Fail ☐ Blocked ☐ N/A
- **Severity if failed (suggested default; tester may adjust):** Critical (blocks merge) · High · Medium · Low.

> Exit criterion: **any Critical or High failure = MERGE BLOCKED** until fixed. Medium/Low failures are logged and triaged against `PRE_MERGE_ACTION_PLAN.md` (most are already known FAM/AR items).

---

## A. CLIENT — MOBILE (≤768px, role = client)

### A1 · Navigation (bottom tab bar)
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| A1.1 | Log in as client on mobile | App boots to **Today**; bottom tab bar visible (Today·Train·Progress·Coach·More); desktop sidebar hidden | ☐P ☐F ☐B | Critical |
| A1.2 | Tap each tab in turn | Each loads the correct screen; the tapped tab shows the active (teal) state | ☐P ☐F ☐B | Critical |
| A1.3 | Inspect bottom bar on a notch device | Tab bar sits above the home indicator (safe-area inset honored); content not clipped | ☐P ☐F ☐B | Medium |
| A1.4 | Look for any second bottom bar / hamburger | **No** legacy bottom nav; hamburger is hidden/inactive (single bar only) | ☐P ☐F ☐B | High |
| A1.5 | Scroll a long screen | Content scrolls; bottom bar stays fixed; nothing hidden behind it | ☐P ☐F ☐B | Medium |

### A2 · Today
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| A2.1 | Observe the hero | Recovery dial renders with score, band word + message; ring animates on load | ☐P ☐F ☐B | High |
| A2.2 | Read the CTA | Exactly **one** dominant CTA ("Start today's session" for active clients) | ☐P ☐F ☐B | High |
| A2.3 | Tap the CTA | Navigates to **Train** | ☐P ☐F ☐B | High |
| A2.4 | Tap the dial | Navigates to **Progress** | ☐P ☐F ☐B | Medium |
| A2.5 | Check header | Greeting + "Recovery Journey" eyebrow + subscription pill present | ☐P ☐F ☐B | Low |
| A2.6 | If an attention card shows | Tapping it routes to **Coach** | ☐P ☐F ☐B | Low |

### A3 · Train / Program / Daily Routine
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| A3.1 | Open Train | Stage stepper + current stage + streak ("🔥 N days") render | ☐P ☐F ☐B | Medium |
| A3.2 | Tap "Start session" | Daily Routine checklist reveals inline, **dark themed** (no white/serif card) | ☐P ☐F ☐B | High |
| A3.3 | Check a routine task | Item marks done; progress ring/percent updates; "Saved" appears | ☐P ☐F ☐B | High |
| A3.4 | Reload, reopen Train → Start session | Previously checked items persist for today | ☐P ☐F ☐B | High |
| A3.5 | Tap "Your full plan" | Published program reveals inline (exercises/sections) | ☐P ☐F ☐B | High |
| A3.6 | On a workout row, open exercise detail | Exercise instructions/video (F5) display | ☐P ☐F ☐B | Medium |
| A3.7 | On a workout row, tap ⇄ "Request alternative" | Alt-exercise request modal (F6) opens and can submit | ☐P ☐F ☐B | High |

### A4 · Progress
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| A4.1 | Open Progress | Skeleton then momentum summary (word + sparkline + recovery score) | ☐P ☐F ☐B | High |
| A4.2 | Expand "Check-in history" | Dates + score bars (no raw tables) | ☐P ☐F ☐B | Medium |
| A4.3 | Expand "Your latest report" | Client-friendly labels ("What we are focusing on", "What you have been feeling", "From your coach") | ☐P ☐F ☐B | Medium |
| A4.4 | Expand "Advanced insights" | Progression gauges + force/CoG/risk charts render | ☐P ☐F ☐B | Low |

### A5 · Hologram (Body load map)
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| A5.1 | Progress → expand "Body load map (3D)" → "View load map" | Fullscreen overlay opens; 3D anatomy loads | ☐P ☐F ☐B | High |
| A5.2 | Toggle Current / Target | Model recolors per state; active toggle highlighted | ☐P ☐F ☐B | Medium |
| A5.3 | Tap Back (and separately, press Escape) | Overlay closes; returns to Progress | ☐P ☐F ☐B | High |
| A5.4 | Open & close the hologram 5× in a row | No slowdown, no crash; WebGL context released each time (check via browser task manager / no context-loss warnings) | ☐P ☐F ☐B | High |
| A5.5 | While open, observe background | Background scroll is locked; focus is inside the dialog | ☐P ☐F ☐B | Low |

### A6 · Coach tab
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| A6.1 | Open Coach | **Coach Presence** card: coach name (or "Your recovery coach"), monogram, supportive intro | ☐P ☐F ☐B | Medium |
| A6.2 | Read "Latest guidance" | Calm guidance cards **or** a warm empty state — **not** an inbox (no archive/unread/count chrome); no subscription/billing alerts shown here | ☐P ☐F ☐B | Medium |
| A6.3 | Read "Your consistency" | Streak + N/7 days + gentle, non-guilt encouragement | ☐P ☐F ☐B | Low |
| A6.4 | Tap "Contact your coach" | Device mail composer opens, prefilled subject/body | ☐P ☐F ☐B | Medium |

### A7 · More tab
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| A7.1 | Tap More | Bottom sheet opens with groups **Recovery / Wellness / Resources / Account** | ☐P ☐F ☐B | High |
| A7.2 | Tap each item | Navigates correctly (Advanced Insights, Nutrition, Case Studies, Community, Services, Settings) | ☐P ☐F ☐B | Medium |
| A7.3 | Recovery → "Assessment History" | Opens Progress with the **Check-in history** disclosure expanded | ☐P ☐F ☐B | Medium |
| A7.4 | Recovery → "Recovery Reports" | Opens Progress with the **report** disclosure expanded | ☐P ☐F ☐B | Medium |
| A7.5 | Open sheet, press Escape / tap scrim | Sheet closes; background scroll restored | ☐P ☐F ☐B | Low |

### A8 · Subscription / read-only (client with expired or grace subscription)
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| A8.1 | Today, lapsed client | CTA becomes "Renew to continue" → routes to Coach | ☐P ☐F ☐B | High |
| A8.2 | Today attention card | Shows "Your plan has ended" (expired) or "Plan ends in N days" (grace) | ☐P ☐F ☐B | Medium |
| A8.3 | Train → Start session, lapsed client | Tracker opens **read-only** (cannot check items; no Reset) | ☐P ☐F ☐B | High |
| A8.4 | Subscription pill | Reflects expired/grace state (color/label) | ☐P ☐F ☐B | Low |

### A9 · States (offline / first-run / error)
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| A9.1 | Enable airplane mode, open each tab | Calm "You are offline" note at top; no crash | ☐P ☐F ☐B | Medium |
| A9.2 | Log in as a brand-new client (no data) | Today "Not yet" dial; Progress "Building"; Coach generic + warm empty; no blank screens | ☐P ☐F ☐B | Medium |
| A9.3 | Force a Progress load error (e.g. offline mid-load), open Progress | "We could not load your progress" + working "Try again" | ☐P ☐F ☐B | Low |

### A10 · Logout / login
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| A10.1 | More → Sign Out | Returns to login screen; session cleared | ☐P ☐F ☐B | High |
| A10.2 | Log back in | Boots to Today; tab bar present | ☐P ☐F ☐B | High |

---

## B. CLIENT — DESKTOP (>768px, role = client)

### B1 · Navigation (sidebar, consolidated)
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| B1.1 | Log in as client on desktop | Sidebar visible (no bottom tab bar); primary items **Today (Dashboard) · Train · Progress · Coach** all present | ☐P ☐F ☐B | High |
| B1.2 | Scan the client sidebar | **Daily Routine, My Program, Notifications are NOT shown** to the client | ☐P ☐F ☐B | High |
| B1.3 | Click Today / Train / Progress / Coach | Each loads the matching section | ☐P ☐F ☐B | High |
| B1.4 | Click secondary items (Nutrition, My Graph, Services, Case Studies, Community, Settings) | Each loads correctly | ☐P ☐F ☐B | Medium |
| B1.5 | (Known issue L-1) Click the footer notification **bell** | Currently still opens the raw notifications section — log as **known L-1** (Fix After Merge), not a new failure | ☐P ☐F ☐B | Low |

### B2 · Screens (desktop parity)
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| B2.1 | Today / Train / Progress / Coach on desktop | Render with the dark theme, same content as mobile | ☐P ☐F ☐B | Medium |
| B2.2 | Train → Start session | Daily Routine tracker dark-themed (not white/serif) on desktop too | ☐P ☐F ☐B | Medium |
| B2.3 | Train → Your full plan | Program + workout rows + ⇄ alt-request (F6) reachable | ☐P ☐F ☐B | High |
| B2.4 | Progress → Body load map | Hologram opens fullscreen; open/close 3× clean | ☐P ☐F ☐B | Medium |

### B3 · Subscription / logout (desktop)
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| B3.1 | Lapsed client, Today + Train | Renew CTA + read-only tracker (as A8.1/A8.3) | ☐P ☐F ☐B | High |
| B3.2 | Sign out → log back in | Returns to login; re-login boots to Today | ☐P ☐F ☐B | High |

---

## C. COACH — DESKTOP (role = coach) — protection / no-regression

### C1 · Navigation & shell
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| C1.1 | Log in as coach | Coach sidebar renders; **no client bottom tab bar**; `body.nc-client` NOT applied | ☐P ☐F ☐B | Critical |
| C1.2 | Scan coach nav | Coach items present incl. **Daily Routine** and **Notifications**; client-only items (Train/Progress/Coach tab/My Graph/My Program) NOT shown | ☐P ☐F ☐B | High |

### C2 · Daily Routine (coach view)
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| C2.1 | Open Daily Routine | Coach **adherence dashboard** (per-client streaks/heatmap), **original light theme intact** (not the client dark restyle) | ☐P ☐F ☐B | High |

### C3 · Notifications / alt-exercise
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| C3.1 | Open Notifications | Inbox renders; alt-exercise request queue present | ☐P ☐F ☐B | High |
| C3.2 | Respond to an alt-exercise request | Flow works end to end (F6 coach side) | ☐P ☐F ☐B | High |

### C4 · Core coach workflows (F1–F7 coach side)
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| C4.1 | New Session / assessment | Unchanged; completes | ☐P ☐F ☐B | High |
| C4.2 | Programs → publish a program | Unchanged; publishes | ☐P ☐F ☐B | High |
| C4.3 | Open a client detail → Recovery report | Labels still **clinical** ("True Driver", "Reported Symptoms") — confirms the client relabel did not leak to coach | ☐P ☐F ☐B | High |
| C4.4 | Clients / Subscriptions / Workout History / Progression / Approvals | Each loads and behaves as before the redesign | ☐P ☐F ☐B | High |

### C5 · Logout
| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| C5.1 | Sign out → log back in | Returns to login; re-login lands on coach dashboard | ☐P ☐F ☐B | Medium |

---

## D. ADMIN — DESKTOP (role = admin) — protection / no-regression

| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| D1.1 | Log in as admin | Admin sidebar (incl. Coaches, Settings) + coach items; **no client tab bar** | ☐P ☐F ☐B | Critical |
| D1.2 | Open Coaches | Loads; admin can manage coaches | ☐P ☐F ☐B | High |
| D1.3 | Open admin Settings | Loads; unaffected | ☐P ☐F ☐B | High |
| D1.4 | Spot-check a coach-shared section (Clients, Subscriptions) | Behaves as before | ☐P ☐F ☐B | High |
| D1.5 | Sign out → log back in | Returns to login; re-login lands on admin home | ☐P ☐F ☐B | Medium |

---

## E. Cross-cutting checks

| ID | Steps | Expected | Result | Sev if fail |
|---|---|---|---|---|
| E1 | Open the browser console on client mobile + desktop during the run | No **new** uncaught errors from the redesign. (Known/expected pre-existing: three.js example-script 404s — `OrbitControls`/`GLTFLoader`/`DRACOLoader`; log as known M-1, not a new failure.) | ☐P ☐F ☐B | High (new errors) |
| E2 | Repeatedly switch tabs + open/close hologram, watch memory | No runaway memory growth / WebGL context accumulation | ☐P ☐F ☐B | Medium |
| E3 | Enable OS "Reduce Motion", reload client app | Dial sweep / chevron / shimmer animations are suppressed | ☐P ☐F ☐B | Low |
| E4 | Keyboard only (desktop client): Tab through tab bar, More sheet, hologram | Focus is reachable + trapped in modals; Escape closes; focus restores. (Known L-3: Daily Routine checkbox may not toggle via keyboard — log as known.) | ☐P ☐F ☐B | Low |
| E5 | First paint timing on mobile (cold load) | App is usable within a reasonable time; no white-screen hang (note: pre-existing ~290 KB gzip bundle, M-2) | ☐P ☐F ☐B | Medium |

---

## F. Run summary & merge decision

| Field | Value |
|---|---|
| Tester | __________________ |
| Date / build (commit) | __________ / `f453382` |
| Environment | ☐ local preview ☐ live (post-merge) |
| Devices used | iOS Safari ☐ · Android Chrome ☐ · Desktop ☐ |
| Totals | Pass ___ · Fail ___ · Blocked ___ · N/A ___ |
| Critical/High failures | ___ (list IDs: __________________) |

**Decision rule:**
- **0 Critical/High failures →** smoke test PASSED → proceed to merge (per `PRE_MERGE_ACTION_PLAN.md`: READY TO MERGE).
- **Any Critical/High failure →** MERGE BLOCKED; file the defect, fix, re-run the affected rows.
- **Medium/Low failures →** log against the action plan (most map to known FAM/AR items: L-1 bell, L-3 keyboard, M-1 404s, M-2 bundle) and proceed at the team's discretion.

> Reminder: this is a test plan only. Executing it requires no code changes. Do not merge, deploy, or start Feature 8 until the run is reviewed.

---

## G. Automated smoke run — CX1 program polish (commit `d079a9f`)

**Executed:** 2026-06-08 · **Type:** automated, headless **Chrome** (real browser, not jsdom) via `puppeteer-core` pointed at the installed Chrome. **Result: 52 / 52 PASS · 0 FAIL.**

**Scope & method.** Drives the *real* `js/clientProgram.js` and verifies the *real* `js/programPublish.js` exports. The data boundary (`ProgramPublish.resolveClientProgram`, the F2 `WorkoutSession` layer) and leaf F5/F6 helpers (`ExerciseLibrary`/`ExerciseInstructions`/`ExerciseUI`/`AltExercise`) are mocked with a deterministic fixture (a 3-day plan; Day 1 = 7 exercises to force grouping; rest values + library metadata + long text present). This exercises 100 % of the polished UI code paths; it does **not** replace the human rows above (real Supabase data, real devices, coach/admin shells, hologram, offline) — those remain pending a tester.

| Category | Checks | Maps to | Result |
|---|---|---|---|
| 1 · Program overview | 8 | A3.5 | ✅ 3 day cards; "Day 1/2/3"; title + exercise count + duration (never 0/Unknown/N·A) + word-status; Day 1 = "Today's Session"; no percentages |
| 2 · Day detail | 9 | A3.5 | ✅ back + Start Workout; Warm Up/Main/Cool Down; warm-up & cool-down collapsed, main expanded (>6); description & coach-notes line-clamped; Show details toggles |
| 3 · Execution | 6 | A3.5 | ✅ "Exercise 1 of 7"; one exercise at a time (no day cards / no group list); progress bar; Prev/Next; per-set check-off dims row + auto-marks Done |
| 4 · Rest timer | 8 | (new) | ✅ appears on prescribed rest; start→Skip+countdown (1 interval); skip clears; navigating away clears (0 intervals — no leak) |
| 5 · Completion | 6 | A3.3 | ✅ Finish→success toast; completion banner appears exactly once; Day 1 status → Completed; banner does not reappear on next render (one-shot) |
| 6 · F5 / F6 regression | 6 | A3.6 / A3.7 | ✅ Watch + How-to + Request-alternative present on metadata-bearing exercises (correctly absent without metadata); Watch embeds player; alt → `AltExercise.openModal({workoutKey,exerciseIndex})` |
| 7 · Routing regression | 5 | B1.2 / C4.2 | ✅ `ProgramPublish` exports exactly `{getProgram, render, resolveClientProgram}`; legacy `renderClientProgram` = `undefined`; coach `render` preserved; app.html/dashboard.js carry no functional `my-program`/`section-my-program` (tombstone comment only); Train present in desktop nav + mobile tab bar |
| 8 · Browser console | 2 | E1 | ✅ zero console errors / pageerrors; zero unhandled promise rejections |

**Note on the run:** two checks failed on the first pass — both were *harness-probe* errors (F5 media was probed on a warm-up exercise that legitimately has no library metadata, so renders no Watch button). Root-caused as test bugs, probes corrected to target the metadata-bearing exercise; **no `clientProgram.js` changes were required.** Harness lives outside the repo (`D:\ASThub\.smoke-d079a9f`), so the worktree is unchanged.
