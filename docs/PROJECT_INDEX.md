# AST9 Health Hub — Project Index

> Control-baseline entry point. This is a **map**, not the source of truth for every
> detail — it links to the canonical deep-dive docs. Created in Phase R0
> (2026-06-27) to stop project context from being lost between phases.

---

## 1. Project purpose

AST9 Health Hub ("NeuCore") is a **rehab + athletic coaching SaaS**. A single owner
(admin) runs the platform; coaches manage their assigned clients; clients follow
assigned programs, log workouts, and communicate with their coach. The app is a
vanilla-JS single-page authenticated shell (`app.html`) backed by Supabase
(Postgres + RLS + edge functions), deployed as a static site on GitHub Pages.

- **Live site:** `https://abdelrahmansabry1909-oss.github.io/AST9_HUB/`
- **Repo:** `abdelrahmansabry1909-oss/AST9_HUB`
- **Production Supabase project ref:** `byquokhcbagofshsclfy` (Postgres 17.6, eu-central-1)

## 2. Current production status

- **Rehab platform = the production focus.** It is the shipped, in-use product:
  assessments, programs, workout tracking, appointments, community, exercise
  library, coach/admin business tracking.
- The detailed iceberg-style production checklist is maintained in
  [PRODUCTION_READINESS_STATUS.md](PRODUCTION_READINESS_STATUS.md). It separates
  verified controls from partial controls and unstarted production work.
- **Athletic Performance = admin-only locked preview.** As of PR #72 (R1A) the
  Athletic lane is gated to `admin` only. Coaches see a `Performance 🔒` switcher
  that opens a "locked" modal; clients never see the switcher. It is **not
  production-ready** and is not exposed to coaches or clients.

## 3. Important phases completed (high level)

See [DEV_LOG.md](DEV_LOG.md) for the full chronological log with PRs/commits.

- Rehab core: assessments, body-map/gait, programs (Feature 6 modes), workout
  tracking, progression engine, appointments (Feature 7), community + privacy,
  coach packages/billing foundation, admin business tracking (Phase 9),
  email-auth productionization (Phase 12), system exercise library (Phase 13).
- Program versioning: effective-date program versions (E1b-1 / E1b-2).
- Athletic Performance lane: service shell (F1) → assessment foundation +
  UI (F2) → movement observations schema + RLS hardening + UI (F3) → save-payload
  hotfixes (#69–#71) → admin-only lock (R1A / #72).

## 4. Current next roadmap

- Real authenticated **owner manual save smoke** for the Athletic flow (the last
  open item from the save-failure diagnostic — see [ISSUE_LOG.md](ISSUE_LOG.md)).
- Legal acceptance is backend-persisted through versioned legal documents,
  append-only acceptance records, and server-validated RPCs. Final lawyer review
  of the legal text is still required before public launch (see
  [DECISIONS.md](DECISIONS.md) / [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).
- Payment integration: provider-neutral DB foundation laid (P2B — `payment_events`
  + `coach_subscriptions` provider columns + service-role `apply_paid_coach_package_period_system()`);
  **no provider live yet.** Paymob-first webhook (P2C/P2D) is next and needs an
  owner-created provider account. See `BUSINESS_MODEL_AUTH_BILLING_PLAN.md`.
- Athletic Performance stays frozen as admin-only preview until fully smoked.

## 5. Agent boundaries (mandatory)

| Agent | Owns |
|---|---|
| **Claude** | Audit / architecture plan / risk review / implementation review |
| **Codex** | Backend / RLS / schema / migrations / security / payments / business logic |
| **Antigravity** | Frontend / UI / CSS / visual screens / interaction polish |

Strict no-overwrite rule between implementation owners. Claude does not
implement; Codex and Antigravity do not cross backend/frontend boundaries without
explicit owner approval. See `AI_WORKFLOW_GUARDRAILS.md` (repo root) and the
tracked AST9 guard pack for the enforced detail.

## 6. The control-baseline doc set (this folder)

| Doc | Purpose |
|---|---|
| [PROJECT_INDEX.md](PROJECT_INDEX.md) | This map |
| [DEV_LOG.md](DEV_LOG.md) | Chronological log of completed phases (PR/commit/files/verification) |
| [ISSUE_LOG.md](ISSUE_LOG.md) | Real bugs: symptom → root cause → fix → verified → remaining |
| [NOT_A_BUG.md](NOT_A_BUG.md) | Intended behaviors that look like bugs |
| [DECISIONS.md](DECISIONS.md) | Product/technical decisions of record |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | Honest current limitations |
| [TECH_STACK.md](TECH_STACK.md) | Languages, technologies, file groupings |
| [REPO_MAP.md](REPO_MAP.md) | Repository structure map |
| [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) | Incident playbook: severity levels, rollback, health checks, owner notification |
| [RUNBOOK.md](RUNBOOK.md) | Quick ops cheat-sheet: `ops_health_snapshot()`, deploy/asset checks, cron health |
| [PRODUCTION_READINESS_STATUS.md](PRODUCTION_READINESS_STATUS.md) | Current production checklist, evidence, gaps, and ordered continuation plan |

## 7. Canonical deep-dive docs (repo root — pre-existing, not duplicated here)

These remain the detailed source of truth; the docs above index and summarize them:

- `README.md`, `PROJECT_STATUS.md`, `FEATURE_STATUS.md` — current shipped state.
- `ArchitectureDecisionRecords.md`, `Development.md`, `Documentation.md` — architecture/dev.
- `FEATURE_6_ARCHITECTURE.md`, `FEATURE_7_ARCHITECTURE.md`, `FEATURE_8_PROPOSAL.md`,
  `PHASE12_EMAIL_AUTH_PRODUCTIONIZATION.md`, `PHASE13_SYSTEM_EXERCISE_LIBRARY.md` — per-feature detail.
- `BUSINESS_MODEL_AUTH_BILLING_PLAN.md`, `LOAD_TEST_STAGING_PLAN.md`, `SMOKE_TEST_PLAN.md` — ops/business.
