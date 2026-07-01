# AST9 Ops Runbook (quick reference)

> Fast command cheat-sheet for routine ops checks. For full incident procedure,
> severity levels, and rollback steps see [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
> **Never** paste secret values, tokens, or user health data into notes.

- **Production Supabase ref:** `byquokhcbagofshsclfy`
- **Live site:** `https://abdelrahmansabry1909-oss.github.io/AST9_HUB/`

---

## Cron / edge health (owner-only)

Run in the Supabase SQL editor (or via MCP) as the owner/admin:

```sql
select public.ops_health_snapshot();
```

Returns jsonb:

```jsonc
{
  "generated_at": "…",
  "overall_healthy": true,
  "jobs": [
    {
      "jobname": "subscription-checker-daily",
      "present": true, "active": true, "schedule": "0 0 * * *",
      "expected_interval_min": 1440,
      "last_run_at": "…", "last_run_status": "succeeded",
      "minutes_since_last": 120, "stale": false,
      "healthy": true, "reason": "ok"
    }
    // pulse-alerts-daily, expire-stale-workouts-hourly …
  ],
  "edge_http": {
    "available": true,
    "last_status": 200, "last_at": "…",
    "non_2xx_last_24h": 0, "timed_out_last_24h": 0,
    "note": "Global pg_net responses (cron + app edge calls); best-effort, short retention."
  }
}
```

**How to read it**
- `overall_healthy: false` → inspect the offending `jobs[].reason`.
- A job `stale` or `present:false` / `active:false` → the schedule stopped; re-apply
  its migration (owner-approved).
- `edge_http.non_2xx_last_24h > 0` or `last_status` non-2xx → an **edge function**
  is returning errors even if cron dispatch "succeeded" (the S7 pattern). Check
  Supabase Edge logs; do not print secrets.
- `edge_http.available:false` or nulls → usually just pg_net's short retention
  (daily responses already pruned), not necessarily a problem.

**Expected jobs:** `subscription-checker-daily` (0 0 * * *), `pulse-alerts-daily`
(0 5 * * *), `expire-stale-workouts-hourly` (0 * * * *).

**Privacy:** the snapshot returns only job names, schedules, timings, status codes,
and counts — **no** headers, bodies, tokens, Vault values, or user data.

---

## Deploy check

```bash
gh run list --workflow="Deploy to GitHub Pages" --limit 3
```
Confirm the latest run's `headSha` == `origin/main` and `conclusion = success`.

## Live asset verification (after any frontend change)

```bash
curl -fsSL "https://abdelrahmansabry1909-oss.github.io/AST9_HUB/app.html" | grep 'js/<module>.js?v='
```
Confirm the expected `?v=` token is live (stale token = CDN/browser cache; see
[ISSUE_LOG.md](ISSUE_LOG.md) #5).

---

## Proposed (NOT built yet): automated cron health-check Action

An automated schedule that calls the health snapshot and alerts on failure is
**deferred** until a secure call strategy is approved, because a GitHub Action must
**never** hold the Supabase `service_role` key, and `ops_health_snapshot()` requires
an authenticated **admin** caller.

**Recommended future design (for approval):**
- Add a small gated edge function `ops-health` that:
  - requires a bespoke header secret (proposed name only: `OPS_HEALTH_SECRET`),
    validated like the existing cron gate (Vault-backed, never plaintext),
  - internally reads the safe snapshot and returns only the safe JSON.
- The scheduled GitHub Action holds **only** `OPS_HEALTH_SECRET` as a repo secret
  (never `service_role`, never an admin JWT), calls the edge function, and **fails
  the run** (email) when `overall_healthy` is false.

**Why edge-function-wrapper over direct RPC from CI:** the RPC needs an admin
identity; minting/storing an admin JWT in CI is unsafe. A dedicated secret-gated
edge function keeps CI's credential to a single-purpose, revocable token.

**Required secret names only (no values, do not create yet):** `OPS_HEALTH_SECRET`
(edge + GitHub Actions repo secret). Reuse the existing Vault pattern; no new
`service_role` exposure.
