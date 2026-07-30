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
