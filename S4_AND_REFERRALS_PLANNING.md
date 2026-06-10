# S4 Proactive Alerts + Referrals — Planning (Phase F)

**Status:** PLANNING ONLY. No cron activated, no automation, no notifications sent, no code. Both tracks are approval-gated before any implementation.
**Date:** 2026-06-10 · Grounded in the live DB + deployed edge functions.

---

## Part 1 — S4: Recovery Pulse proactive alerts

### 1.1 What exists today (verified live)
- `v_client_pulse` — read-only classifier, **assigned-coach scoped** (Option B live): `pulse_status`, `severity 0–4`, `reasons[]`, `churn_risk`, `effective_status`, `days_since_activity`.
- `notify()` RPC — the **only** insert path into `notifications` (SECURITY DEFINER, authz inside; direct INSERT blocked by `WITH CHECK (false)`).
- **pg_cron installed with exactly one job:** `subscription-checker-daily [0 0 * * *]` → invokes the `subscription-checker` edge fn (`verify_jwt:false`, gated by `requireCron` / `x-cron-secret` with timing-safe compare).
- Edge auth pattern: `_shared/auth.ts` (`requireRole`, `requireCron`).

### 1.2 S4 architecture (proposal)
**One new edge function `pulse-alerts` + one new cron job — nothing else.**

1. **Cron:** `pulse-alerts-daily` at `0 5 * * *` (after the subscription checker; quiet hours respected — server UTC).
2. **Edge fn `pulse-alerts`** (`verify_jwt:false` + `requireCron`, service-role client):
   - Read `v_client_pulse` **as service role** — ⚠ the Option B `WHERE` returns 0 rows without `auth.uid()`; the fn must query the *underlying* logic instead. **Decision needed:** (a) query the un-scoped internals via a dedicated `SECURITY DEFINER` function `fn_pulse_for_alerts()` (recommended — keeps the view's caller-scoping intact), or (b) re-grant the view to service role via a bypass clause (rejected: weakens the scoping contract).
   - Alert rule v1 (deliberately conservative): for each client with `severity ≥ 3` **or** `churn_risk`, notify the **assigned coach** via `notify()` — severity `warning`, deep-link to the Clients section.
3. **Idempotency / anti-spam (the hard requirement):** one alert per client per *state episode*, not per day. Mechanism: a small `pulse_alert_log (client_id, pulse_status, alerted_at)` table (additive); skip if an alert for the same `client_id+pulse_status` exists within a cooldown window (proposal: 7 days) or since the status last changed. No client-facing notifications in v1 (coach-only — clients get the card, not nagging).
4. **Escalation (v2, separate approval):** unresolved `severity 4` after N days → admin notification. **Email push** (Resend via `send-email`) only after in-app alerts prove calibrated.
5. **Churn refinement (v2):** add `days_remaining ≤ 7 AND adherence_7d < 50` as a pre-grace early-warning band to `churn_risk` — view version bump per the locked formula-versioning rule.

### 1.3 Safety rails
- No bulk sends: hard cap per run (e.g. 50 notifications) with overflow logged, not sent.
- Dry-run mode first: `?dry=1` returns the would-send list without writing — verified against the `@ast9.test` fixtures before activation.
- Rollback: unschedule the cron job + drop `pulse_alert_log`; no other surface depends on it.
- Test fixtures: `pulse.regress`/`pulse.expired` give deterministic severity-4/churn rows for end-to-end dry-run verification.

### 1.4 Activation gates (all required, in order)
1. Architecture approval (this doc) → 2. `fn_pulse_for_alerts` + table migration (architecture-gated, rollback paired) → 3. edge fn deployed, **dry-run verified** → 4. explicit user approval to schedule the cron → 5. first live run observed + report.

---

## Part 2 — Referrals architecture refinement

### 2.1 What exists today (verified live)
- Table `client_referrals(id, from_coach_id, to_coach_id, client_id, status, notes, created_at, responded_at)`.
- UI: Community → Referrals tab (`communityUI.js`): send-referral modal (client select already scoped to `assigned_coach`), incoming Accept/Decline buttons (`respondRef`), pending-count badge feed.
- `Community.loadOtherCoaches()` powers the to-coach dropdown.

### 2.2 Gaps to close (refinement scope, when approved)
1. **Acceptance must actually transfer the client.** Today accepting sets `status` only — `profiles.assigned_coach` does not change, and only admins may change it (`enforce_profile_protected_columns`). **Proposal:** `accept_referral(p_referral_id)` SECURITY DEFINER RPC — validates the caller is `to_coach_id` and the referral is `pending`, then atomically sets `responded_at`, `status='accepted'`, and `profiles.assigned_coach = to_coach_id`. This is the missing core of the feature and is **security-sensitive** (assignment change) → architecture-gated.
2. **Notify the parties** via `notify()` (referral received / accepted / declined) — reuses the existing tier, no new mechanism.
3. **Single-coach reality check:** with 0 real coaches today, referrals have no production users — build only when a second real coach is imminent; until then this stays design-complete/parked.
4. **RLS audit** of `client_referrals` policies as step one of implementation (not yet audited in depth — do not assume).

### 2.3 Sequencing recommendation
S4 (coach alerts) delivers value with today's single-coach reality; referrals only matter post-multi-coach — and **both depend on the Option A profiles hardening landing first** (coach onboarding gate). Recommended order: **Option A → S4 → referrals.**

---

*Nothing in this document is activated. No cron beyond the pre-existing `subscription-checker-daily` exists. Stop-and-approve applies to every numbered gate above.*
