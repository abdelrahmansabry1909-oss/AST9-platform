# AST9 Decision Log

> Product / technical decisions of record. The detailed architecture rationale
> lives in the root `ArchitectureDecisionRecords.md`; this is the short,
> control-level list. Each entry: decision → rationale → status.

---

## D1 — Athletic Performance is frozen as an admin-only preview
- **Rationale:** The lane is unfinished and unsmoked; exposing it to coaches/clients
  would ship unreliable behavior.
- **Status:** In force (PR #72 / R1A). Unlocks only by an explicit approved phase.

## D2 — Rehab is the production priority
- **Rationale:** Rehab is the shipped, in-use product; Athletic is secondary until
  it is fully verified.
- **Status:** In force.

## D3 — Legal acceptance must be backend-persisted, not just a checkbox
- **Rationale:** A client-only checkbox is not auditable or enforceable. Acceptance
  (terms/consent) must be recorded server-side with who/when.
- **Status:** Implemented and in force; the legal text itself still awaits lawyer
  approval.

## D4 — No fake medical diagnosis
- **Rationale:** The platform must not present invented or authoritative-sounding
  medical diagnoses. Coaches record observations; the system does not diagnose.
- **Status:** In force.

## D5 — No fake AI recovery predictions
- **Rationale:** No fabricated recovery timelines, risk percentages, or predictive
  "AI" outputs. Same principle as the no-scores/no-norms athletic rule.
- **Status:** In force.

## D6 — No Athletic public launch until fully smoked
- **Rationale:** Real authenticated save/visual smoke by the owner is the system of
  record; the lane stays locked until that passes end-to-end.
- **Status:** In force.

## D7 — Owner-only admin model (exactly one admin)
- **Rationale:** The platform has exactly one admin (the owner). Multi-admin is
  intentionally never built; this is enforced server-side
  (`handle_new_user`/create-user/claim-coach/protect trigger). A future
  "Team Leader" role would be coach-scoped (team RLS), never `is_admin()`.
- **Status:** In force. Do not build multi-admin.

## D8 — Movement intelligence stores observations only (scoring deferred)
- **Rationale:** Raw values + coach qualitative rating + finding tags + pain /
  confidence + self-referential asymmetry + notes only. No score/norm/percentile/
  risk/ML, and no external normative content. Defense-in-depth: a DB-level
  controlled-vocabulary CHECK on `finding_tags`.
- **Status:** In force (F3B). See [NOT_A_BUG.md](NOT_A_BUG.md) #5.

## D9 — Cache-bust token must be bumped on every cached-module change
- **Rationale:** Stale `?v=` tokens caused live save failures (see [ISSUE_LOG.md](ISSUE_LOG.md) #5).
- **Status:** In force. Bump `js/<module>.js?v=YYYYMMDD?` in `app.html` whenever the
  referenced module changes.

## D10 — Per-phase, approval-gated workflow with branch-from-`origin/main`
- **Rationale:** Each phase is scoped, reviewed, and merged independently to keep
  production safe; documentation/control baselines (like Phase R0) precede risky work.
- **Status:** In force. See `AI_WORKFLOW_GUARDRAILS.md` and the `.claude/skills/ast9-*` pack.

## D11 — Client write access follows effective subscription state on every client-owned table
- **Rationale:** L12 gated only `workout_sessions` and `workout_exercise_logs`. Seven
  further tables still authorize client writes on ownership alone
  (`client_id = auth.uid()`), so a lapsed client can still write to them through
  direct PostgREST calls (see [ISSUE_LOG.md](ISSUE_LOG.md) #17). The locked-client
  rule is view-only, not no-access, so `SELECT` is never gated.
- **Decision (owner, 2026-07-30):** Extend the L12 RESTRICTIVE pattern to all seven
  residual tables — `daily_routine_logs`, `phase_submissions`,
  `exercise_alternative_requests`, `subjective_assessments`, `progress_logs`,
  `client_questions`, and the legacy `workout_logs`. Reuse
  `client_has_write_access(uuid)`; add no new function. INSERT/UPDATE/DELETE only.
- **Also decided:** `progress_logs`, `client_questions`, and `workout_logs` have no
  write path from any application code. They are gated now and queued for a separate
  deprecation review; gating is not a substitute for deciding whether they should exist.
- **Status:** Decided; implementation pending (phase P3A-2E). No migration written yet.

## D12 — Porcelain (light) is the product surface, not the dark theme
- **Rationale:** `_showApp()` adds `body.nc-bright` to **every** authenticated
  user — coach, admin and client alike. The dark `:root` block governs only the
  login screen and the transition into the app. The first `DESIGN.md` was written
  against a dark ground and was simply wrong about what the product looks like.
- **Consequence for anyone measuring tokens:** they are declared on
  `body.nc-bright`, so `getComputedStyle(document.body)` is the only correct read.
  `documentElement` returns the dark login values.
- **The Inverted Ramp Rule:** on a light ground the **dark** end of a colour ramp
  carries text (emerald-700 5.48:1, gold-700 4.90:1) and the **bright** end is a
  fill with dark ink on top (emerald-400 8.52:1, gold-500 7.79:1). Emerald-500 as
  text on white is 2.54:1 — a contrast bug, not a stylistic choice.
- **Status:** In force. `DESIGN.md` rebuilt for light in PR #187; ramp applied in
  PR #188.

## D13 — The RPM graph is a horizontal timeline, not a diagonal axis
- **Rationale:** The diagonal offered one dimension of space in which to place
  two-dimensional cards. Measured against the shipped CSS, **five phases collided
  at every width tested including 2560×1440** — and five is the default the AI
  generator produces. Percentage padding, alternating sides and a z-index raise
  were each attempted and each measured failing. Contiguous tiling makes overlap
  impossible by construction rather than merely unlikely.
- **Consequence:** duration is encoded as block **width**, not as position along
  an axis. When the 44px WCAG touch floor would shrink a short phase below
  tappable size, proportionality is sacrificed and the track scrolls — an
  accessible block beats an accurate ratio.
- **Status:** In force (PR #190). Do not reintroduce a positional axis without
  re-measuring the five-phase case first.

## D14 — Delegated frontend work is audited by measurement, never by report
- **Rationale:** Across four review rounds on the timeline canvas alone, three
  rounds contained a defect that the delivery report described as fixed —
  including a file that did not parse while the report cited a passing build and
  163 passing tests. Both citations were true and both were irrelevant, because
  the file is not in the Vite module graph.
- **Consequence:** a delivery claim is not evidence. Ratios come from
  `getBoundingClientRect` on a rendered page; contrast from `getComputedStyle`;
  reachability from `elementFromPoint`; parse status from `node --check`. "Build
  passed" is only evidence for files the build actually parses.
- **Status:** In force. See ISSUE_LOG #22 and KNOWN_LIMITATIONS L15.

## D15 — Normative curves are plotted; described muscles are written, not drawn
- **Rationale:** Neumann Fig. 5-51 plots three scapular upward rotators (upper
  trapezius, serratus anterior, lower trapezius). The surrounding text also
  describes the middle deltoid, supraspinatus and middle trapezius — their onset,
  their peak near 90°, their share of the abduction torque — but plots **no
  curve** for any of them. A shoulder chart without a deltoid looks incomplete; a
  shoulder chart with an invented deltoid curve is worse, because it is
  indistinguishable from a measured one.
- **Consequence:** the chart carries exactly the three curves the source plots.
  The described muscles appear beneath it in a "Described, not plotted" block, so
  the chart is not silently mistaken for the whole picture. Values read off a
  plot are labelled as graph readings accurate to about ±5 %MVIC and never
  presented as tabulated data.
- **Status:** In force (PR #209). Guarded by `tests/unit/shoulder-activation.test.js`,
  which fails if a `deltoid` or `supraspinatus` curve ever appears.

## D16 — The client's own EMG is not drawn, because we cannot measure it
- **Rationale:** The obvious shape for an activation chart is normative-versus-client.
  The source gives graded normative curves but no graded client-side modifiers for
  these muscles — only paralysis cases — so a "client" series would be invented
  data wearing the same visual language as the measured one.
- **Consequence:** what the assessment *can* state is where the arc **stops**, so
  that is what is drawn: a cutoff band over the range the client does not own,
  plus implications that each cite the page they came from. A short arc with a
  stiff thorax blames the thorax and **not** the serratus, because only one of
  those has evidence behind it.
- **Status:** In force (PR #209). If client-side EMG is ever measured for real,
  this decision is the thing to revisit — not the chart.

## D17 — Two engines that must agree are pinned by a parity test, not by discipline
- **Rationale:** `js/gaitEngine.js` and `src/neucore/gait/GaitRules.js` encode the
  same clinical rules for different consumers. They drifted to 15 rules versus 10
  without anything failing, and the 5 that went missing were every spine and
  shoulder rule — which is why the analysis read as lower-body-only for months.
  Nothing in the build, the type system or the test suite could notice.
- **Consequence:** duplicated clinical knowledge gets a parity test that fails on
  divergence. Preferred order is still to have one engine; until that
  consolidation is scoped, the test is what makes the duplication survivable.
- **Status:** In force (PR #208). See ISSUE_LOG #26.

## D18 — A failed save is reported, but never destroys the work it failed to save
- **Rationale:** The assessment save was silent in four independent ways at once
  (ISSUE_LOG #29), the load-bearing one being that `supabase-js` **returns**
  `{ error }` rather than throwing, so five inserts discarded their errors and
  the surrounding `try/catch` never ran. A coach saw "Program generated!"
  whether or not anything reached the database. Once the upper-body columns
  started carrying data, that silence lost a whole assessment rather than a
  legacy stats row.
- **Consequence, two halves.** Every insert now checks its returned error and
  names the stage that failed; the caller awaits the save and tells the coach
  plainly that nothing was stored. But a failed save **does not** block, discard
  or roll back the program — it is generated locally and remains valid and
  exportable, and telling a coach their work is gone while it is on screen would
  be its own dishonesty. The message says what was lost (the record), what
  survives (the program), and what to do (keep the tab open, retry).
- **Also:** failures reach Sentry tagged `area: 'assessment_save'`, wrapped in
  their own `try/catch` — a throw from inside the error reporter would convert a
  reported failure back into an unreported one, which is the original bug one
  level up.
- **Status:** In force (PR #212). Guarded by
  `tests/unit/assessment-save-reporting.test.js`, mutation-proven against all
  five regressions. **Never reintroduce a bare `await sb.from(x).insert({...})`
  in a write path** — it looks complete and discards the error.

## D19 — A guard that cannot be made to fail is not evidence
- **Rationale:** Twice in one session a test passed while the exact defect it
  existed to catch was live. The shoulder-chart guard sliced the file from
  `constructor(` to the first mention of `_ensureChart` and so never looked at
  `_build()`, which was calling `_initChart()` directly. And several of the
  defects fixed in ISSUE_LOG #26–#29 had survived months of a fully green suite.
- **Consequence:** every new guard is mutation-tested before it is trusted —
  reintroduce the defect, watch the suite go red, restore, watch it go green.
  The mutation scripts live in the scratchpad, not the repo; what matters is
  that the check was performed and reported, not that it is kept.
- **Status:** In force since 2026-08-26. Applied to all 23 guards added across
  PRs #208–#212.
