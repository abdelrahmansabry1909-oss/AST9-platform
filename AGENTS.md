# AGENTS.md — AST9 Health Hub ("NeuCore")

> **Purpose.** This is the single onboarding file for any AI agent (Codex, Claude
> Code, etc.) joining this repo. It captures **what the product is, how we work,
> the hard rules you must never break, the current state, and where to look next.**
> Read this first, then the pointers in §9. Keep it current — update the dated
> lines in §6 when you ship.
>
> **Last updated:** 2026-07-08 · **main @ `6e2b31b`** (PR #108 merged).

---

## 1. What this project is

**AST9 Health Hub (brand: "NeuCore")** is a production SaaS for **rehab + athletic
performance coaching**. Coaches run clients through assessment → program → workout
logging → progress tracking; an owner-admin oversees the business. It is **live and
serving real users**, so every change is production-facing.

- **Live app:** <https://abdelrahmansabry1909-oss.github.io/AST9_HUB/> (GitHub Pages, auto-deploy on push to `main`).
- **Repo:** `abdelrahmansabry1909-oss/AST9_HUB`.
- **Supabase (prod):** project ref `byquokhcbagofshsclfy` (eu-central-1, Postgres 17). Managed via the Supabase MCP server.
- **Maturity (self-audited 2026-07-01):** ~52/100 for public paid launch, ~72/100 for private beta. Strong on access-control/RLS, data integrity, auth, secrets discipline, migration discipline. Gaps: no automated test suite beyond a public smoke, thin observability, **no live payments yet**, DR untested, no true staging.

---

## 2. Architecture & tech stack

| Layer | Tech |
|---|---|
| Markup | **HTML** — `index.html` (public landing) + `app.html` (authenticated SPA shell) |
| Styling | **CSS** in `css/` (NeuCore design system; vite-bundled + content-hashed at build) |
| App logic | **Vanilla JS**, IIFE modules exposing `window.*` globals — **no framework** (`js/`, 46 modules) |
| Build | **Vite 5**, multi-page (`index.html` + `app.html`), base `/AST9_HUB/` |
| Backend / DB | **Supabase → Postgres 17** (59 migrations under `supabase/migrations/`) |
| AuthZ | **Row-Level Security (RLS)** + `SECURITY DEFINER` helpers (`is_admin()`, `is_coach_or_admin()`) — the DB is the authorization boundary, not the frontend |
| Serverless | **Supabase Edge Functions** (Deno/TS) under `supabase/functions/` (11 fns + `_shared/auth.ts` CORS) |
| Charts / 3D | Chart.js 4.4 (`js/charts.js`); Three.js 0.158 (`js/bodyMap3D.v2.js`, skeleton placeholder) |
| Hosting | **GitHub Pages** (static; push to `main` = deploy) |
| Observability | Sentry (browser shell) + an `ops-health` edge fn / `Ops Health Check` workflow |

**Roles:** `admin` (the single owner), `coach`, `client`. One app shell, **role-scoped
visibility** (role CSS classes + JS route guards) — *not* three separate apps. There is
also a **service-lane axis** (`service-rehab` / athletic) orthogonal to role.

---

## 3. The two-agent operating model (read this before touching anything)

This repo is built by **two agents with a strict, non-negotiable split.** Respect it or
you will overwrite the other agent and break prod.

- **Claude Code = backend + product-logic + security.** Owns: Supabase schema /
  migrations / RLS / RPCs / triggers / cron, edge functions + `_shared` CORS/auth,
  server-side authorization, data contracts (auth, admin/role model, billing/packages/
  slots, subscription, program generation, workout logging, appointments, community
  permissions, payments), and all backend/security verification.
- **Antigravity = frontend visual/UI.** Owns: CSS, layout, spacing, components,
  transitions, hover/focus, loading/empty states, visual appearance for all roles.
  **Off-limits to backend agents unless explicitly asked:** `css/neucore-*.css`,
  `css/styles.css`, `js/neucore-ui.js` (+ Antigravity's active branch files).

**No-overwrite rule (both directions):** before any new implementation — `git fetch`,
confirm `main`, check for an active branch/PR from the other agent (`git branch -r`,
`gh pr list`), avoid touching the same files; if overlap is unavoidable, **STOP and ask.**

---

## 4. How we work (the loop)

Every unit of work follows: **diagnose (read-only) → design → verify → owner approval →
PR → CI → merge → live/post-merge verify → report.** The canonical, authoritative rules
live in [`AI_WORKFLOW_GUARDRAILS.md`](AI_WORKFLOW_GUARDRAILS.md) (§1–§10). In short:

1. **Phase discipline.** Lock the architecture, implement **one phase at a time**, no
   scope drift. Plan-only work stays plan-only until the owner approves.
2. **PR-only flow.** **Never push directly to `main`.** Branch → PR → CI green → owner
   approves → merge. The owner does the final merge decision; don't merge without approval.
3. **Verify honestly.** A build + code-read is **not** production verification. Say
   exactly what you did: mocked/visual smoke ≠ real authenticated smoke. If you didn't
   use real credentials, say so verbatim. After a merge, confirm the **live** asset
   actually carries the change before claiming success.
4. **Guard skills are a blocking gate.** Run the relevant guard skill (see §5) before
   presenting/committing/merging. Never self-attest a guard you didn't run.
5. **Report format.** Every phase report states: files changed, files deliberately
   untouched, whether `main` was pulled, whether the other agent's files were touched,
   CI result, how it was verified, and honest limitations.

---

## 5. Skills (auto-triggered behavioral guards)

Portable guard skills encode the real regressions this project has already hit. They live
in `.github/skills/` (committed/shared) and are mirrored into each agent's local skills dir
(`.claude/skills/` for Claude, `.agents/skills/` for Codex — both gitignored). Trigger the
matching one **before** doing that kind of work:

| Skill | Use when |
|---|---|
| `ast9-agent-boundary-git-guard` | Any git/branch/commit/push/PR/merge, or deciding who owns a change |
| `ast9-auth-routing-guard` | `js/auth.js`, session, login routing, subscription gate, SIGNED_OUT, cache-bust tags |
| `ast9-supabase-backend-guard` | **Any migration / RLS / RPC / SECURITY DEFINER / trigger / cron / MCP apply** |
| `ast9-payments-webhook-guard` | **Any payments / Paymob / checkout / webhook / subscription-activation work** |
| `ast9-frontend-launch-guard` | Landing page, mobile nav, Sign-In reachability |
| `ast9-realtime-smoke-guard` | Community / messaging / notifications / realtime channels / badges |
| `ast9-production-verification-guard` | After any merge/deploy, or when reporting "verified/production-safe" |
| `ast9-cleanup-archive-guard` | Any file/folder deletion, archiving, worktree retirement |
| `clean-code-guard` / `docs-guard` / `test-guard` | Reviewing changed code / docs / tests before shipping |
| `impeccable` | Frontend/visual design work (Antigravity's lane) |

---

## 6. Current state (phase ledger)

**Shipped to `main`** (most recent first; older phases in [`PROJECT_STATUS.md`](PROJECT_STATUS.md)):

| Area | What shipped | Ref |
|---|---|---|
| **Auth polish** | Auth-experience visual polish (Antigravity, CSS-only) | PR #108 (`6e2b31b`, live) |
| **P-FE-2** | Clinical landing polish — new hero, `Explore/Enter Platform` CTA (dropped "Start Assessment"), claim-safe copy, workflow diagram | PR #107 (`5a5947f`, live) |
| **P-FE-1** | Global design-token foundation (Space Grotesk/Inter/JetBrains Mono; teal/cyan/gold), token-only | PR #106 |
| **Role separation** | Fixed a role-nav **leak**: `body.service-rehab .rehab-only { display:flex !important }` defeated inline `display:none`; role hiding now uses inline `!important` | PR #104/#105 |
| **P2B Payments** | **Provider-neutral payments DB foundation applied to prod** (`payment_events` idempotency ledger + `coach_subscriptions` provider cols + `apply_paid_coach_package_period_system` service-role RPC) | PR #103, migration `20260702000000_...` |
| **P0 Legal** | Post-auth legal-acceptance **gate live** (`_gateLegal()` fail-closed, role-neutral; `record_legal_acceptance` RPC) | PR #94 |
| **R2B** | Rehab program versioning: `publish_program_version()` atomic RPC + single-active rule (3 enforcement layers) + strict client RLS | PR #84 |
| earlier | Coach packages/slots, onboarding, exercise library, program modes, appointments, transcript assistant, admin business, Recovery Pulse (S4), workout insights, email-auth, 152-exercise system library | see `PROJECT_STATUS.md` |

**Backend:** 59 migrations · 11 edge functions · owner-only admin verified live (`admin_count = 1`).

---

## 7. Roadmap (what's next — owner-gated)

From the Production Reality audit, the next-5 priorities:

1. **Legal** — ✅ gate live; still pending: final legal *text* + lawyer review + real owner browser smoke.
2. **Payments (active lane).** Decision made: **Paymob** (Stripe is unavailable in Egypt), provider-neutral. Done: P2A architecture decision, P2B DB foundation (applied), P2C-0 account/webhook runbook (planning). **Next: P2C — Paymob webhook Edge Function** (webhook-authoritative, HMAC-SHA512 verify, idempotent) — **blocked on** the owner creating the Paymob account + storing the HMAC secret in Supabase Vault/Edge secrets. Then P2D checkout UI, P2E test smoke, P2F go-live, P2G client-access payments.
3. **Observability** — alerting beyond `ops-health`.
4. **Automated tests** — currently only a public Playwright smoke (`tests/smoke/public.spec.ts`); authenticated E2E needs owner-provisioned `AST9_E2E_*` GitHub secrets.
5. **DR + staging** — DR untested; only a free schema-cloned load-test project exists.

---

## 8. Hard invariants — do not violate

- **Owner-only admin.** Exactly ONE admin (the owner). Never build multi-admin, never add
  admin-creation UI, never weaken `is_admin()` / admin RPCs, never make admin publicly
  assignable. (A future "Team Leader" is coach-scoped via team RLS — **not** `is_admin()`.)
- **RLS is the authorization boundary.** Frontend hiding is UX only. Every user-data table
  gets RLS + explicit policies. Never grant access from a client-side check alone.
- **Secrets never touch the repo, chat, or logs.** Do not read/print `.env`, tokens,
  cookies, browser storage, saved profiles, request headers, Vault, GitHub/Sentry secrets,
  service-role keys, or Paymob/Stripe keys. Edge functions read secrets from env only.
- **Payments are webhook-authoritative.** Never grant paid access from a client "success"
  redirect. Verify the provider signature (Paymob HMAC-SHA512) before trusting a payload.
  Never trust client-supplied amount/currency/plan — resolve canonical price server-side.
  Money in minor units as integers. No card data (PAN) ever stored/touched.
- **Migrations are additive & idempotent** (`... IF NOT EXISTS`), reversible where possible;
  no destructive change on prod without explicit approval. Apply via Supabase MCP; run
  `get_advisors` after; a service-role-only RPC must appear in **neither** lint 0028 (anon)
  **nor** 0029 (authenticated). Test with transaction + `ROLLBACK`; leave **zero** test data.
- **Never use real client health data** in tests, and never print real emails / PII.
- **Cache model (critical, verified):** prod CSS is **vite-bundled + content-hashed** →
  auto cache-busts; `?v=` tokens on CSS are inert. `js/*.js` are **plain static files** →
  they **require** a manual `?v=` bump in `app.html` when their content changes.

---

## 9. Where to look

- **Rules:** [`AI_WORKFLOW_GUARDRAILS.md`](AI_WORKFLOW_GUARDRAILS.md) (the constitution), [`EDGE_FUNCTION_SECURITY_MODEL.md`](EDGE_FUNCTION_SECURITY_MODEL.md).
- **Status:** [`PROJECT_STATUS.md`](PROJECT_STATUS.md), [`FEATURE_STATUS.md`](FEATURE_STATUS.md), [`PRODUCTION_READINESS_AUDIT.md`](PRODUCTION_READINESS_AUDIT.md).
- **Structured docs:** [`docs/PROJECT_INDEX.md`](docs/PROJECT_INDEX.md), [`docs/REPO_MAP.md`](docs/REPO_MAP.md), [`docs/TECH_STACK.md`](docs/TECH_STACK.md), [`docs/DECISIONS.md`](docs/DECISIONS.md), [`docs/DEV_LOG.md`](docs/DEV_LOG.md), [`docs/ISSUE_LOG.md`](docs/ISSUE_LOG.md), [`docs/RUNBOOK.md`](docs/RUNBOOK.md), [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md).
- **Per-phase design docs:** the many `PHASE*.md` / `FEATURE_*.md` files at repo root.
- **Skills:** `.github/skills/` (shared) — see §5.

---

## 10. Recurring gotchas (learn from our scars)

- **Antigravity's reported commit SHA often mismatches the actual pushed head** (shares only the 7-char prefix). Always verify the *actual* pushed head's content and get the owner to approve the real SHA before merging; merge with `gh pr merge --merge --match-head-commit <sha>`.
- **`Supabase Preview` CI check always skips/fails** (baseline-migration gap) — it is **non-blocking**. What matters is `mergeable=MERGEABLE` and `mergeStateStatus` CLEAN/UNSTABLE (not BLOCKED), plus the Playwright smoke green.
- **Edge functions invoked from the browser need the `x-client-info` CORS header** allowed in `_shared/auth.ts`, or `functions.invoke()` fails in real browsers only.
- **Supabase Realtime needs the table in the `supabase_realtime` publication**, or "no-refresh" features silently don't update.
- **The client subscription-gate `signOut` must not trigger the SIGNED_OUT→landing redirect** (the PR #53 landing-bounce regression class).
