# FEATURE 8 · S1–S3 — Merge Readiness (Recovery Pulse Foundation)

**Branch:** `claude/interesting-buck-452459` → target `main`
**HEAD:** `feea80d` · **Date:** 2026-06-09
**Scope:** the read-only foundation of Feature 8 (Recovery Pulse). **S4 (cron alerts) is NOT included.**

---

## 1. What's in this slice

| Phase | Deliverable | Commit |
|---|---|---|
| **S1** | `v_client_pulse` — read-only `security_invoker` classifier view (+ paired rollback). No new tables/RLS/indexes. | `5e8890f` |
| **S2** | Client **Recovery Pulse card** on Today (`clientDashboard.js`) — friendly status, momentum, one reason, one action; read-only aware; new-client onboarding; calm-fail. | `8ec5e05` |
| **S3** | Coach **Needs Attention panel** (`clients.js` + a mount div in `app.html`) — ranked by severity, friendly wording, reasons, hints; reuses F7 Recovery / `coach_messages` nudge / verified `reactivate_subscription()` RPC. | `feea80d` |

Also carried (docs, additive): `c4b9a8c` workflow guardrails, `359ee76` Feature 8 proposal.

## 2. Verification summary (all green)

| Check | Result |
|---|---|
| DB view exists + returns rows (live) | ✅ `view_exists=1`, `pulse_rows=2` |
| Live `.or()` meaningful-rows filter (real data) | ✅ returns 0 (both clients `new`) → coach panel shows calm empty state |
| S1 classifier (synthetic, all branches) | ✅ 10/10; RLS per role (client=self, admin/coach=assigned); `EXPLAIN` 3.1 ms, existing indexes only; rollback drop+restore clean |
| `node --check` (clientDashboard.js, clients.js) | ✅ ok |
| `npm run build` | ✅ green (chunk-size warning is pre-existing M-2, not new) |
| Browser smoke — S2 client card | ✅ **31/31** (new / on_track / slipping / at_risk / regressing / query-error / no-data / read-only) |
| Browser smoke — S3 coach panel | ✅ **23/23** (rank / filter / on_track+new hidden / reasons / View Recovery→F7 / Nudge→sendMessage / Reactivate→RPC only for lapsed / empty state / client-role guard) |
| Console (both smokes) | ✅ 0 errors / 0 unhandled rejections |

## 3. Guard-skills summary

- **clean-code-guard** (per phase): **no real findings.** Reuse-first (`openRecovery`, `Community.sendMessage`, `reactivate_subscription`, `_wireCTA`, `SubscriptionService.canWrite`, `_esc`, existing badge/btn CSS); small intent-named functions; calm-fallback matches each file's existing pattern; every Supabase call / column / RPC param verified against source; no clinical wording reaches client or coach DOM (clinical detail stays inside the F7 modal).
- **docs-guard**: applied to this report only.
- **test-guard / wp-guard / woo-guard**: N/A.

## 4. Boundary confirmations

- ✅ **No S4 code** — no proactive-alert logic anywhere in the diff.
- ✅ **No cron changes** — `subscription-checker` untouched.
- ✅ **No edge-function changes** — nothing under `supabase/functions/`.
- ✅ **No notification automation changes** — `notify()` / triggers untouched.
- ✅ **No new tables, no new RLS policy** — S1 is one read-only view; relies on existing RLS via `security_invoker`.
- ✅ **No unrelated files** — diff vs `main` is Feature 8 (S1–S3) + the two docs only. Local-only `SMOKE_TEST_PLAN.md` tweak and untracked `.agents/` / `skills-lock.json` are **excluded** from all commits.

## 5. Git state

- **HEAD:** `feea80d`
- **Commits since `origin/main`:** 5 (`feea80d` S3, `8ec5e05` S2, `5e8890f` S1, `359ee76` proposal, `c4b9a8c` guardrails)
- **Branch vs its remote:** ahead 5 (push pending)
- **Uncommitted:** `SMOKE_TEST_PLAN.md` (local-only), `.agents/`, `skills-lock.json` — all intentionally excluded.

## 6. Deploy / rollback notes

- Merging to `main` ships **only the front end** (S2/S3) via GitHub Pages. **S1's `v_client_pulse` view is already applied to the live Supabase DB** (additive, read-only) and is required by S2/S3 at runtime — it is in place.
- **Rollback:** S2/S3 = revert-merge (front end degrades to no card/panel); S1 = `supabase/rollbacks/20260609125012_feature8_v_client_pulse_down.sql` (drops the view; inert since only S2/S3 read it).

## 7. Verdict

**Ready to merge.** S1–S3 are a self-contained, read-only foundation with full verification and clean guards. No Critical/High issues. Cron/edge automation (S4) is deferred to a later, separately-approved phase.

> Note: the live **authenticated** coach/client render against multi-client real data is confirmable in the pending manual smoke (`SMOKE_TEST_PLAN.md` A/C) — not a blocker for this read-only slice, recommended before/with the next release.
