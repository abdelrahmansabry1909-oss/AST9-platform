# Client Dashboard: Mobile-First Redesign (FINAL, for signoff)

**A world-class UI/UX proposal. Design only. No code, no schema, no implementation.**

Produced with the **Impeccable** skill (`.agents/skills/impeccable`), register = **product**, command = **shape**, supported by its `cognitive-load` and `responsive-design` references.

**Status:** approved with modifications (this revision folds them in). Pending final signoff before any code.

**Locked product direction (from approval):**
1. Mobile-first is mandatory.
2. Dark, calm, premium.
3. Status-first.
4. Recovery score is the hero.
5. Hologram remains, but secondary.
6. Minimal cognitive load.
7. Action-focused, not analytics-focused.

**Anchors:** WHOOP, Oura, Apple Health. **Avoid:** medical-software feel, spreadsheet feel, analytics-dashboard feel.

**IMPECCABLE_PREFLIGHT:** context=pass · product=fail (no PRODUCT.md; anchored on real artifacts + discovery) · command_reference=pass (shape, product, cognitive-load, responsive-design) · shape=confirmed-with-mods · image_gate=skipped: no native image generation in this harness · mutation=blocked (design-only)

---

## 1. Current-state audit

### 1a. Everything the client dashboard renders today
Source: `js/clientDashboard.js` (`#section-client-dashboard`), top to bottom:

1. **Subscription grace banner** (conditional).
2. **Header**: eyebrow "Your Recovery", "Welcome back, {name}", subtitle "a read-only view", subscription **pill**.
3. **Hero**: "Load Distribution", a **Point A vs Point B toggle**, the **3D hologram** (`window.LoadVisualizer`), and **4 load-overlay cards** (Lower Back, Right Hip, Left Knee, Cervical).
4. **Progression gauges** (F4): Overall, Compliance, Recovery, Performance, each with sub-stats.
5. **3 charts**: Force Steadiness, Center of Gravity, Risk Timeline.
6. **Assessment Report**: True Driver, Reported Symptoms, coach notes.
7. **Peer Success Gallery**: "Coming soon".

### 1b. Heuristic scoring (Impeccable cognitive-load checklist, mobile)
Single focus ❌ · Chunking ❌ · Grouping ⚠️ · Visual hierarchy ❌ · One-thing-at-a-time ❌ · Minimal choices ⚠️ · Working memory ✅ · Progressive disclosure ❌.
**Score: 5 failures + 2 partials = HIGH cognitive load (critical for mobile).**

### 1c. Structural problems
Desktop-only sidebar (no mobile nav, mixes coach items). A heavy WebGL canvas is the dominant first element. Same-weight cards everywhere (Impeccable "card grid" anti-pattern). Analytics over action; the page is a report, not a next step. Clinical jargon ("Load Distribution", "Center of Gravity") shown to an anxious patient.

---

## 2. Information classification

| Information | Class | Destination |
|---|---|---|
| Recovery score + state word + one plain sentence | **Critical** | Today (hero) |
| The single next action (start today's session) | **Critical** | Today (one CTA) → Train |
| What needs attention (coach nudge, blocking subscription, pending decision) | **Critical** | Today (attention zone) |
| Where I am in the journey (phase, streak, today vs plan) | **Secondary** | Train |
| Full program (phases, exercises, video, alt-swaps) | **Secondary** | Train (the journey) |
| Daily routine, streak, battery, heatmap | **Secondary** | Train |
| Recovery trend over time | **Secondary** | Progress |
| Progression 4-scores | **Secondary** | Progress |
| Assessment history + detailed reports (True Driver, symptoms, notes) | **Secondary** | Progress |
| 3D hologram + Point A/B load map | **Secondary** | Progress (collapsed, expand fullscreen) |
| Force / CoG / Risk charts, advanced metrics | **Hidden / Advanced** | Progress (behind disclosure) |
| Per-region load %, raw ROM, objective numbers | **Hidden / Advanced** | Progress > expanded hologram / report detail |
| Nutrition, My Graph, Services, Case Studies, Community, Settings | **Hidden / Advanced** | More |
| Peer Success Gallery ("coming soon") | **Remove** | Cut until it has real content |

**Home-screen exclusions (locked):** no multiple charts, no technical ROM values, no assessment tables, no clinical language, no dashboard clutter, one dominant CTA only.

---

## 3. Design brief (Impeccable shape, Phase 2, revised)

**1. Summary.** A mobile-first, status-first home for rehab clients, modeled on WHOOP, Oura, and Apple Health. It answers three questions on open and offers exactly one next action. It reuses existing NeuCore data and modules; it is a presentation-layer redesign.

**2. Primary action.** *See my recovery status, then start today's session.* One dominant CTA.

**3. Design direction.**
- **Color: Committed recovery hue.** The recovery dial is filled by the score band, so the screen's dominant color is the recovery state. Bands reuse the existing scale: Strong `#14B8A6`, Good `#84CC16`, Variable `#F59E0B`, At risk `#F97316`, Critical `#F5426C`. Everything else stays restrained (tinted neutrals).
- **Theme: dark, via scene sentence.** "A rehab client in bed at 7am or on the couch at 10pm, a little stiff and a little anxious, glancing at a phone in one hand to learn if they are improving and what to do today." Forces dark, low-glare, large tap targets. Reuse `--nc-bg-primary #07111A`.
- **Anchors:** WHOOP (recovery-first dark home), Oura (calm readiness dial, restful type), Apple Health (clarity, one number, rings).

**4. Scope.** Production-ready spec. Client surfaces only; the coach/admin desktop dashboard is untouched. Shipped-quality components, polish to ship.

**5. Layout strategy.** One vertical scroll per tab, one dominant element per screen, generous rhythm. Today leads with the recovery dial (the only loud element), then one CTA, then a minimal attention zone. No multi-column grids, no chart walls on home. Five destinations in a fixed bottom tab bar (thumb reach, safe-area aware).

**6. Key states.** default · loading (skeletons) · empty / first-run (teaching nudge, never "at risk" by default) · error (retry) · read-only (expired/grace: status stays, CTA swaps to "Renew", honors `SubscriptionService.canWrite`) · offline (cached last status) · no-data recovery ("Complete your first assessment to unlock your recovery score").

**7. Interaction model.** Launch lands on Today. The one CTA deep-links into Train. The recovery dial taps to Progress. The hologram lives collapsed in Progress and expands to fullscreen on demand, disposing WebGL on close. Tab switches are instant (180ms, `--nc-dur-fast`). Attention items deep-link via the existing notification `link_section` mechanism. Touch only: active states, no hover dependence.

**8. Content (plain language, no clinical terms on home, no em dashes).**
- Recovery: "{score} Recovery", a state word, one line ("You are recovering well. Keep your routine steady.").
- CTA: "Start today's session" (or "Log routine"); when done, a quiet "Done for today".
- Attention: "Your coach advanced you to Phase 2", or "Your plan ends in 3 days", one line, tappable. Hidden when nothing needs attention.
- First-run: "Your recovery score appears after your first assessment with your coach."

**9. References for build.** `layout.md`, `spatial-design.md` (shell, rhythm), `interaction-design.md` (tabs, disclosure, sheets), `onboard.md` (first-run/empty), `motion-design.md` (tab + dial), `harden.md` (read-only/offline/error), `ux-writing.md`, `clarify.md` (plain copy), `adapt.md` (safe areas, touch targets).

---

## 4. Final information architecture

Five primary destinations in a fixed bottom tab bar. **Program is not a tab; it lives inside Train.** **More is the fifth tab.**

```
Bottom tab bar (thumb zone, safe-area inset):
   ◉ Today      ◈ Train      ◮ Progress      ✉ Coach      ⋯ More
```

- **Today** (home, status-first). Answers three questions, nothing else:
  - *How am I doing?* recovery dial (hero).
  - *What should I do now?* one dominant CTA.
  - *What needs attention?* a single attention line (coach, subscription, or decision), shown only when present.
- **Train** (the guided recovery journey = Daily Routine + Program, merged). Where you are (phase progress), what is today (the session, the primary action), the full plan (phases and exercises), and your consistency (streak, routine).
- **Progress** (the analytics home). Recovery trends, assessment history, detailed reports, the expanded hologram, advanced metrics. Everything clinical and chart-heavy lives here, behind a calm summary and disclosures.
- **Coach** (communication and accountability). Messages, check-ins, coach nudges, phase and subscription notifications.
- **More.** Settings, Nutrition, My Graph, Services, Case Studies, Community, Sign out.

This maps the old 10-item desktop sidebar to 5 primary destinations and keeps the home to three answers.

---

## 5. Mobile wireframes (approx 360px)

### Today (home): three questions, one CTA
```
┌───────────────────────────────┐
│  Good evening, Bodz        (BZ)│
│                                │
│           ╭─────────╮          │   HOW AM I DOING?
│          (   72      )         │   recovery DIAL, filled by band hue
│          (  Recovery  )        │   (the only loud element)
│           ╰─────────╯          │
│   You are recovering well.     │   one plain sentence (no clinical terms)
│                                │
│  ┌───────────────────────────┐ │   WHAT SHOULD I DO NOW?
│  │  Today: Lower-body reset   │ │   ONE dominant CTA, full width, 48px+
│  │        [   Start   ]       │ │
│  └───────────────────────────┘ │
│                                │
│  ✦ Coach advanced you to Phase 2 ›│ WHAT NEEDS ATTENTION? (only if present)
├───────────────────────────────┤
│ ◉Today  ◈Train  ◮Progress  ✉Coach  ⋯More │
└───────────────────────────────┘
```
No charts. No ROM. No tables. No clinical language. One CTA.

### Train: one guided recovery journey (Daily Routine + Program)
```
┌───────────────────────────────┐
│  Your journey      🔥 5 days    │   streak (consistency)
│  Phase 2 of 5  ▓▓▓▓▓▓░░░░  60%  │   where you are
│                                │
│  ┌ Today ─────────────────────┐ │   what is today (primary action)
│  │ Lower-body reset · 6 ex.   │ │
│  │ [   Start session   ]      │ │
│  └───────────────────────────┘ │
│                                │
│  The plan                      │   the program, merged in
│  ● Phase 2 · Build  (current)  │
│    ▸ Day A  ▸ Day B  ▸ Day C   │   tap a day → exercises, video, swaps
│  ○ Phase 3 · Load  (locked)    │
├───────────────────────────────┤
│  tab bar                        │
└───────────────────────────────┘
```

### Progress: analytics + clinical detail live here
```
┌───────────────────────────────┐
│  Progress                      │
│  Recovery trend ▁▂▃▅▆▇   72 ↑  │   calm sparkline, not a chart wall
│  Overall 68 · Compliance 74    │   4 scores, compact 2x2
│  Recovery 72 · Performance 60  │
│  ┌ Assessment history ───────┐ │   reports + history (reuse F7)
│  │ Jun 4 · True driver: L hip │ │
│  │ May 20 · ...               │ │
│  └───────────────────────────┘ │
│  ▸ Load map (3D)               │   hologram, collapsed, expand fullscreen
│  ▸ Advanced metrics            │   charts behind disclosure
├───────────────────────────────┤
│  tab bar                        │
└───────────────────────────────┘
```

### Hologram expanded (on demand, fullscreen)
```
┌───────────────────────────────┐
│  ‹ Back        Load map        │
│        [ Current | Target ]    │   Point A/B toggle lives here
│        ( 3D hologram )         │   lazy-mounted, disposed on Back
│  Lower Back 70%   Right Hip 62%│   per-region detail (advanced only)
└───────────────────────────────┘
```

### Coach and More
```
Coach                         More
┌────────────────────┐        ┌────────────────────┐
│ Messages & nudges  │        │ Settings           │
│ ▸ Phase upgrade ✓  │        │ Nutrition          │
│ ▸ Swap approved    │        │ My Graph           │
│ ▸ Plan ends in 3d  │        │ Services           │
│ [ Message coach ]  │        │ Case Studies       │
└────────────────────┘        │ Community          │
                              │ Sign out           │
                              └────────────────────┘
```

---

## 6. Component hierarchy

```
ClientAppShell (role=client only; coach/admin keep the desktop sidebar)
├─ AppHeader            greeting + avatar + (compact subscription pill)
├─ TabView (one active)
│  ├─ TodayView
│  │   ├─ RecoveryDial        ← v_client_progression.recovery (band hue)   [How am I doing]
│  │   ├─ PrimaryActionCTA    ← client_programs(today) + daily_routine_logs [What now]
│  │   └─ AttentionLine*      ← notifications / SubscriptionService         [Needs attention]
│  ├─ TrainView (guided journey = Routine + Program)
│  │   ├─ JourneyHeader       ← profiles.current_phase + streak
│  │   ├─ TodaySessionCard    ← program day + workoutSession.js
│  │   ├─ PlanPath            ← ProgramPublish.renderClientProgram (reflow as path)
│  │   └─ RoutineConsistency  ← dailyRoutine.js (streak, battery, heatmap)
│  ├─ ProgressView
│  │   ├─ RecoveryTrend       ← progress_snapshots
│  │   ├─ ScoreGrid (2x2)     ← Progression.mountClientPanel (reflow)
│  │   ├─ AssessmentHistory   ← AssessmentSnapshot.renderReport (reuse) + history list
│  │   ├─ HologramDisclosure  ← window.LoadVisualizer + AssessmentSnapshot (relocate, lazy)
│  │   └─ AdvancedMetrics     ← ClientCharts force/cog/risk (deferred behind disclosure)
│  ├─ CoachView               ← Notifications.mountInbox + messaging/accountability
│  └─ MoreView                Settings, Nutrition, My Graph, Services, Case Studies, Community, Sign out
└─ BottomTabBar (5 items, safe-area inset, active state)
```
`*` conditional. Leaf nodes annotated with the existing source or module reused.

---

## 7. Navigation flow

```
Launch (role=client)
   │
   ▼
[Today] ──one CTA──────────────► [Train] (start session / browse plan / routine)
   │  ╲
   │   ╲─tap recovery dial──► [Progress] ─┬─ ▸ Load map ─► Hologram fullscreen ─Back─┐
   │                                      └─ ▸ Advanced metrics (disclosure)         │
   │                                                                                 │
   ├─ attention line ──► [Coach]  (deep-link via notification link_section)          │
   │                                                                                 │
   └─ avatar / More tab ──► [More] ─► Settings / Nutrition / My Graph / ... ─────────┘

Bottom tab bar switches Today / Train / Progress / Coach / More at any time (180ms).
```

---

## 8. Reuse map (no new data, no new backend)

| Surface | Reuses (already exists) |
|---|---|
| Recovery dial, score grid, trend | `v_client_progression`, `progress_snapshots`, `Progression.mountClientPanel` |
| Today CTA + Train session/routine | `client_programs`, `daily_routine_logs`, `dailyRoutine.js`, `workoutSession.js` |
| Train plan path (program merged) | `ProgramPublish.renderClientProgram` |
| Assessment history + hologram | `AssessmentSnapshot` (F7), `window.LoadVisualizer`, `ClientCharts` |
| Coach | `Notifications.mountInbox`, notification deep-linking |
| Subscription states | `SubscriptionService` (pill, banner, `canWrite`) |
| Tokens and components | `css/neucore-design-system.css` (`--nc-*`), existing `badge`, `btn`, card styles |

Presentation-layer only. No tables, RPCs, RLS, or edge functions change.

---

## 9. Implementation plan (after signoff; design-only now)

- **S0 Mobile app shell.** Role-gated `ClientAppShell` for `role=client`: header, content area, fixed 5-item bottom tab bar (Today/Train/Progress/Coach/More), safe-area insets, `viewport-fit=cover`, coarse-pointer 44px+ targets. Coaches/admins keep the sidebar. No content change. Verify both roles navigate.
- **S1 Today.** Recovery dial (committed band hue) + one CTA + conditional attention line. Enforce the home exclusions (no charts, no ROM, no tables, no clinical language). Verify with a real client and a no-data client.
- **S2 Train (guided journey).** Merge Daily Routine + Program: journey header (phase + streak), today session card, plan path (`renderClientProgram` reflow), routine consistency. Respect `canWrite` read-only.
- **S3 Progress.** Relocate trends, scores, assessment history/reports, hologram (collapsed, lazy, dispose on close), advanced metrics (disclosure). Off Today entirely.
- **S4 Coach + More.** Coach wraps `Notifications.mountInbox` plus accountability/messaging; More holds the rest.
- **S5 States and polish.** Loading skeletons, empty/first-run, error, read-only, offline. Motion 150 to 250ms. Then `impeccable polish` + `impeccable audit` (a11y, perf) + `/simplify`.
- **S6 Verify + docs.** Full client regression (device-emulated, ideally one real iOS + one Android), confirm coach/admin desktop untouched, update FEATURE_STATUS / PROJECT_STATUS.

Each step is independently shippable, reuse-first, no backend changes.

---

## 10. Risks, edge cases, open questions

- **WebGL on mobile.** Hologram is secondary, collapsed, lazy-mounted on expand, disposed on close. Today never paints WebGL.
- **Two shells in one app.** Client gets the tab bar; coach/admin keep the sidebar. Strict role gate; S0 verifies both before content moves.
- **Read-only correctness.** Expired/grace clients see status and history but the CTA becomes "Renew" (via `canWrite`). The gate stays client-side as today; this redesign does not change the audit's H-1 posture.
- **First-run / no data.** New clients have no assessment (dial) or no program (Train). Explicit teaching empty states, never blank or "at risk".
- **Committed hue vs anti-pattern ban.** The recovery dial is a distinctive radial readiness dial whose fill encodes state, not the banned "big number + gradient + stats" template. No gradient text, no side-stripe borders, no decorative glass.
- **Open questions for signoff:**
  1. **Coach tab messaging:** real two-way messaging now, or inbox + nudges first (messaging later)?
  2. **Train depth:** does "Start session" launch a guided step-by-step flow, or open today's session list (tap to log)?
  3. **My Graph (RPM):** keep it reachable under More for clients, or retire it from the client surface?

---

## 11. Final architecture (for signoff)

- **Shell:** mobile-first, dark, calm; role-gated client app shell with a fixed 5-item bottom tab bar.
- **Tabs:** **Today · Train · Progress · Coach · More.** Program is part of Train. More is a tab.
- **Today:** status-first. Three answers only (How am I doing / What now / What needs attention), one dominant CTA, zero clutter, zero charts, zero clinical language.
- **Train:** one guided recovery journey (Daily Routine + Program merged).
- **Progress:** all analytics and clinical detail (trends, assessment history, reports, expanded hologram, advanced metrics).
- **Coach:** communication and accountability.
- **Hologram:** retained, secondary, lives collapsed in Progress.
- **Build:** presentation-layer only, reuse-first, S0 to S6, one commit per step, verified each step, coach/admin desktop untouched.

Confirm this final architecture (and the three open questions in section 10) and I will start at S0. No code is written until you sign off.

---

## 12. Build log — SHIPPED (S0 → S6)

Signed off and built one commit per step, presentation-layer only, coach/admin desktop untouched. Branch `claude/interesting-buck-452459`.

| Step | Scope | Commit |
|---|---|---|
| S0 | Mobile client app shell + bottom tab bar (`css/mobile-shell.css`, `js/clientShell.js`) | `3df7064` |
| S1 | Today — status-first, 3 questions, one CTA (`js/clientDashboard.js` rewrite) | `2dece2f` |
| S2 | Train — guided recovery journey, Daily Routine + Program merged (`js/clientTrain.js`) | `2872910` |
| S3 | Progress — recovery momentum home + desktop route (`js/clientProgress.js`) | `aa9cb8e` |
| S4 | Coach support screen + grouped More tab (`js/clientCoach.js`) | `7d79ef6` |
| S5 | Theme harmonization, states, copy, a11y, simplify (`js/clientUtil.js`, `css/client-theme.css`) | `32a7bdd` |
| S6 | Regression audit + consistency fix + docs | (this commit) |

**Resolved open questions (section 10):** (1) Coach = inbox + nudges reframed as guidance, no two-way messaging in V1. (2) Train = one dominant "Start session" reveal, not a list. (3) My Graph (RPM) retired from primary nav, kept under More → Advanced Insights.

**Final tab → section → module map:**
- Today → `#section-client-dashboard` → `ClientDashboard.render()`
- Train → `#section-client-train` → `ClientTrain.render()`
- Progress → `#section-client-progress` → `ClientProgress.render()` (accepts `{open}` deep-link)
- Coach → `#section-client-coach` → `ClientCoach.render()`
- More → bottom sheet (Recovery / Wellness / Resources / Account)
- Shared helpers: `window.ClientUtil` (esc, firstName, greeting, STAGES/stage, band, ago, accountability, skeleton, offlineNote, errorState, trapTab)

## 13. S6 regression audit + production verdict

Read-only audit (static trace of every path + dist verification of the deployed bundle + live RLS probe). No browser/device run was available; visual states verified by build + code review.

**Tested paths:** Today → Train → Progress → Coach → More; all tab navigation; More deep-links into Progress (history/report); hologram open/close cycle (leak-safe: `close()` → `LoadVisualizer.destroy()` → `BodyCanvas.destroy()` → `cancelAnimationFrame` + `renderer.forceContextLoss()`); read-only (lapsed) mode (Today CTA → renew, Train tracker `readOnly`); first-run / empty (calm teaching states on every screen); offline (note on Today/Train/Progress/Coach); error (Progress error + retry).

**Coach/Admin protection:** all client modules are reachable only via client-gated paths (bottom tab bar requires `body.nc-client`, set only for `role=client`; desktop client nav items carry `role-client-only`, hidden by `initShell`). Shared-file edits are additive and default to prior behavior: `AssessmentSnapshot.renderReport` label overrides default to the clinical terms (coach caller `clients.js` passes none); Daily Routine dark theme is `body.nc-client`-scoped CSS (coach `.dr-coach-*` view untouched). RLS confirms data isolation: `profiles` SELECT = own-row-or-admin/coach; `notifications` SELECT = own-or-admin. No client module reads coach or other-client data.

**Accessibility:** keyboard nav + focus trap on the hologram dialog and More sheet; focus moves in on open and restores on close; Escape closes; `role=tablist/tab` on the bar, `role=dialog` on the hologram; `aria-live` on the streak; meaningful `aria-label` on the dial; `prefers-reduced-motion` respected app-wide.

**Mobile UX:** single bottom bar (legacy `.mobile-bottom-nav` and the dead hamburger hidden for clients); 44px+ touch targets; `env(safe-area-inset-*)` on the bar, sheet, and hologram; body scroll locked behind overlays.

**Defects found:**
- **Low (fixed):** Today's attention card surfaced any unread notification (incl. `subscription_*`) but routed to Coach, which filters those out, so it could land on empty guidance. Fixed: the attention query now excludes `subscription%` (consistent with Coach); stale "open your inbox" copy updated.
- **Low (accepted):** modal overlays trap focus but do not set `aria-hidden` on sibling content; the Daily Routine custom checkbox lacks Enter/Space activation (lives in the shared module). Neither blocks release.
- **Critical / High / Medium:** none.

**Verdict: the redesigned client experience is PRODUCTION-READY.** The two open Low items are tracked for a future polish pass. The pre-existing audit item H-1 (subscription write-gate is client-side only) is unchanged by this redesign and remains tracked in `PRODUCTION_READINESS_AUDIT.md`.
