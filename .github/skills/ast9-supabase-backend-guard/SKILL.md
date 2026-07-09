---
name: ast9-supabase-backend-guard
description: "AST9/NeuCore guard for ALL Supabase backend work — migrations, RLS policies, RPCs, SECURITY DEFINER functions, triggers, pg_cron, and applying anything to the production database. Use BEFORE writing or reviewing a migration, adding/altering a table or column, writing an RLS policy or a DB function, or applying a change to prod via the Supabase MCP. Triggers: 'migration', 'RLS', 'policy', 'SECURITY DEFINER', 'RPC', 'GRANT'/'REVOKE', 'apply_migration', 'execute_sql', 'get_advisors', 'search_path', 'trigger', 'pg_cron', 'single active', 'idempotent', 'is_admin', 'service_role'. Enforces RLS-as-authorization, safe definer functions, idempotent/reversible migrations, service-role-only grants, advisor-lint verification, and rollback-safe prod testing. DO NOT USE for payments webhook/HMAC specifics (use ast9-payments-webhook-guard), pure git/PR mechanics (use ast9-agent-boundary-git-guard), or frontend auth routing (use ast9-auth-routing-guard)."
---

# AST9 — Supabase Backend & Data-Integrity Guard

Apply before any change to the database or a DB function, and before applying anything to
production (Supabase MCP, project ref `byquokhcbagofshsclfy`). Parent:
`AI_WORKFLOW_GUARDRAILS.md` §2/§8 and `EDGE_FUNCTION_SECURITY_MODEL.md`. This is Claude
Code's lane (backend/security).

## The mistakes this prevents

- **Frontend-only permission checks** — hiding a section in JS while the table is readable
  by any authenticated user. The frontend is UX; **RLS is the authorization boundary.**
- **SECURITY DEFINER privilege escalation** — a definer function with a mutable
  `search_path` or granted to `anon`/`authenticated` when it should be service-role-only.
- **Non-idempotent money/period operations** that double-apply on a retried call.
- **Destructive migrations** run on prod (dropping/rewriting data) without approval/backup.
- **Weakening the owner-only admin model** (see `ast9`/memory: exactly one admin).
- **Leaving test rows on prod** or printing real emails/PII/health data during a smoke.

## Core invariants

1. **RLS on every user-data table.** New table holding user/coach/client data →
   `ENABLE ROW LEVEL SECURITY` + explicit policies. Default-deny; add the minimum policies
   (own-row, assigned-coach, admin) needed. Never rely on the frontend to hide data.
2. **SECURITY DEFINER hygiene.** Every definer function sets
   `SET search_path = public, pg_temp`. Then scope execution explicitly:
   - Normal helper → `REVOKE ... FROM public` then `GRANT EXECUTE ... TO authenticated` (only if it must be callable by users).
   - **Service-role-only apply RPC** → `REVOKE ... FROM public, anon, authenticated; GRANT EXECUTE ... TO service_role;`
3. **Verify grants with advisors.** After applying, run `get_advisors`. Lint **0028** flags
   anon-executable SECURITY DEFINER, **0029** flags authenticated-executable. A
   service-role-only RPC must appear in **neither** — if it does, a grant leaked.
4. **Idempotency for state-applying RPCs.** Insert the idempotency/ledger row **first**
   (`INSERT ... ON CONFLICT DO NOTHING`); if the conflict short-circuits, return without
   re-applying. Resolve canonical values (limits, prices) from a lookup, never from the caller.
5. **Enforce invariants in the DB, in layers.** Single-active / uniqueness rules use
   real constraints (UNIQUE / partial-unique index) **plus** the RPC's supersede logic —
   never app-logic alone. Enums/currencies use `CHECK` constraints (e.g. currency `^[A-Z]{3}$`).
6. **Migrations are additive, idempotent, reversible.** Use `ADD COLUMN IF NOT EXISTS`,
   `CREATE ... IF NOT EXISTS`, guarded `DROP`. No destructive change on prod without
   explicit owner approval. One migration = one coherent change with a timestamped filename.
7. **Trigger discipline.** Know BEFORE vs AFTER semantics; a `BEFORE` trigger that mutates
   `NEW` and an `AFTER` trigger reading the row can disagree — verify ordering.
8. **Versioned/served content is server-gated.** For published/versioned rows, the client
   RLS must gate on `published AND active AND effective_from <= now() AND own` — never trust
   a client-supplied "current".
9. **Apply + test safely on prod.** Apply via MCP `apply_migration`. Smoke via
   `execute_sql` inside a **transaction + `ROLLBACK`**; leave **zero** persisted test data.
   Never print real emails, user-identifying data, or health data. Never use real health data.
10. **Owner-only admin is untouchable.** Never weaken `is_admin()`/`is_coach_or_admin()`,
    never add an admin-creation path, never make admin publicly assignable.

## Required report after backend work

State: tables/columns/policies/functions changed; RLS enabled on new tables (y/n);
who can `EXECUTE` each function (anon/authenticated/service_role); **advisor lint result**
(0028/0029 clean?); whether it was applied to prod and how it was verified (tx+rollback);
confirmation that no test data was left and no PII/secret was printed; migration filename.

## Self-check before delivery

- [ ] Every new user-data table has RLS + explicit policies (default-deny)?
- [ ] Every SECURITY DEFINER fn sets `search_path` and has minimal grants?
- [ ] Service-role-only RPCs are in neither advisor lint 0028 nor 0029?
- [ ] State-applying RPCs are idempotent (ledger-first) and resolve canonical values server-side?
- [ ] Migration is idempotent/reversible; nothing destructive on prod without approval?
- [ ] Prod smoke used tx+rollback; no test data left; no PII/health data printed?
- [ ] Owner-only admin model intact?

If any box is unchecked, fix before shipping.
