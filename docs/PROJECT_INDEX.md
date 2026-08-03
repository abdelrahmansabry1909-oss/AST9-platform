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

> **As of 2026-08-03**, `origin/main` @ `9763c02` · 71 migrations · 11 edge
> functions · 163 unit tests. Deployed to GitHub Pages on merge.

**Landed 2026-08-02 → 08-03** (see [DEV_LOG.md](DEV_LOG.md) O2, BK1, FK1, DS1,
RPM2, BIZ1 for the detail):

- **Applied to production:** the account-deletion foreign-key rules (deletion had
  never worked for a real user), the D11/L12 client write gate (27 restrictive
  policies, previously merged but dormant), and `rpm_phases.duration_weeks`.
- **Observability is live:** Sentry carries the real commit SHA as its release,
  and an issue alert rule emails on new production issues — delivery verified.
- **Design system reskin:** the webfont is finally delivered, the token layer is
  consolidated (86 `!important` custom properties → 0), and the porcelain light
  ramp is live. `PRODUCT.md` and `DESIGN.md` are at the repo root.
- **The RPM graph is now a horizontal timeline**, not a diagonal — see
  [DECISIONS.md](DECISIONS.md) D13.

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

### What is missing, in priority order (2026-08-03)

Nothing below is a hidden defect — each is tracked. Full detail in
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

1. **No gate parses the plain `<script src>` files** (L15). A syntax error in
   `graph-builder.js` or `monitoring.js` passes every current CI check and ships
   a dead feature. This already happened once. The fix is small: run `node --check`
   over every script `app.html` references, as a unit test.
2. **The backup has never been restored** (L17). A backup path with no restore
   behind it is an assumption, not a recovery capability. Needs `supabase link`,
   one backup, one restore.
3. **No authenticated smoke anywhere** (L1, L14). Playwright never signs in, so
   every write path — including the timeline canvas just shipped — is verified by
   backend reproduction and DOM measurement, not by a real session.
4. **Legal text still needs a lawyer** (L3). The enforcement machinery is done and
   live; the words are not.
5. **No payment provider is live** (L4). Manual InstaPay approval only.
6. **Alerting is dashboard-only** (L16). Deleting the Sentry rule would silently
   end alerting with no repository trace.
7. **Owner action outstanding:** rotate the `cli_login_*` token exposed on
   2026-08-02 (ISSUE_LOG #23) and delete the synthetic Sentry test issue.

## 5. Agent boundaries (mandatory)

| Agent | Owns |
|---|---|
| **Claude** | Audit and verification, **plus** backend, auth, data contracts, RLS, migrations, security and CI/test infrastructure (absorbed the Codex lane on 2026-07-27). Writes the plan and the ready-to-paste prompt for every frontend task, then audits the result — but never implements frontend itself (2026-08-01). |
| **Codex** | Dormant. Delegated backend implementation only, on an approved brief, when explicitly dispatched. |
| **Antigravity** | Frontend / UI / CSS / visual screens / interaction polish — implements from Claude's plan. |

**Delivered work is audited by measurement, never by report** — see
[DECISIONS.md](DECISIONS.md) D14 and [ISSUE_LOG.md](ISSUE_LOG.md) #22 for why
that rule exists.

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
