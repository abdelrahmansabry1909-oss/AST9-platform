# AST9 Incident Response

> How to detect, triage, contain, and recover from a production incident, and
> what to check first. This is an operational playbook, **not** a compliance
> certification — AST9 makes no HIPAA/GDPR compliance claim here. Keep secret
> values out of this file and out of any incident notes. See
> [RUNBOOK.md](RUNBOOK.md) for the quick command cheat-sheet and
> [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for standing caveats.

- **Live site:** `https://abdelrahmansabry1909-oss.github.io/AST9_HUB/`
- **Repo:** `abdelrahmansabry1909-oss/AST9_HUB`
- **Production Supabase ref:** `byquokhcbagofshsclfy`
- **Frontend deploy:** GitHub Actions → GitHub Pages (on push to `main`)

---

## 1. Severity levels

| Sev | Definition | Examples | Target response |
|---|---|---|---|
| **S1** | Auth / access broken for **all** users | Login, `Auth.init`, legal gate, or subscription gate fails for everyone; site down; wrong-role data exposure | Immediate |
| **S2** | A **core workflow** is broken | Program publish, workout logging / auto-finish, subscription cron, legal acceptance recording, edge function returning 4xx/5xx | Same day |
| **S3** | **Degraded / partial** | One non-critical feature failing, slow, or affecting a subset; stale cron not yet user-visible | Next working session |
| **S4** | **Cosmetic** | Visual/copy glitch, no data or access impact | Backlog |

**Escalate a level** if a lower-sev issue touches auth, legal, payments (when added), or data integrity, or if user impact is spreading.

---

## 2. First-response order (any suspected incident)

1. **Confirm & classify** — reproduce if safe; assign S1–S4; note start time (UTC).
2. **Assess blast radius** — one user, one role, one flow, or everyone?
3. **Contain** — prefer the smallest safe rollback (see §4) over a forward fix under pressure.
4. **Verify recovery** — re-check the live asset / flow after the change deploys.
5. **Record** — keep a short timeline for the post-incident review (§10).

---

## 3. Detection sources (where signals come from today)

- **Owner / user report** — currently the primary channel.
- **Cron & edge dispatch health** — `select public.ops_health_snapshot();` (owner-only; added in P1A). Reports missing/inactive/stale jobs and a best-effort recent edge-HTTP summary. **Why it matters:** a cron job can log `succeeded` (dispatch) while the edge function returned 401/500 — this snapshot surfaces both the dispatch timing and the recent HTTP status.
- **GitHub Pages deploy status** — Actions tab / `gh run list`.
- **Supabase Edge Function logs** — Supabase dashboard (short retention).
- **Automated cron health-check** — the `Ops Health Check` GitHub Action (P1D) runs every 6h and emails the owner on failure (unreachable / non-200 / unhealthy). See [RUNBOOK.md](RUNBOOK.md).
- **Frontend error monitoring** — a Sentry errors-only shell (P1E-3/P1E-4, `js/monitoring.js`) is **LIVE** as of P1E-4: `window.SENTRY_DSN` holds the real `ast9-frontend` EU browser DSN and the shell sends scrubbed error events (fail-open, no user identity, strict `beforeSend`). **Instant kill switch** = disable the DSN client key in the Sentry UI (Settings → Client Keys); repo-level disable = `window.SENTRY_DSN = ''` (needs PR + deploy + reload). Run the raw-envelope smoke after deploy. See [RUNBOOK.md](RUNBOOK.md) "Frontend error monitoring". **Edge** error monitoring (Sentry) remains deferred.

---

## 4. Containment & rollback procedures

### 4a. Frontend rollback (GitHub Pages)
1. Identify the bad merge commit on `main`.
2. `git revert -m 1 <merge_sha>` on a branch → PR → merge (never force-push `main`).
3. **If a JS module changed**, bump its `?v=` token in `app.html` so browsers/CDN re-fetch (see [NOT_A_BUG.md](NOT_A_BUG.md) cache-bust rule / [ISSUE_LOG.md](ISSUE_LOG.md) #5).
4. Wait for the Pages deploy to finish, then **verify the live asset** actually changed (fetch the file, confirm token/content) — do not assume.

### 4b. Database migration rollback (owner-approved only)
1. Only 29 of 64 migrations have paired down-files, split between `supabase/rollbacks/` and `supabase/migrations/rollbacks/`; check [MIGRATION_ROLLBACK_INVENTORY.md](MIGRATION_ROLLBACK_INVENTORY.md) before assuming a rollback exists.
2. **Capture before-state counts** for any table the down-file touches.
3. Get explicit **owner approval** before running anything against production.
4. Run the paired down-file (Supabase SQL editor / MCP).
5. **Verify after-state counts** and that only the intended objects were removed.
6. Note: append-only audit data (e.g. legal acceptances) is intentionally **not**
   reverted by design — read the down-file's header before running it.

### 4c. Cron / job issues
1. `select public.ops_health_snapshot();` — check `present`, `active`, `stale`,
   `last_run_status`, and the `edge_http` block.
2. A job **missing/inactive** → re-apply its migration (owner-approved).
3. Dispatch `succeeded` but `edge_http.last_status` non-2xx → the **edge function**
   is failing; check its logs and secret configuration (the S7 pattern). Do **not**
   print secret values while investigating.

### 4d. "Stop the bleeding" options
- Revert the offending merge (4a) is the default containment.
- There is currently **no in-app "disable signup" kill-switch** — flagged as a
  future feature flag; do not build it during an incident.

---

## 5. GitHub Pages deployment check
- Actions → **Deploy to GitHub Pages** (or `gh run list --workflow="Deploy to GitHub Pages"`).
- Confirm the latest run's `headSha` matches `origin/main` and `conclusion = success`.
- If a deploy failed, the previous good bundle stays live; fix forward or revert,
  then re-run/redeploy.

## 6. Supabase Edge Function logs
- Supabase dashboard → Edge Functions → the function → Logs.
- Look for the `[edge] unhandled error:` line and non-2xx responses.
- **Never** copy tokens, `Authorization` headers, service-role keys, or user
  health data out of the logs into tickets or notes.

---

## 7. Owner notification path
- **S1 / S2:** notify the owner immediately (the owner is the single admin and
  the decision-maker for production changes and any DB rollback).
- **S3 / S4:** include in the next session summary.
- All production SQL, migrations, and rollbacks require **owner approval** first.

## 8. What NOT to do
- ❌ No direct production SQL writes without owner approval (read-only checks like
  `ops_health_snapshot()` are fine).
- ❌ No inspecting or printing secrets/tokens/Vault values/env values.
- ❌ No logging or pasting raw user health/rehab data anywhere.
- ❌ No force-push to `main`; no skipping the PR flow.
- ❌ No claiming an incident is resolved without live verification.
- ❌ No compliance claims (HIPAA/GDPR) that are not actually implemented + reviewed.

---

## 9. Incident checklist (copy per incident)
- [ ] Detected at (UTC): ______  Reporter: ______
- [ ] Severity (S1–S4): ______
- [ ] Symptom (user-visible): ______
- [ ] Blast radius (who/what/how many): ______
- [ ] `ops_health_snapshot()` checked? result: ______
- [ ] Pages deploy status checked? ______
- [ ] Edge logs checked (no secrets copied)? ______
- [ ] Containment action taken (revert / rollback / config): ______
- [ ] Owner notified + approval for any prod change? ______
- [ ] Recovery **verified live**? how: ______
- [ ] Resolved at (UTC): ______

## 10. Post-incident review checklist
- [ ] Timeline (detection → containment → recovery).
- [ ] Root cause (the actual mechanism, not just the symptom).
- [ ] Why it wasn't caught earlier (detection gap).
- [ ] Fix shipped (PR/commit) + verification evidence.
- [ ] Follow-ups filed (monitoring, test, guard, doc) with owner.
- [ ] [ISSUE_LOG.md](ISSUE_LOG.md) updated if it was a real bug.
- [ ] [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) / [DECISIONS.md](DECISIONS.md) updated if scope changed.
