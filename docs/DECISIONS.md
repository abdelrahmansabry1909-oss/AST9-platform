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
- **Status:** Implemented by
  `20260627000000_legal_acceptance_foundation.sql` and the authenticated legal
  gate in `js/auth.js`. Final lawyer review remains required; this implementation
  is not a GDPR/CCPA compliance claim (see
  [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).

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
