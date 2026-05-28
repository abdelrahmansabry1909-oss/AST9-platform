# RPM Architecture Plan — Phase 0 Deliverable

**Module:** Rehabilitation Programming Module (RPM) for NeuCore (an AST9 Solution)
**Author:** Senior product engineer (Claude)
**Status:** Awaiting human approval at Checkpoint 0
**Read time:** ~5 minutes

---

## 0 · Phase 0 Discovery — Notes from the Scan

### Inputs received
- ✅ All 7 expected O'Sullivan rehab-book docs saved to `docs/rehab-book/` (extracted from your paste)
- ✅ 2 bonus docs saved: `o-sullivan-business-systems.md` (TIER 7) + `o-sullivan-data-schemas.md` (Section 8 — used directly to inform §1 below)
- ✅ Existing schema mapped from `AST9_Phase3_Migrations.sql` (515 lines, 21 tables)
- ✅ Existing JS modules inventoried (18 modules)
- ✅ Existing CSS tokens audited (NeuCore + AST9 layers)

### Inputs missing / blocked
- ❌ **`docs/NeuCore_RPM_Complete_Specification.md`** — workflow's "master spec, 28K chars" — does not exist in the repo. The 7 rehab-book docs cover the clinical *framework*, but not the product spec (URL routes, field-level UI requirements, copy decks, etc.). I've designed §3 (HTML sections) using best-judgement defaults aligned with the workflow body — **flag if a real spec exists and I'll reconcile.**
- ⚠️ **`happy-progressing-patients-ebook.pdf`** (12 MB at `/d/ASThub/`) — couldn't read; PDF tooling (`pdftoppm`) isn't installed in this environment. The pasted content covers the same material at high fidelity, so I'm proceeding without it. Tell me if you want me to install `poppler-utils` or convert it externally.

---

## 1 · Database Changes

### NEW TABLES (5)

| Table | Purpose | Cite |
|---|---|---|
| `subjective_assessments` | 13-aim O'Sullivan intake **OR** free-form AST9 mode (single table, `mode` discriminator) | `o-sullivan-subjective-assessment.md` §2.1 |
| `rpm_graphs` | One per coach-built ladder. Holds Point A, Point B, phase count, status (draft/published/archived) | `o-sullivan-graded-exposure-ladder.md` §1.1 |
| `rpm_phases` | One per stage in a graph (1..N). Holds name, milestone, tripwire test, ordering | `graded-exposure-ladder.md` §1.2 + Tripwires |
| `phase_submissions` | Client → Coach review queue. Status: `pending` / `approved` / `rejected` / `modified` | Workflow Phase 4 |
| `ai_feedback_log` | Captures every coach override of an AI suggestion. ML training corpus | Workflow Phase 4 §4C |
| `visitor_inquiries` | Pre-signup leads from the survey/Calendly flow | Workflow Phase 1 §1C |

### NEW LINK TABLE (1)

| Table | Purpose |
|---|---|
| `rpm_phase_exercises` | Many-to-many between `rpm_phases` and `exercises` with prescription overrides (sets/reps/cues per phase) |

### `subjective_assessments` — full column list

```sql
CREATE TABLE subjective_assessments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid REFERENCES profiles(id) ON DELETE CASCADE,
  coach_id              uuid REFERENCES auth.users(id),
  assessment_id         uuid REFERENCES assessments(id) ON DELETE SET NULL,
  mode                  text NOT NULL CHECK (mode IN ('osullivan','free_form')),
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','complete')),

  -- Aim 3: Internal motivator (the "Northern Star")
  dream_outcome         text,
  -- Aim 4: External pain → internal problem
  external_pain         text,
  life_impact           text,
  -- Aim 5: Mechanism + Aim 7: stress timeline
  mechanism_of_injury   text,
  stress_timeline       jsonb DEFAULT '[]',     -- [{ year, event, type:'physical|emotional' }]
  -- Aim 6: Aggravating / easing factors
  aggravating_factors   jsonb DEFAULT '[]',
  easing_factors        jsonb DEFAULT '[]',
  -- Aim 8: Tripwires / past failed treatments
  past_treatments       jsonb DEFAULT '[]',
  hidden_objections     text,
  -- Aim 9: Likelihood
  confidence_score      int CHECK (confidence_score BETWEEN 0 AND 10),
  importance_score      int CHECK (importance_score BETWEEN 0 AND 10),
  -- Aim 10: Fast start
  fast_start_opportunity text,
  -- Aim 11: Red flags
  red_flag_screen       jsonb DEFAULT '{}',     -- { bladder_bowel:bool, night_pain:bool, ... }
  -- Aim 12: Yellow flags
  medications           jsonb DEFAULT '[]',
  yellow_flags          text,
  -- Aim 13: Recap
  recap_notes           text,

  -- Free-form mode only
  free_form_notes       text,

  -- Wizard state for resumable Mode A
  wizard_step           int DEFAULT 1,

  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);
```

### `rpm_graphs` — columns

```sql
CREATE TABLE rpm_graphs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid REFERENCES profiles(id) ON DELETE CASCADE,
  coach_id            uuid REFERENCES auth.users(id),
  subjective_id       uuid REFERENCES subjective_assessments(id),
  objective_id        uuid REFERENCES rehab_objective_assessments(id),

  point_a_summary     text,                       -- current state
  point_b_dream       text,                       -- destination / dream outcome
  inversion_question  text,                       -- "What needs to happen before…"
  phase_count         int DEFAULT 5 CHECK (phase_count BETWEEN 3 AND 7),
  status              text DEFAULT 'draft'        -- draft | published | completed | archived
                       CHECK (status IN ('draft','published','completed','archived')),
  ai_generated        boolean DEFAULT false,
  composite_score     numeric(5,1),               -- pulled from ScoringEngine

  published_at        timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
```

### `rpm_phases` — columns (phases progress UPWARD; index 1 = bottom = entry, index N = top = resilience)

```sql
CREATE TABLE rpm_phases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id            uuid REFERENCES rpm_graphs(id) ON DELETE CASCADE,
  phase_index         int NOT NULL,               -- 1..N, 1 is closest to Point A
  stage_name          text NOT NULL,              -- "Bed-based", "Standing", "Bridging", "High-Load", "Resilience"
  milestone_label     text,                       -- "Walk up stairs pain-free" — D.O.M.S. milestone
  emotional_win       text,                       -- "Lift husband off chair"
  tripwire_test       text,                       -- "Midfoot bridge 30s"
  tripwire_pass       boolean DEFAULT false,
  load_tolerance      text,                       -- "Submaximal", "Gravity", "Impact", "External"
  cue_mode            text DEFAULT 'top_down'     -- top_down | bottom_up | mixed
                       CHECK (cue_mode IN ('top_down','bottom_up','mixed')),
  status              text DEFAULT 'locked'       -- locked | active | completed
                       CHECK (status IN ('locked','active','completed')),
  ai_generated        boolean DEFAULT false,
  unlocked_at         timestamptz,
  completed_at        timestamptz,
  UNIQUE (graph_id, phase_index)
);
```

### `rpm_phase_exercises` — link table

```sql
CREATE TABLE rpm_phase_exercises (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id        uuid REFERENCES rpm_phases(id) ON DELETE CASCADE,
  exercise_id     uuid REFERENCES exercises(id),
  prescription    jsonb DEFAULT '{}',     -- { sets, reps, tempo, rest, cue_type, prompt_trigger }
  display_order   int DEFAULT 0,
  ai_generated    boolean DEFAULT false,
  client_completed boolean DEFAULT false,
  client_completed_at timestamptz
);
```

### `phase_submissions` — Client → Coach review

```sql
CREATE TABLE phase_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id        uuid REFERENCES rpm_graphs(id) ON DELETE CASCADE,
  phase_id        uuid REFERENCES rpm_phases(id) ON DELETE CASCADE,
  client_id       uuid REFERENCES profiles(id),
  client_note     text,
  status          text DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','modified')),
  coach_decision_at timestamptz,
  coach_note      text,
  created_at      timestamptz DEFAULT now()
);
```

### `ai_feedback_log` — ML training corpus

```sql
CREATE TABLE ai_feedback_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id          uuid REFERENCES auth.users(id),
  graph_id          uuid REFERENCES rpm_graphs(id) ON DELETE SET NULL,
  suggestion_kind   text,             -- "phase_name" | "milestone" | "exercise_pick" | "tripwire"
  original_text     text,             -- AI suggestion
  modified_text     text,             -- coach's version
  reason_category   text,             -- "wrong_phase_match" | "patient_not_ready" | "exercise_unsafe" | "other"
  reason_text       text,             -- free-form explanation
  context_jsonb     jsonb DEFAULT '{}', -- snapshot of subjective + objective + phase index
  created_at        timestamptz DEFAULT now()
);
```

### `visitor_inquiries` — pre-signup lead capture

```sql
CREATE TABLE visitor_inquiries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL,
  email       text NOT NULL,
  phone       text,
  symptoms    text,
  source      text,                  -- "survey" | "calendly_redirect"
  email_sent  boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);
```
*RLS:* INSERT-only for `anon`. SELECT for `Auth.is_admin()` only. No personal data updates from public.

### ALTER TABLE statements (existing tables that need new columns)

| Table | Change | Why |
|---|---|---|
| `programs` | `+ rpm_graph_id uuid REFERENCES rpm_graphs(id)` | Soft-link existing AI-generated programs to their parent graph |
| `notifications` *(if exists; otherwise skip)* | none | Workflow §4A re-uses existing system |

> **Confirm:** does a `notifications` table already exist? I didn't see one in `AST9_Phase3_Migrations.sql`. If not, I'll add a minimal one in Phase 4.

### Migration order (dependency-correct)

```
202X_01_visitor_inquiries.sql        ← independent
202X_02_subjective_assessments.sql   ← references profiles, assessments
202X_03_rpm_graphs.sql                ← references subjective + objective
202X_04_rpm_phases.sql                ← references rpm_graphs
202X_05_rpm_phase_exercises.sql       ← references rpm_phases + exercises
202X_06_phase_submissions.sql         ← references rpm_phases
202X_07_ai_feedback_log.sql           ← references rpm_graphs
202X_08_alter_programs.sql            ← adds rpm_graph_id
```

### RLS pattern (consistent with existing `Auth.is_admin()` / `Auth.is_coach_or_admin()`)

| Table | Coach access | Client access | Public |
|---|---|---|---|
| `subjective_assessments` | own clients OR admin | own only | none |
| `rpm_graphs` | `coach_id = auth.uid()` OR admin | `client_id = auth.uid()` (read only) | none |
| `rpm_phases` | via parent graph | via parent graph (read only when status=published) | none |
| `rpm_phase_exercises` | via parent phase | via parent phase (UPDATE `client_completed` only) | none |
| `phase_submissions` | own clients OR admin | own only (INSERT + own SELECT) | none |
| `ai_feedback_log` | own writes; admin SELECT all | none | none |
| `visitor_inquiries` | admin SELECT only | none | INSERT only |

---

## 2 · New JS Modules

> All modules follow existing pattern: vanilla IIFE, no bundler, expose as `window.ModuleName`. Loaded via `<script>` tags in `app.html`.

| File | Exports | Depends on | Lines (est) | Phase |
|---|---|---|---|---|
| `js/visitor.js` | `window.Visitor` | `sb` (anon) | ~180 | 1 |
| `js/rpm/subjective.js` | `window.RPMSubjective` | `sb`, `Auth` | ~340 | 2 |
| `js/rpm/graph.js` | `window.RPMGraph` | `sb`, `Auth` | ~260 | 3 |
| `js/rpm/graph-builder.js` | `window.RPMGraphBuilder` | `RPMGraph`, `RPMAi`, `ScoringEngine` | ~480 | 3 |
| `js/rpm/graph-viewer.js` | `window.RPMGraphViewer` | `RPMGraph`, `Dashboard` (toast) | ~320 | 3 |
| `js/rpm/approval.js` | `window.RPMApproval` | `RPMGraph`, `Dashboard` (notifications, celebration) | ~180 | 4 |
| `js/rpm/feedback.js` | `window.RPMFeedback` | `sb`, `Auth` | ~120 | 4 |
| `js/rpm/ai.js` | `window.RPMAi` | `sb`, edge function | ~200 | 3 |
| `supabase/functions/rpm-ai-suggest/index.ts` | edge function | Anthropic API | ~150 | 3 |
| `supabase/functions/visitor-survey/index.ts` | edge function | Resend (email) | ~80 | 1 |

### Module responsibilities (one line each)

- **Visitor** — survey form validation + edge function call; opens Calendly
- **RPMSubjective** — wizard state machine for the 13-aim O'Sullivan flow + free-form variant; debounced auto-save
- **RPMGraph** — load / save / publish / submit-milestone (pure data layer, no DOM)
- **RPMGraphBuilder** — coach UI: define Point A/B → AI generate → reorder → assign exercises → publish
- **RPMGraphViewer** — client UI: vertical bottom-up ladder, locked/active/completed states, completion checkboxes, milestone submit
- **RPMApproval** — coach review queue; approve/reject/modify with celebration trigger
- **RPMFeedback** — "why did you change this?" modal + write to `ai_feedback_log`
- **RPMAi** — wraps the edge function; handles structured prompt + JSON response parsing
- **rpm-ai-suggest edge fn** — server-side Anthropic call (keeps API key off the client)
- **visitor-survey edge fn** — validates submission, writes row, sends Resend email to `abdelrahman.sabry.1909@gmail.com`

---

## 3 · New HTML Sections

| Section ID | Purpose | Replaces | Role-gate |
|---|---|---|---|
| `section-subjective` *(new tab inside `section-new-session`)* | Mode A wizard + Mode B form | Existing `tab-subjective` keeps its content; tab gets a top toggle | coach/admin |
| `section-graph-builder` | Coach builds the Reactive Graph | (new) | coach/admin |
| `section-graph` (client) | Client sees their graph | (new — appears for clients in place of dashboard hero CTA) | client |
| `section-rpm-approvals` | Coach approval queue | (new) | coach/admin |
| `section-services` | Already exists from Phase B | — | all |
| `section-case-studies` | Already exists from Phase B | (extend with categories: back, knee, shoulder, hip, ankle, stroke recovery, post-surgical, athletic) | all |

### Sidebar nav additions (slim mode)

```
[Dashboard] [+ New Session] [Programs]
[Clients] [Subscriptions] [Exercises] [Progress]
[Our Services] [Gait] [Case Studies] [Analytics] [RPM Approvals]   ← + RPM Approvals (coach)
[Community]
[Coaches] [Settings]                                                  ← admin only
```

> **Important:** all existing nav `id` attributes (per workflow R7) stay byte-identical. New ones added: `nav-rpm-approvals`. The `+ New Session` rule from §1D ("only ONE button at the top") needs me to remove the duplicate at the dashboard hero — flag if you want me to keep it as the primary CTA there.

---

## 4 · CSS Token Additions

### Existing tokens (no changes — both layers stay)

- `:root` AST9 layer: `--lime`, `--teal` (≠ NeuCore teal), `--bg-void`, `--font-display: Cabinet Grotesk`
- `:root` NeuCore layer (added in Phase A): `--nc-teal`, `--nc-cyan`, `--nc-gold`, `--nc-royal-1/2/3`, `--glass-bg`, `--glow-teal`, etc.

### NEW tokens needed for RPM

```css
/* Sidebar slim mode */
--sidebar-w-collapsed:  64px;
--sidebar-w-expanded:   240px;
--sidebar-transition:   0.28s var(--ease-out);

/* Graph ladder */
--graph-stage-h:        160px;            /* default phase block height */
--graph-locked-opacity: 0.35;
--graph-active-glow:    0 0 32px var(--nc-teal-glow), 0 0 64px rgba(20,184,166,0.06);
--graph-completed-bg:   linear-gradient(135deg, rgba(20,184,166,0.10), rgba(212,175,55,0.06));

/* Status colors */
--status-pending:       #FACC15;          /* amber */
--status-approved:      var(--nc-teal);
--status-rejected:      #F5426C;          /* matches existing --rose */

/* Wizard progress bar */
--wizard-bar-bg:        rgba(255,255,255,0.06);
--wizard-bar-fill:      linear-gradient(90deg, var(--nc-teal), var(--nc-cyan));
```

That's the only CSS new I expect to need. Everything else reuses existing tokens (per R7).

---

## 5 · Integration Points

| Existing system | New consumer | What's consumed | Where |
|---|---|---|---|
| **`ScoringEngine`** (`js/scoring.js`) | `RPMGraphBuilder` | composite score + 4 sub-scores → fed to AI prompt context | builder.js, before "Generate Phases" |
| **`GaitEngine`** (`js/gaitEngine.js`) | `RPMGraphBuilder` | 18 deficit rules → flagged in AI prompt as "must address" | builder.js, AI generate call |
| **`ProgramGenerator`** (`js/programGenerator.js`) | `RPMGraphBuilder` (fallback) | If user opts out of AI, use existing rule engine to seed phases | builder.js, "use rule engine" toggle |
| **`BodyMap3D` / NeuCore skeleton** (`src/main.js`, `src/neucore/...`) | `RPMSubjective` (Aim 11/12 red/yellow flags) AND `RPMGraphViewer` (per-phase joint highlight) | joint click events; pain map | viewer.js renders phase-specific joint glow |
| **`ExerciseLibrary`** (`js/exerciseLibrary.js`) | `RPMGraphBuilder` exercise picker | filtered by `phase` + `target_joints[]` + `load_level` | AI exercise selection |
| **`Dashboard.toast` + celebration overlay** (`js/dashboard.js`) | `RPMApproval` | `Dashboard.toast()` for status; celebration overlay for phase unlock | approval.js |
| **`Auth.isAdminOrCoach()`** | every RPM module | role gating for builder/viewer split | each module top |
| **`Charts`** (`js/charts.js`) | RPM client viewer (optional) | progress chart per graph phase | future |
| **Existing `assessments` table** | `subjective_assessments.assessment_id` FK | links subjective → existing assessment row | DB |
| **Existing `rehab_objective_assessments` table** | `rpm_graphs.objective_id` FK | links graph → objective | DB |
| **Existing `programs` table** | `programs.rpm_graph_id` (new column) | soft-link AI programs to graphs | DB ALTER |

### Visual DNA — single source of truth (per R7)

All new CSS uses `var(--nc-*)` tokens. No new `#hex` literals. Landing page tokens already added in Phase A → platform inherits via the `<link rel="stylesheet" href="css/styles.css">` shared between `index.html` and `app.html`.

---

## 6 · Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | New tables conflict with naming collisions in existing migrations | Low | Low | Prefix all RPM tables with `rpm_` (or known nouns: `subjective_assessments`, `phase_submissions`, `ai_feedback_log`, `visitor_inquiries`) |
| R2 | Slim sidebar breaks mobile toggle (currently 248px → bottom-nav at <900px) | Medium | Medium | Phase 1 includes mobile QA pass at 375px viewport. Existing `mobile-bottom-nav` stays unchanged |
| R3 | "+ New Session" deduplication breaks existing flows in dashboard hero / mobile bottom nav | Medium | Low | Audit before remove: `ctrl+f "new-session"` across `app.html`. Keep mobile nav button, sidebar button. Remove dashboard-hero button if there's a duplicate |
| R4 | RPMSubjective wizard state lost on tab close | Medium | Medium | Auto-save on field blur to `subjective_assessments` row with `status='draft'`. Resume from `wizard_step` on next load |
| R5 | Anthropic API key leaks if called from client | High | Critical | Edge function `rpm-ai-suggest` is mandatory; never call Anthropic from `js/`. Confirmed in §2 |
| R6 | Visitor survey spammed (no auth) | Medium | Low | Rate-limit at edge function (1/min/IP). hCaptcha optional in Phase 5 |
| R7 | Graph publish breaks existing AI program if `programs.rpm_graph_id` migration fails | Low | High | The ALTER is `ADD COLUMN IF NOT EXISTS … NULL`. Existing programs unaffected |
| R8 | Client sees draft graph before publish | Low | High | RLS on `rpm_graphs` SELECT for clients filters `status = 'published'`. Tested via psql post-migration |
| R9 | Coach overrides AI but feedback modal not shown → ML log empty | Medium | Medium | Modal is mandatory before save in `RPMGraphBuilder`. Skippable only with `Cmd+Shift+S` (admin) |
| R10 | Existing `bodyMap3D.js` legacy file confuses new devs | Low | Low | Already non-loaded (Phase A noted). Optional: delete in Phase 5 cleanup |

### Rollback plan per phase

| Phase | Rollback approach |
|---|---|
| 1 | `DROP TABLE rpm_*, subjective_assessments, visitor_inquiries, ai_feedback_log, phase_submissions CASCADE;` then `git revert` of HTML/CSS commits |
| 2 | Drop wizard markup; subjective table can stay empty (no data loss) |
| 3 | Set `rpm_graphs.status = 'archived'` for any in-flight graphs; remove builder/viewer routes |
| 4 | Disable approval queue route; pending submissions stay in DB harmless |
| 5 | Polish-only — revert via `git revert`; no data risk |

---

## 7 · Out-of-Scope (for this build)

- Real-time presence (e.g. live cursor on graph builder)
- Calendly webhook callbacks (we just open the booking page in a new tab)
- Native mobile app (web-only, mobile-responsive)
- Multi-language i18n
- Voice-to-text intake for Mode A wizard
- Anthropic prompt fine-tuning loop (we *capture* training data via `ai_feedback_log` but don't train in-platform)
- Coach-to-coach graph sharing / templates marketplace
- Stripe/payments integration (existing `subscriptions` system stays as-is)
- Calendar booking inside the platform (Calendly handles it)
- Push notifications (browser only — uses existing in-app notifications)
- Accessibility audit beyond WCAG AA color contrast (full a11y audit is its own track)

---

## Pre-Phase-1 questions for you

These are blockers — please answer before I touch code:

1. **Master spec.** `docs/NeuCore_RPM_Complete_Specification.md` doesn't exist. Should I (a) treat the workflow body + the 7 rehab-book docs as the spec, (b) wait for the master, or (c) draft a 2-page product spec myself first and ship that as the master?
2. **Notifications table.** Does it exist already? If not, I'll add a minimal one in Phase 4 (`notifications(id, user_id, kind, payload, read_at, created_at)`).
3. **Anthropic API key.** Where is it stored — Supabase project secrets? GitHub Actions? I'll need access (or your placeholder) when wiring the edge function in Phase 3.
4. **Resend / email service.** Same question — confirmed sender + API key location for the visitor survey email.
5. **AST9 vs NeuCore visual law.** Phase A introduced NeuCore tokens (`--nc-*`) alongside AST9 tokens (`--lime`, `--teal=#3df5c1`, Cabinet Grotesk). Workflow R7 says reuse landing CSS variables — I'll continue to use `--nc-*` exclusively and leave `--lime/--teal` legacy unchanged. Confirm.
6. **Phase count for the ladder.** Default 5 (matches O'Sullivan). Workflow says coach picks 3–7. Lock this range or open it up?
7. **PDF.** `happy-progressing-patients-ebook.pdf` (12 MB) couldn't be read here. Is its content meaningfully different from what you pasted, or is the paste a faithful summary? If different, I need it in text form (or install poppler-utils).

---

## 🛑 CHECKPOINT 0 — Awaiting your approval

This plan is the only deliverable for Phase 0. **No code has been written.**

Reply with:
- ✅ **"approved"** or **"proceed"** to start Phase 1
- 🔧 **"change X"** for any specific edits to this plan
- ❓ Answers to the 7 pre-Phase-1 questions above

I will not write any code (HTML, CSS, JS, or SQL) until you respond.
