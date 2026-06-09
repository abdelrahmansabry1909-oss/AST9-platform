# FEATURE 8 PROPOSAL — "Recovery Pulse": Adherence & Regression Early-Warning

**Status:** Design only. No code, schema, migration, edge function, or deployment created or modified. Awaiting approval.
**Planning under:** `AI_WORKFLOW_GUARDRAILS.md` (architecture-first; this touches DB/RLS/Edge → design + approval before any code).
**Builds on (all verified present):** F1 subscription state, F2 workout sessions, F3 notifications inbox, F4 progression engine, F7 recovery/assessment, CX3 assigned-coach messaging.
**Design principle:** reuse the existing scoring infrastructure; add a thin *decision + alert* layer, not new analytics.

> This proposal supersedes the earlier "Recovery Pulse" draft of the same file, restructured to the mandated 14-section format with corrected, source-verified system references and an explicit rollback / verification / guard-skills / risk-gating plan.

---

## 0. Architecture analysis (pre-proposal grounding)

Each item below was verified against the actual codebase/migrations during this planning pass (docs-guard Rule 1 — every referenced symbol checked against source, not memory).

1. **Existing architecture.** Vanilla-JS IIFE modules (`window.*` globals) + Supabase JS, built by Vite (multi-page `index.html` + `app.html`); `Dashboard.showSection()` router with role classes (`role-coach-admin` / `role-admin-only` / `role-client-only`) + client mobile shell (`body.nc-client`). Backend = Supabase Postgres + RLS + Edge Functions + pg_cron.
2. **Existing data sources (verified).** `workout_sessions` (status, started_at, duration_seconds, workout_key, intensity), `workout_exercise_logs` (`sets` JSONB), `daily_routine_logs`, `progress_snapshots` (per-assessment composite/ROM/control/force), `progress_logs` (pain scale), `client_programs` (program JSON), `profiles` (role, `assigned_coach`, `coach_name`, `current_phase`), `coach_messages` (CX3), `notifications`, `exercises`, `subscriptions`.
3. **Existing dashboards.** Client mobile: Today / Train / Progress / Coach / More (`clientDashboard.js`, `clientTrain.js`, `clientCoach.js`). Coach/admin: `clients.js` (`#section-clients`), Daily Routine adherence view, Workout History, Progression, Subscriptions, Approvals.
4. **Existing progression/recovery views (verified).** `v_client_progression` (`security_invoker=true`) emits `recovery`, `overall`, `compliance`/`performance`, `routine_adherence_pct_7d/30d`, `delta_7d_routine`. F7 recovery modal is reachable via `Clients.openRecovery()`.
5. **Existing notifications (verified).** `notifications` table + `public.notify()` **SECURITY DEFINER** RPC = the *only* insert path (direct INSERT blocked); called **server-side** by triggers and the `subscription-checker` cron. Client inbox + deep-links already exist (F3).
6. **Existing subscription state (verified).** `v_client_subscription_state` (`effective_status`, `days_remaining`, grace), `SubscriptionService.canWrite()` write-gate (F1).
7. **Existing coach/client workflows.** Coach publishes programs (`programPublish.js`), reviews approvals, messages clients via `coach_messages` (CX3, RLS-verified this session). Client logs sessions (F2), requests alternatives (F6), messages assigned coach (CX3).
8. **Known remaining risks (carried in, addressed in §8/§13/§14):** H-A subscription write-gate hardening; `case_shares` INSERT RLS defense-in-depth; community realtime unsubscribe cleanup (F-2); manual authenticated smoke A–E still pending.

---

## 1. Single recommended Feature 8 concept

**Recovery Pulse** — one shared, read-only per-client "pulse" signal that classifies each client's trajectory and drives three surfaces from a single source of truth:

1. **Client adherence loop** — a "Recovery Pulse" card on the client dashboard: weekly adherence ring + active-week streak + a *momentum* arrow tying consistency to recovery trend ("5/6 sessions this week — recovery trending ↑"). One honest CTA: *Log today's session* (suppressed when subscription is read-only).
2. **Coach triage queue** — a "Needs Attention" panel atop the Clients view ranking assigned clients by risk (`regressing → at_risk → slipping`), each row deep-linking to the **F7 Recovery modal** (`Clients.openRecovery()`), with a one-tap **nudge** via the existing `coach_messages` thread (CX3).
3. **Proactive alert** — when a client *transitions into* `at_risk`/`regressing`, the assigned coach gets a notification through the existing server-side rail (`subscription-checker` cron → `notify()`), so intervention happens in days, not at the next check-in.

All three read one new **read-only view** `v_client_pulse` (a *classifier* over existing views/tables). **No new scoring math, no new write tables.**

> One feature, three actors: adherence (client), intervention speed (coach), retention (business) are the *same signal*. Building on one `pulse_status` keeps them consistent and is the minimal surface that moves all three.

---

## 2. Why this is the highest-impact next feature

- **It hits all four stated goals at once** (retention, adherence, coach-intervention speed, business growth via reduced churn) from infrastructure that already exists — the platform already computes recovery/adherence; F8 is the missing *decision + alert* layer.
- **Reuse-first / low blast radius.** Core value (S1–S3) is a read-only view + two UI surfaces — no new tables, no new RLS write policies, no F7 changes.
- **It does NOT depend on the pending authenticated smoke or on unverified production writes.** Its core is reads; its only writes are (a) coach nudges via the **already-verified** `coach_messages` path (CX3) and (b) alerts via the **already-live** server-side `notify()` cron rail — both pre-existing and exercised. (See §13.)
- **Why not referrals (explicitly considered).** Referrals targets only *growth*, requires **new tables + new write RLS + abuse/fraud controls + likely an edge function**, and would add unverified write surfaces at a moment when the authenticated smoke and H-A write-gate are still open. It is higher-risk and narrower than Recovery Pulse. Recommendation: **keep referrals design-only/parked**; Recovery Pulse is the better Feature 8 now.

---

## 3. Business value

- **Retention ← catching silent churn.** Cancellations are usually preceded by silent disengagement (stopped logging) + a lapsing subscription. Pulse fuses low adherence with `v_client_subscription_state.effective_status` (`grace`/`expired`) into a single churn-risk flag, opening a re-engagement window before the client quietly leaves.
- **Coach efficiency / scale.** Turns "manually open every client" into "act on the top 3," letting a coach carry a larger book without dropping at-risk clients — a direct margin lever.
- **Outcome quality → reputation/referrals (organic).** Faster intervention on regression improves clinical outcomes, which is the strongest organic growth driver for a rehab product.

## 4. User value

- **Client:** sees effort tied to visible recovery + a forgiving weekly streak → habit loop that increases adherence; never shamed (rest days don't break streaks; brand-new clients aren't alarmed).
- **Coach:** a prioritized, reason-annotated worklist ("No session in 9 days", "Recovery −12", "Subscription in grace") + one-tap nudge to the existing conversation → intervention in days, not weeks.

---

## 5. Exact systems / tables / modules reused (all verified to exist)

| Layer | Reused artifact | Used for |
|---|---|---|
| View (F4) | `v_client_progression` (`security_invoker`) | adherence %, recovery, overall, `delta_7d_routine` (momentum) |
| View (F1) | `v_client_subscription_state` | churn-risk fusion |
| Table | `progress_snapshots` | regression trend (latest vs prior composite) |
| Table | `progress_logs` | rising-pain secondary signal |
| Tables | `daily_routine_logs`, `workout_sessions` | streak + last-activity |
| Table | `profiles` (`assigned_coach`, `current_phase`, `role`) | RLS scoping + display |
| Messaging | `coach_messages` + `Community.sendMessage` (CX3) | coach **nudge** (verified write path) |
| Notifications | `notify()` RPC + `notifications` inbox (F3) | proactive alert (server-side only) |
| Edge/cron | `subscription-checker` (Vault-gated, `verify_jwt=false`) | alert pass on pulse transitions |
| F7 | `Clients.openRecovery()` recovery modal | triage row deep-link (read-only reuse) |
| Client UI | `clientDashboard.js` (`#client-dashboard-root`) | client Pulse card |
| Coach UI | `clients.js` (`#section-clients`) + `app.html` | "Needs Attention" panel + badge |

**Net new artifact:** exactly **one** read-only view (`v_client_pulse`) + covering indexes. No new tables, no schema changes to existing tables, no new edge function, no new RLS write policy.

---

## 6. Frontend architecture

- **Client Pulse card** (`clientDashboard.js`): reads `v_client_pulse` for self; renders streak + weekly ring + momentum + honest cold-start/empty state; CTA respects `SubscriptionService.canWrite()` (shows "renew to resume logging" when read-only, never a dead action). Presentation-layer, reuses `--nc-*` tokens.
- **Coach "Needs Attention"** (`clients.js` + minimal `app.html` markup): a ranked panel (sorted by `severity`) above the client list + a sidebar count badge; each row shows `pulse_status` + `reasons[]` and two actions — **Open Recovery** (`Clients.openRecovery()`, reused F7) and **Nudge** (opens/sends on the existing `coach_messages` thread).
- **No realtime** for v1 — periodic fetch on section load + manual refresh (deliberately avoids the F-2 unsubscribe-leak class entirely). If realtime is ever added, it must follow the CX3 subscribe/unsubscribe-on-teardown pattern.
- **Refresh discipline:** one query per surface on load; coach query is a single read of `v_client_pulse` filtered by `assigned_coach` (RLS-enforced), not N per-client calls.

---

## 7. Backend / RLS / Edge / migration impact

- **Migration (additive, 1):** create `v_client_pulse` `WITH (security_invoker = true)` — the exact pattern `v_client_progression` / `v_client_subscription_state` already use, so RLS auto-applies (client → own row; coach → assigned; admin → all) with **no new policy**. Add covering indexes: `progress_snapshots(client_id, session_date desc)`, `daily_routine_logs(client_id, log_date)`, `workout_sessions(client_id, status, started_at)`.
- **Classifier lives in the view** (thresholds as SQL constants), priority `regressing > at_risk > slipping > on_track`, with `new`/`dormant` cold-start guards. No scoring logic duplicated in JS.
- **RLS:** none added/changed. Read-only view inherits caller scope via `security_invoker`.
- **Edge/cron (phase S4, optional/independently shippable):** extend the existing `subscription-checker` with a second pass that reads `v_client_pulse` and calls `notify()` for assigned coaches **on transition only**, deduped per ISO week (same pattern the subscription notifications already use). **No new edge function, no new cron job.**
- **Writes:** none introduced by the view/UI. The coach **nudge** uses the existing `coach_messages` insert (CX3, RLS = participant check, verified). Alerts use `notify()` from the service-role cron (existing rail). → **F8 introduces no new client-side write path.**

---

## 8. Risks

| Risk / edge case | Impact | Mitigation |
|---|---|---|
| **Cold start** (adherence tables sparse today) | New/quiet clients mislabeled "at risk" | `new`/`dormant` guards on program `published_at` age + min-data thresholds; tenure floor before any alert |
| **Alert fatigue** | Coaches ignore the queue | Alert on **transitions only**, dedup per ISO week, conservative thresholds, archivable via existing inbox |
| **Regression needs ≥2 snapshots** | No trend on first assessment | Skip regression component when <2 `progress_snapshots`; never fabricate a trend |
| **Read-only (grace/expired) clients** | Card prompts an action they can't take | Card respects `SubscriptionService.canWrite()`; show renew copy instead |
| **View performance** for large coach books | Slow Clients view | Reuse pre-aggregated `v_client_progression`; add S1 covering indexes; keep `v_client_pulse` a thin join; `EXPLAIN` in live verify |
| **`notify()` is server-side only** | A naïve "message via notify()" design would fail | Nudge uses `coach_messages` (verified); `notify()` used only by the cron — corrected vs the earlier draft |
| **F-2 realtime unsubscribe leak** | Memory/channel leak | v1 uses no realtime; if added later, follow CX3 teardown pattern |
| **Timezone/streak off-by-one** | Wrong streaks across DST | Use `log_date` (date) semantics already in schema; compute in the view only |
| **Don't touch F7** | Regression in recovery modal | F8 is read-only over F7 data and *reuses* `openRecovery()`; no F7 logic change |
| **Coach scoping correctness** | A coach seeing another coach's client | `security_invoker` + existing `assigned_coach` RLS; **live-verify per role** before ship (§10) |

---

## 9. Rollback plan

- **S1 (view + indexes):** fully reversible — `DROP VIEW v_client_pulse;` + `DROP INDEX` (additive, no data mutation). Ship the down-migration alongside the up-migration. Nothing else reads the view until S2/S3, so dropping it is safe.
- **S2/S3 (UI):** revert the commit(s); presentation-only, no persisted state. Front end degrades to pre-F8 (card/panel simply absent).
- **S4 (cron alert pass):** guard behind a config check; rollback = revert the `subscription-checker` change and redeploy the prior function version. Alerts are idempotent (per-ISO-week dedup), so a re-run after rollback cannot double-send.
- **Deploy-level:** because `main`→Pages is the release path, rollback of UI = revert-merge + the auto-deploy ships the prior bundle; rollback of DB = run the down-migration.

## 10. Verification plan (per `AI_WORKFLOW_GUARDRAILS.md` §3)

- **S1:** live DB verification — client sees only own row, coach sees only assigned, admin all; seeded data yields correct `pulse_status` for each branch; `EXPLAIN` sane. (DB/RLS change → §8 architecture-first + live verify.)
- **S2/S3:** `node --check` changed JS; `npm run build`; browser smoke (client card renders with/without data, read-only state correct; coach panel ranks correctly, deep-link opens the right F7 modal, nudge posts to the right `coach_messages` thread); route/regression check (no existing Clients/Today regressions; coach/admin unchanged).
- **S4:** edge-function probe — alert fires once per transition, dedups across re-runs, deep-links correctly; missing/duplicate cron runs are safe.
- **Cross-role:** fold the coach-facing rows into the still-pending manual smoke (§13) before production ship.

## 11. Guard-skills plan (per §4 order)

1. **Mechanical first:** `node --check`, `npm run build`, browser smoke, live DB verify (S1), edge probe (S4).
2. **clean-code-guard:** architecture/code review (naming, function size, SOLID, DRY/KISS/YAGNI) on each phase's diff.
3. **AI-failure-mode review:** swallowed errors, defensive guards, premature abstraction, dead code, hallucinated APIs (verify every Supabase call/column against source), mock/"success" fixtures, plausible-but-wrong thresholds.
4. **docs-guard:** when `FEATURE_STATUS` / `PROJECT_STATUS` / `NEXT_STEPS` are updated (S5).
- Fix only real findings; no speculative refactors of stable code.

## 12. Implementation phases (each = one approved, committed, verified phase; stop between)

- **S1 — `v_client_pulse` view + indexes** (1 additive migration + down-migration). DB/RLS → architecture-first already covered here; live-verify per role.
- **S2 — Client "Recovery Pulse" card** (`clientDashboard.js`). Frontend-only; reads the view; respects write-gate.
- **S3 — Coach "Needs Attention" triage** (`clients.js` + `app.html`); reuse `openRecovery()` + `coach_messages` nudge.
- **S4 — Proactive alerts** (extend `subscription-checker`; transition-only, deduped). Edge/cron → architecture-first + rollback; independently shippable/optional.
- **S5 — Verify + simplify + docs** (full regression sweep, guard-skills, update status docs via docs-guard).

> S1–S3 deliver full standalone value reading the view from the browser. S4 is the only deeper backend touch and is optional/phased.

## 13. What must be fixed BEFORE coding Feature 8

- **No hard code blocker for S1–S3.** Core value is read-only over existing, verified views.
- **Gating approvals (process, not fixes):** S1 (new view/indexes) and S4 (cron) are DB/Edge → require **architecture approval + live verification + rollback** per §8 before their code lands.
- **Before shipping F8 to production:** the **coach-facing authenticated flows must be smoke-verified** — i.e. the pending **manual smoke A–E** (esp. section C/D) should be run for the Clients view (a real coach + ≥1 assigned client). F8 *design/build* is not blocked, but its *production ship* folds into closing that gap. **Do not ship F8 to production while the coach authenticated smoke is unrun.**
- **Confirm before S3:** whether a coach "reactivate subscription" quick-action maps to an existing verified flow; if not, omit it from v1 (nudge + Open Recovery are sufficient and verified).

## 14. What can run in parallel (independent of F8)

- **H-A subscription write-gate hardening** — independent; F8 only *reads* `canWrite()`, doesn't change it.
- **`case_shares` INSERT RLS defense-in-depth (F-4)** — unrelated surface; can proceed anytime.
- **Community realtime unsubscribe cleanup (F-2)** — independent; F8 v1 deliberately avoids realtime.
- **Manual authenticated smoke A–E** — independent; recommended to run *before* F8 S3 ships so coach flows are validated (see §13).

---

## Verdict

Recovery Pulse is the highest-leverage Feature 8: it converts already-computed recovery/adherence scores into a client habit loop, a ranked coach worklist, and an early churn-warning — moving retention, adherence, intervention speed, and (organically) growth at once. It is frontend-first, adds exactly one read-only view (+ indexes) and one optional cron extension, reuses the F7 modal / `coach_messages` / notifications inbox, introduces **no new client write path**, and depends on **no unverified production write**. Referrals is explicitly deferred as lower-impact and higher-risk for this slot.

*Design only. No code, schema, data, migration, edge function, or deployment was created or modified. Stop and await approval before any implementation phase.*
