# UI / UX / Identity & Stabilization Plan — AST9 Health Hub

**Status:** PLANNING ONLY — no implementation, no CSS changes, no redesign, no RLS/data changes performed.
**Date:** 2026-06-10 · **Branch:** `claude/interesting-buck-452459` (`e50b127`, 2 commits ahead of `main`, unpushed) · **Production:** `main` = `6312fe7`, Pages deploy green, F8 S1–S3 + Option B coach scoping live.
**Operating under:** `AI_WORKFLOW_GUARDRAILS.md` · ADRs in `ArchitectureDecisionRecords.md` (001–015) · locked rules in `PROJECT_STATUS.md §1.2`.

**Ground truth inputs:** live source scan (`js/*`, `app.html`), live DB policy inspection, the FITXPERT dashboard reference screenshot, and the provided CSS reference file. Every bug in §5 was verified against actual code (file:line cited) — three items are flagged "needs live repro" where the code alone doesn't prove the symptom.

---

## 1 · Current UI/UX Audit

### 1.1 Landing page (`index.html`)
Legacy AST9-era marketing shell (deliberately untouched per PROJECT_STATUS §1.1). Dark, Three.js hero, separate visual language from the app. Serves as the unauthenticated bounce target. **Verdict:** functional but brand-inconsistent with where the product is going; lowest-risk surface to redesign last (Phase F) since nothing in the app depends on its internals.

### 1.2 Coach/Admin dashboard (`app.html` `#section-dashboard`)
Dark sidebar shell, 24 stacked `.section` blocks, role-class CSS gating. Coach home = 4 stat cards + Recent Sessions + Recent Clients. Functional, but: dense, low whitespace, mixed card styles accreted over F1–F8, no consistent elevation/spacing rhythm, topbar minimal (bell hidden in sidebar footer — TD10 history). **Verdict:** the primary redesign target (Phase D).

### 1.3 Client mobile experience (`body.nc-client`, 5-tab shell)
The strongest surface today: Today / Train / Progress / Coach / More, calm dark design, status-first Today with Recovery Pulse card (F8 S2), CX1 day-based Train. Already follows "one question per screen" rhythm. **Verdict:** keep the architecture; it migrates to the new identity (brighter premium) rather than being restructured.

### 1.4 Assessment / hologram (`#section-new-session`, `bodyMap3D.v2.js`, F7)
Coach-driven tabbed wizard (Info → Subjective → Objective → Reactive Graph → Generate) with the Three.js skeleton boxed inside a fixed card/canvas container. Functionally complete (F7 verified), visually a "form with a 3D widget in a box." **Verdict:** the highest-ambition redesign target (Phase E — storytelling flow, free-floating hologram).

### 1.5 Train flow (client)
**Already day-based** — CX1 replaced the stacked render: `clientTrain.js:145-147` "the old stacked render is replaced by ClientProgram (day cards → day detail → guided execution)", with an express path from Today. Guided execution + rest timer + per-set checkoff shipped and smoke-verified (52/52). **What's actually missing vs. the request:** a *dedicated* single-day page feel (today it's an inline reveal), an explicit **Cancel Workout** action in the execution UI, and a more card-like day switcher. `WorkoutSession.abandon()` already exists (F2 data layer, auto-abandon proven via the one-active-per-client constraint) — cancel is a **UI surfacing task, not a data-model task**, and logs/history stay intact because `abandon` is a status transition, not a delete.

### 1.6 Generation flow (coach)
`ProgramPublish` editor + review renders **all generated days stacked vertically** in one scroll (the complaint is real on the coach side). The client side was fixed by CX1; the coach review/editor was not. **Verdict:** Phase C target — same day-card pattern, coach flavor.

### 1.7 Notifications / messages
Two separate unread systems, both with verified defects — see §5 (B1–B3). Inbox UI itself is functional but utilitarian.

### 1.8 Subscriptions / client management
Coach/admin table UIs exist; **no client edit UI exists at all**, **no client delete UI exists** (only `removeCoach` is wired to `delete-user`), **no subscription edit exists**, and `Subscriptions.remove()` produces a **fake success toast** (verified — §5 B5). 

### 1.9 Graph page (RPM builder)
`rpm/graph-builder.js` — rich builder with AI generate + fallback ladder. The reported "Generate throws error" needs live repro (§5 B7) — the handler has try/catch + fallback, so the visible error likely comes from the edge-function call (`generate-program` auth/key) or a `RPMGraph.update`/RLS failure.

### 1.10 Recovery Pulse UI (F8)
Client card + coach Needs Attention panel — shipped, authenticated-smoke-verified, calm and consistent. **Verdict:** keep as-is; restyle tokens only in Phase D; the CSS reference's glass/active-state ideas apply naturally here.

---

## 2 · Reference Dashboard Analysis (FITXPERT screenshot)

**Borrow (structural ideas only):**
- **Bright canvas + dark anchored sidebar** — clear figure/ground; icon+label vertical nav with a single active accent.
- **Topbar organization** — search (with kbd hint), primary "Create New" action, notification cluster, profile identity block (name / role / org).
- **Whitespace + card rhythm** — generous gutters, equal-radius white cards, one KPI visual (donut) + supporting list pattern.
- **Onboarding checklist** as a first-run dashboard widget (maps well to coach onboarding H8).
- **Status-breakdown donut** (Active/On hold/Expired/…) — maps directly to our `v_client_subscription_state` + pulse severity mix.
- **Modular card grid** — independent cards (birthdays ≈ our "Needs Attention" / "Today's plans" ≈ our session feed).

**Do NOT copy:** the yellow/purple palette, the logo, exact component geometry, the literal layout grid, the WhatsApp/help floaters, or any brand voice. FITXPERT reads "friendly fitness CRM"; AST9 must read "premium clinical-performance system."

**How AST9 evolves beyond it:** FITXPERT is static data presentation. AST9 adds (a) the Recovery Pulse triage worklist as the dashboard's *living* centerpiece, (b) the hologram/anatomy thread as a brand-unique visual, (c) motion depth (glass layering, springy active states from the CSS reference) FITXPERT lacks, and (d) a story-driven assessment flow no CRM has.

---

## 3 · CSS Reference Analysis

What the reference file actually contains (verified by reading it), and where each idea fits:

| Idea (from the CSS) | Mechanism | Where it fits in AST9 |
|---|---|---|
| **Glass card system** | `backdrop-filter: blur(15px)` + translucent fills (`#cceef122`) + `drop-shadow` | Recovery Pulse cards, dashboard KPI cards, assessment floating panels |
| **Gradient hairline borders** | `::after` with `linear-gradient` border-box + `mask-composite: exclude` | Premium card edge language everywhere (replaces flat 1px borders) |
| **Token opacity scale** | `color-mix(in oklab, var(--color-fg), transparent N%)` → `--color-fg10…90` | The new design-token system (§4) — one accent + one fg/bg pair generates the whole neutral ramp |
| **Springy active pill** | absolutely-positioned `#active` + blurred `#shadow` sliding with `cubic-bezier(.5,1.3,.7,1.1)` | Tab bars (client shell), day-switcher (Train/Generation), sidebar active state |
| **iOS hover decay** | `@keyframes iosHoverOver` background fade-out | Button/row hover language (subtle, alive) |
| **Hero + feed layering** | fixed blurred hero, horizontal card feed, `pin-spacer` scroll choreography | **Assessment storytelling** (anatomy-zone "feed" of sections), landing page hero |
| **Image de-grayscale reveal** | `filter: grayscale(1) blur(4px)` → `grayscale(0)` on hover | Case studies / peer gallery / exercise cards |
| **Stroke-outlined numerals** | `-webkit-text-stroke` transparent fill | Day numbers on workout day cards, phase numbers in assessment |
| **Vertical writing-mode labels** | `writing-mode: vertical-rl` date rail | Assessment section rails, day-detail header |
| **Responsive radius collapse** | `--border-radius: 0` under 768px | Mobile full-bleed card behavior |

**Not for direct reuse:** the dark `#2f2a23` palette (we're going brighter), the fixed-viewport feed layout as a dashboard (it's editorial, not operational), `padding-top: 100vh` body hack, Roboto (see §4 typography).

**Primary application target:** the assessment storytelling flow (Phase E), where hero-layering + glass + scroll choreography are exactly the right vocabulary; secondary: dashboard motion (Phase D) and pulse cards.

---

## 4 · New AST9 Visual Identity (direction to be ratified before Phase D)

**Personality:** brighter · premium · trustworthy · futuristic · alive · medically clean · emotionally engaging.

- **Color palette (proposal):** Porcelain canvas `#F7F9FB` / card white `#FFFFFF`; ink `#0E1726` (text); **primary accent: deep clinical teal `#0E7C7B`→`#14B8A6` gradient range** (continuity with the existing teal so the migration can be incremental); secondary accent: recovery amber `#F59E0B` (kept for at-risk semantics); hologram cyan `#67E8F9` reserved for 3D/anatomy moments; status ramp unchanged semantically (teal=good, gold=watch, amber=act, slate-blue=regressing) so F8 meaning survives recoloring. Dark mode retained as a *secondary* theme (client evening use), generated from the same tokens.
- **Tokens:** adopt the CSS reference's `color-mix` scale — `--fg`/`--bg`/`--accent` + generated 10/20/40/60/90 transparency steps; all components consume tokens, never literals. This is the single most important refactor enabler: identity becomes a token swap, not a rewrite.
- **Typography:** display = a geometric-humanist sans with medical credibility (candidates: **Inter Display / Geist / General Sans**) + the same family for UI at text sizes; tabular numerals for KPIs. One family, two optical roles — no font zoo.
- **Spacing system:** 4px base grid; card padding 20/24; section gutters 24/32; max content width per panel; consistent `--radius-card: 16–20px` with mobile collapse.
- **Elevation:** 3 tiers — flat (lists), raised (cards: soft wide shadow, no hard borders), floating (modals/hologram panels: glass + gradient hairline). 
- **Motion system:** two easings only — `cubic-bezier(.5,1.3,.7,1.1)` (springy, for active states/pills) and a 200–300ms ease-out (for everything else); `prefers-reduced-motion` honored globally; no scroll-jacking outside the assessment flow.
- **Card language:** white raised cards on porcelain; glass reserved for "alive" surfaces (pulse, hologram, assessment); gradient hairline only on floating tier.
- **Sidebar language:** dark ink rail (anchors the brand), icon+label, springy active pill, role-gated groups with real section dividers; collapses to the existing client bottom-tab shell on mobile (client shell already solves this — don't duplicate).
- **Dashboard language:** topbar = search / create / notifications / identity; content = greeting + "what needs you now" (Needs Attention panel promoted), KPI row (donut: subscription/pulse mix), feed cards.
- **Interaction/button language:** one primary (filled accent), one secondary (ghost), one destructive (outline rose, confirm-gated); buttons never fake success (§5 B5 rule: every write checks `error` before toasting).
- **Logo:** see §9.
- **Responsiveness:** mobile-first for client; desktop-first for coach; the token + radius-collapse system from the CSS reference handles the boundary.

---

## 5 · Stabilization Roadmap (verified bug inventory)

Each item was **verified against current code**; root cause cited. Classification: severity / layer.

| ID | Bug (as reported) | Verified root cause | Severity | Layer |
|---|---|---|---|---|
| **B1** | Unread badge doesn't clear; icon stays; "Mark all read" appears broken | `notificationsService.js:91-95` — `unreadCount()` is **missing `.eq('recipient_id', uid)`**. RLS lets **admins** see all rows, so the badge counts *every user's* unread; `markAllRead()` (line 110-114, correctly scoped to own uid) then can't ever zero it. Coaches/clients are RLS-capped so they're unaffected — this bites exactly the admin account the user tests with. One-line fix + the F8 test fixtures' notifications currently inflate the count. | **Critical (admin UX)** | UI-only (1 line) |
| **B2** | Messages from clients remain unread | `community.js:63-66` marks thread messages read on open (works), but the sidebar `badge-community` is refreshed **only once at login** (`app.html _showApp` setTimeout → `_refreshCommunityBadge()`); never after reading a thread. Badge is stale, not the data. | Medium | UI-only |
| **B3** | Notification icon stays visible after viewing | Same family as B1/B2: bell badge subscribes to `_unread` which only refreshes via `unreadCount()` (poll = 60s); plus inbox `markRead` on open-item does call `unreadCount()` but the **admin overcount** (B1) keeps it non-zero. Fixing B1 + a refresh-on-section-open resolves it. | Medium | UI-only |
| **B4** | Cannot delete / edit client | **Verified absent**: `clients.js` has `removeCoach()` (line 288, wired to admin-gated `delete-user` edge fn) but **no `removeClient` and no edit-client UI/function at all**. Edge fn + `enforce_profile_protected_columns` already support both safely — this is missing UI + a decision on who may delete (admin-only per `delete-user`'s gate) and which fields are coach-editable (non-protected columns only). | High | UI + uses existing edge fn |
| **B5** | Cannot edit/delete subscription; fake success toasts | **Verified**: `subscriptions.js:252-258` `remove()` ignores the result — `await sb.from('subscriptions').delete()...; Dashboard.toast('Subscription deleted')`. RLS `subscriptions_admin_write` (ALL = `is_admin()`) means a **coach's delete silently affects 0 rows → success toast anyway**. No edit-dates function exists. Fix = check `error`+`count`, decide coach permissions (likely: coach may not delete; admin may; edits via a proper update path), add edit modal. | High | UI + RLS-aware (no policy change required) |
| **B6** | Coach panel/table day-to-day | (not reported, logged) `clients.js` Clients table for coaches still shows all clients via global `profiles` — known deferred Option A; **not** in this plan's scope. | — | tracked `task_3b9f5d24` |
| **B7** | Graph "Generate" throws error | **Needs live repro.** `graph-builder.js:236-310` has try/catch + NeuCore-ladder fallback, so a *thrown* error suggests: (a) `generate-program` edge fn 4xx/5xx (auth/key/quota), (b) `RPMGraph.update`/`savePhases` RLS failure (`rpm_graphs.coach_id` FKs `auth.users` — legacy), or (c) the "not signed in" guard (line 249). Repro as coach in prod, capture console + edge logs, then scope the fix. | High (blocks RPM) | Needs diagnosis (UI or edge) |
| **B8** | Generated workouts stacked vertically (coach) | **Verified**: client side fixed by CX1; the **coach `ProgramPublish` review/editor** still renders all days in one stack. Phase C redesign. | Medium | UI-only |
| **B9** | Client train: dedicated day page + Finish/Cancel | **Verified partial**: day cards + guided flow + Finish exist (CX1); **Cancel is not surfaced** though `WorkoutSession.abandon()` exists and is log-safe (status transition; history intact). Phase C. | Medium | UI-only |

**Classification rollup:** Critical: B1 · High: B4, B5, B7 · Medium: B2, B3, B8, B9. Architectural: none (deliberately — all fixes ride existing architecture). Backend-linked: B7 (possibly edge), B4/B5 (existing edge fn / RLS-aware UI). Everything else UI-only.

---

## 6 · Program / Train UX Architecture (Phase C design)

**Shared day-navigation system** (one component, two flavors):
- `DayNav` — horizontal card rail: `Daily Routine` card + `Day 1…N` cards (stroke-numeral from §3, completion tick, est. duration). Springy active pill underneath (CSS-reference pattern). Keyboard/swipe navigable.
- **Client flavor (Train tab):** rail → tapping a day opens a **dedicated day screen** (full-bleed section, not inline reveal): day header (vertical rail label), exercise list, one primary CTA (`Start workout` → guided execution). Guided execution gains a visible **Cancel workout** (secondary, confirm dialog → `WorkoutSession.abandon()` → returns to day screen; history shows "abandoned" as today). Finish flow unchanged.
- **Coach flavor (Generation/Review):** same rail above the editor; selecting a day shows only that day's warmup/main/cooldown editor; "all days" overview list collapses to summaries. Publish flow unchanged (immutable JSON rule §1.2-bis preserved — this is render-only).
- **Routine/workout separation:** Daily Routine is the rail's first card with its own check-in screen (existing `dailyRoutine.js` mount) — never mixed into workout day lists.
- **Mobile-first:** rail = horizontal scroll snap on mobile, grid on desktop. No new data, no schema, no write-path changes; `Auth.canWrite()` gates untouched.

---

## 7 · Assessment Storytelling Architecture (Phase E design)

**Goal:** from "form with a 3D widget in a box" to a guided, cinematic body journey.

- **Free-floating hologram:** remove the canvas card chrome; the skeleton renders against a soft radial-gradient void (no visible container), fixed/floating layer behind glass content panels (the CSS reference's `#bgWrapper` + hero-layer pattern). The existing `BodyMap3D` instance is *re-homed*, not rewritten (ADR-004/011 preserved: one glTF, cached).
- **Anatomy-zone storytelling:** the assessment becomes a vertical journey of **floating glass sections** (one zone per section: spine → hips → ankles → shoulders → neurology…); as the coach scrolls/advances, the hologram rotates/zooms to the active zone and the zone highlights. The existing 13-aim structured wizard fields are preserved — they're *re-staged*, one zone at a time, not re-modeled.
- **Progressive cards:** each zone = question cluster + live score chip; completing a zone animates it into a "completed" rail (feed pattern from the CSS reference) building visible progress.
- **Transitions:** camera tweens (existing Three.js controls) + section crossfade; the two easings from §4 only; `prefers-reduced-motion` → instant cuts.
- **Coach/client journeys:** coach = full assessment (this flow); client = read-only "your body story" replay of results on the Progress tab (later slice, reuses the same sections).
- **No data-shape change:** writes go to the same `assessments`/`rehab_objective_assessments`/`body_map_states` rows; this is presentation + choreography. Generate step stays at the end (RPM graph untouched).
- **Phasing within E:** E1 hologram un-boxing → E2 zone navigation + camera choreography → E3 glass section restage → E4 completed-rail + polish. Each independently shippable.

---

## 8 · Dashboard Redesign Strategy (Phase D design)

- **Sidebar:** dark ink rail, grouped (Care: Dashboard·Clients·Sessions·Programs / Engage: Community·Notifications / Business: Subscriptions·Reports / Admin: Coaches·Approvals), springy active pill, existing `role-coach-admin`/`role-admin-only` gating preserved verbatim.
- **Topbar:** client search (`⌘K` later), Create New (session/client/subscription), bell (fixed by Phase B) + profile identity block.
- **Content order (coach):** 1) greeting + **Needs Attention panel promoted to hero position** (F8 S3 is the centerpiece, restyled not rebuilt), 2) KPI row — donut of `v_client_subscription_state` statuses + pulse-severity split, sessions-this-week, active clients, 3) Recent sessions / recent clients as feed cards, 4) first-run onboarding checklist (borrowed FITXPERT idea) for new coaches.
- **Notifications redesign:** inbox restyle (cards, severity accents) on top of the Phase B correctness fixes; bell moves to topbar.
- **Recovery Pulse integration:** pulse severity colors keep semantic continuity (§4); panel actions unchanged (View Recovery / Nudge / Reactivate — all verified paths).
- **Responsiveness:** ≥1280 two-column grid; 768–1280 single column; <768 coach view remains desktop-oriented (explicitly out of scope to mobile-optimize coach in D).
- **Token migration strategy:** Phase D starts by introducing the token sheet + restyling the dashboard section only; other sections inherit tokens progressively in later phases — **no big-bang restyle** (regression containment).

---

## 9 · Logo Redesign Direction (direction only — no design work yet)

- **Symbolism:** the mark should fuse **a pulse/waveform** (recovery, the product's heartbeat metric) with **a spinal/vertebral abstraction** (the anatomical anchor) — one continuous stroke that reads as both. Avoids cliché dumbbells/crosses; encodes "measured recovery."
- **Geometric direction:** single-weight continuous line, built on the same 4px grid; works as pure line (light contexts) and knocked-out-of-accent tile (app icon).
- **Premium cues:** generous clearspace, one-color discipline (ink or accent, never gradients in the mark itself), optical corrections over mathematical purity.
- **Color compatibility:** must hold in ink `#0E1726`, white, and accent teal — and against the hologram cyan backdrop.
- **Motion compatibility:** the continuous stroke is **draw-on animatable** (SVG stroke-dashoffset) for loading states and the assessment intro; the pulse segment can "beat" subtly as the live-status indicator.
- **Favicon/system icon:** the pulse-vertebra node reduces to a 16px glyph (test at 16/32 before ratifying).
- **Hologram integration:** the mark's line language matches the skeleton's edge rendering, so the logo can materialize from/into the hologram in the assessment intro.
- **Mobile-app icon readiness:** tile version = glyph on accent, 1024px master, no text.
- **Sequencing:** ratify direction → commission/iterate the mark in Phase F alongside the landing redesign (the app consumes it last to avoid double-churn).

---

## 10 · Phased Execution Plan

> Every phase: one approval gate before start, guardrails §1–§10 apply, one focused commit series, stop-and-report after. Phases are ordered so **correctness precedes beauty**.

| Phase | Scope | Risk | DB impact | Auth/RLS impact | Rollback | Verification | Guards |
|---|---|---|---|---|---|---|---|
| **A — Critical stabilization** | B1 (unreadCount recipient filter), B3 (badge refresh on inbox open), B7 (diagnose Graph Generate live → scoped fix) | Low–Med | None expected (B7 *may* touch an edge fn — if so, architecture-gate first) | None | git revert (JS-only); edge fn redeploy of prior version if B7 lands there | `node --check`, build, badge smoke as admin+coach+client, Graph generate repro before/after, console-clean | clean-code-guard |
| **B — Notifications + management fixes** | B2 (community badge refresh), B4 (client edit modal — non-protected fields; client delete admin-gated via existing `delete-user`), B5 (subscription edit + honest delete with error/count checks + role-correct visibility) | Med | None (uses existing edge fn, existing RLS; **no policy changes**) | Touches user-management flows → **architecture-gated: present exact modal/permission design first** | git revert; no data migrations | build + smoke per role (coach cannot delete sub; admin can; edit persists; deletes confirm-gated), fake-toast regression test, RLS impersonation re-check | clean-code-guard |
| **C — Program/Train UX** | §6: DayNav component, coach day-based review (B8), client dedicated day page + Cancel workout (B9) | Med | None (render-only; `abandon()` exists) | None (`canWrite` gates preserved) | git revert | build + headless smoke (day nav, start/finish/cancel, abandoned-history intact, express path from Today), F8 card regression | clean-code-guard |
| **D — Dashboard redesign** | §8 + §4 token system introduction (dashboard scope only) | Med | None | None (role-class gating preserved verbatim — explicit regression item) | git revert per slice (tokens → sidebar → topbar → content as separate commits) | build + visual smoke all 3 roles, role-leak check (client sees no coach nav), F8 panel regression, console-clean | clean-code-guard |
| **E — Assessment storytelling** | §7 E1–E4 | Med–High (largest UI surface) | None (presentation only; same writes) | None | git revert per E-slice; E1 independently revertible | build + full assessment walkthrough as coach (all 13 aims persist), generated program unchanged for same inputs, 3D perf check (fps), reduced-motion check | clean-code-guard |
| **F — Landing + identity/logo** | landing rebuild on new identity; logo finalization; favicon/app icons | Low | None | None (landing is unauthenticated) | git revert; old landing kept until cutover commit | build + prod smoke (landing 200, login path, redirects), Lighthouse pass | clean-code-guard + docs-guard (brand docs) |
| **G — Motion/polish/a11y** | hover/active language rollout, focus states, contrast audit, `prefers-reduced-motion`, bundle-size follow-up | Low | None | None | git revert | build + axe/contrast audit, keyboard-nav smoke, perf budget | clean-code-guard |

**Standing exclusions (all phases):** no referrals · no Feature 9 · no S4 alerts · no global `profiles` RLS change (tracked separately) · no F8 behavior change · no SubscriptionService/`canWrite`/`notify()`/RLS bypass · no destructive ops without approval.

**Dependencies:** A → B (same modules) → C ∥ D (independent) → E (needs D's tokens) → F → G. The Option A profiles hardening (`task_3b9f5d24`) should land **before any real coach onboarding**, ideally between B and C — separate approval gate, not part of this plan.

---

## Verification discipline (applies to every phase)

1. Mechanical first: `node --check` every changed file → `npm run build`.
2. Browser smoke (headless harness pattern in `.smoke-d079a9f/`) + per-role checks (admin/coach/client) + console/page-error zero-tolerance (benign three.js 404s excepted).
3. RLS impersonation re-verification whenever a phase touches anything RLS-adjacent (B only, expectedly).
4. Guard-skills in order: mechanical → architecture → AI-failure-mode → regression. Fix only real findings; no invented cleanup; no refactors of stable systems without cause.

---

*Planning document only. Nothing implemented. Awaiting approval of: (1) the §4 identity direction, (2) the §10 phase order, (3) Phase A start.*


---

# ADDENDUM (2026-06-10) — Phase A results + Phase B foundation + execution rules

## A. Stabilization status update (§5 table)

| ID | Status |
|---|---|
| B1 unread badge / mark-all-read | ✅ **FIXED** (`ac00769`) — `list()` + `unreadCount()` now recipient-scoped |
| B2 community badge stale | ✅ **FIXED** (`ac00769`) — badge re-syncs on thread open (desktop + client Coach tab) |
| B3 icon stays after viewing | ✅ resolved by B1+B2 |
| B7 Graph Generate error | ✅ **FIXED** (`6fe62a7`) — live repro found **registered-but-never-applied** `rpm_phase5` migration: `rpm_phases.target_regions` + `rpm_phase_messages` missing from the live DB; every save failed. Contents applied (additive), rollback paired. Note: `rpm-ai-suggest` runs in honest `no_api_key` fallback mode (clinical default ladder) — configuring the AI key is a product decision, not a bug. |
| B4 client edit/delete · B5 subscription edit/delete | ⏸ open — architecture-gated (user-management flows); design to be presented before implementation |
| B8 coach stacked generation · B9 client day page + Cancel | → Phase C (in progress this session) |

## B. Identity foundation — as implemented (Phase B)

- **Token home:** `css/neucore-design-system.css` (`--nc-*` is the single namespace; the legacy `--*` tokens in `styles.css` are frozen — migrate consumers opportunistically, never duplicate).
- **Added:** `color-mix` brand opacity ramp (`--nc-fg-05…90`, `--nc-accent-10…40`), semantic elevation aliases, glass recipe tokens + `.nc-glass` / `.nc-glass--hairline` utilities (gradient hairline via mask-composite), springy `--nc-ease-bounce`, `--nc-focus-ring`, reduced-motion collapse of duration tokens.
- **Bright premium theme:** fully defined under `body.nc-bright` (porcelain `#F7F9FB` canvas, ink `#0E1726`, white cards, soft ink shadows). **Applied to nothing yet** — Phase D opts the coach/admin shell in. Client mobile shell keeps its calm dark theme by design.
- **Typography decision (supersedes §4 candidates):** keep **Space Grotesk (display) + Inter (body)** — already premium, already shipped, zero migration cost. No font change.

## C. Motion / interaction rules (binding)

1. Two easings only: `--nc-ease` (default) and `--nc-ease-bounce` (active pills/day rails/tabs). `--nc-ease-spring` stays for existing scale-ins.
2. Three durations only: `--nc-dur-fast/base/slow`. No literal ms values in new CSS.
3. Motion communicates state change — never decoration loops (exception: spinners, the pulse "beat").
4. Hover = translateY(-2px) + shadow tier upgrade (existing `.neu-card--interactive` language). No scale-on-hover.
5. Scroll choreography allowed **only** inside the Phase E assessment flow.
6. Everything honors `prefers-reduced-motion` via the token collapse.

## D. Accessibility rules (binding)

1. Every interactive element gets a visible `:focus-visible` ring (`--nc-focus-ring`).
2. Contrast: body text ≥ 4.5:1, large/display ≥ 3:1 — both themes (bright theme inks chosen for this).
3. Hit targets ≥ 40px on touch surfaces (client shell already conforms).
4. No information by color alone (pulse states keep word + color).
5. Reduced motion: full functionality with motion collapsed.
6. Phase G runs an axe/contrast audit as the gate.

## E. Landing page refresh direction (Phase G scope)

Rebuild `index.html` on the bright identity: porcelain hero with the floating hologram as the centerpiece (CSS-reference hero-layer pattern), glass nav, draw-on logo intro, social proof band, single CTA → `app.html?login`. No app-shell dependencies; cut over in one commit with the old landing kept revertible.

## F. What can be implemented safely now / must wait / don't touch

**Safe now (this session):** Phase A fixes (done) · token foundation (done) · Phase C day-nav UX (render-layer only) · Phase D dashboard restyle behind `nc-bright` (role gating untouched) · Phase E planning + isolated groundwork · Phase F planning docs.
**Must wait for explicit approval:** B4/B5 client+subscription management (architecture gate) · applying `nc-bright` beyond coach/admin · logo implementation · landing cutover · any S4 automation · Option A profiles RLS.
**Don't touch:** Feature 8 behavior · SubscriptionService/`canWrite` · `notify()` path · RLS policies · referrals code · real user data · the client mobile shell's dark theme.
