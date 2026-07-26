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

- **P3A authenticated production verification:** P3A-1 adds a staging-only,
  production-blocked role-routing harness. Next is owner provisioning of an
  isolated Supabase staging project, synthetic role fixtures, and deterministic
  seed/reset automation before P3A-2 write-flow coverage.
- Legal acceptance is backend-persisted and versioned. Final lawyer review of the
  legal document text and release procedure remains required before public launch.
- Payment integration: provider-neutral DB foundation laid (P2B — `payment_events`
  + `coach_subscriptions` provider columns + service-role `apply_paid_coach_package_period_system()`);
  **no provider live yet.** Paymob work is intentionally postponed until the owner
  explicitly resumes it. See `BUSINESS_MODEL_AUTH_BILLING_PLAN.md`.
- Athletic Performance stays frozen as admin-only preview until fully smoked.

## 5. Agent boundaries (mandatory)

| Agent | Owns |
|---|---|
| **Claude** | Read-only audit, planning, risk review, and revision review |
| **Codex** | Backend, auth, data contracts, RLS, security, CI/test infrastructure |
| **Antigravity** | Frontend / UI / CSS / visual screens / interaction polish |

Strict no-overwrite rule between all agents. See `AI_WORKFLOW_GUARDRAILS.md` (repo
root) and the `.claude/skills/ast9-*` guard pack for the enforced detail.

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

## 7. Canonical deep-dive docs (repo root — pre-existing, not duplicated here)

These remain the detailed source of truth; the docs above index and summarize them:

- `README.md`, `PROJECT_STATUS.md`, `FEATURE_STATUS.md` — current shipped state.
- `ArchitectureDecisionRecords.md`, `Development.md`, `Documentation.md` — architecture/dev.
- `FEATURE_6_ARCHITECTURE.md`, `FEATURE_7_ARCHITECTURE.md`, `FEATURE_8_PROPOSAL.md`,
  `PHASE12_EMAIL_AUTH_PRODUCTIONIZATION.md`, `PHASE13_SYSTEM_EXERCISE_LIBRARY.md` — per-feature detail.
- `BUSINESS_MODEL_AUTH_BILLING_PLAN.md`, `LOAD_TEST_STAGING_PLAN.md`, `SMOKE_TEST_PLAN.md` — ops/business.
