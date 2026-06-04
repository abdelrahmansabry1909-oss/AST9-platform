# Feature 8 — "Recovery Pulse": Adherence & Regression Early-Warning

**Status:** Design only — no code, schema, or backend changes proposed yet. Awaiting approval.
**Builds on:** F1 (subscription state), F2 (workout sessions), F4 (progression engine), F7 (assessment / recovery hologram).
**Design principle:** reuse the existing scoring infrastructure; add a thin *decision + alert* layer, not new analytics.

---

## 1. The single concept

**Recovery Pulse** — one shared per-client "pulse" signal that powers three surfaces:

1. **Client adherence loop** — a "Recovery Pulse" card on the client dashboard: weekly adherence ring, an active-week streak, and a *momentum* arrow that links their consistency to their recovery trend ("5/6 sessions this week — recovery trending ↑"). One honest CTA: *Log today's session*.
2. **Coach triage queue** — a "Needs Attention" list in the Clients view that ranks assigned clients by risk (regressing → at-risk → slipping), each row deep-linking to the **F7 ◉ Recovery** modal. Turns "scan every client manually" into "act on the top 3."
3. **Proactive alert** — when a client *crosses into* at-risk or regressing, the assigned coach gets a notification (existing inbox) — so intervention happens in days, not at the next check-in.

All three read **one source of truth**: a new read-only view `v_client_pulse` that joins what already exists. There is **no new scoring math** — Pulse is a classifier over `v_client_progression` + `v_client_subscription_state` + `progress_snapshots`.

> Why one feature, not three: adherence (client), intervention speed (coach), and retention (business) are the *same signal* viewed by three actors. Building them on one `pulse_status` keeps them consistent and is the minimal surface that moves all three metrics.

---

## 2. Why it increases adherence & retention (business logic)

- **Adherence ← visible progress + streaks.** The strongest evidence-based driver of rehab program consistency is tying *effort* to *visible recovery* and a loss-averse streak. We already have the recovery scores (`v_client_progression.recovery`, `overall`, `delta_7d_routine`); Pulse surfaces them as a habit loop the client checks daily.
- **Intervention speed ← automated early warning.** Today a coach learns a client lapsed or regressed only by manually opening each client. Pulse flips that: regression in `progress_snapshots.composite_score` or an adherence drop fires an alert and floats the client to the top of the queue — catching deterioration **before** the next scheduled session.
- **Retention ← catching silent churn.** Cancellations are usually preceded by silent disengagement (stopped logging) and/or a lapsing subscription. Pulse fuses *low adherence* with `v_client_subscription_state.effective_status` (`grace`/`expired`) into a single **churn-risk** flag, giving the coach a window to re-engage before the client quietly leaves. Clients who see streaks/progress also perceive more ongoing value → fewer voluntary cancels.

---

## 3. Exact connection to the existing system

### Data inputs (all already exist — reused, not modified)
| Source | Provides | Pulse uses it for |
|---|---|---|
| `v_client_progression` (view, F4) | `routine_adherence_pct_7d/30d`, `workouts_completed_7d`, `compliance/recovery/performance/overall`, `delta_7d_routine`, `exercise_completion_pct_30d`, `alt_requests_30d`, `generated_at`, `formula_version` | adherence %, momentum, recovery score |
| `v_client_subscription_state` (view, F1) | `effective_status`, `days_remaining`, `grace_days_left` | churn-risk fusion |
| `progress_snapshots` (table) | per-assessment `composite_score`, ROM/control/force/neurology, `session_date` | **regression trend** (latest vs prior composite) |
| `progress_logs` (table) | `overall_pain_scale`, `log_date` | rising-pain signal (secondary) |
| `daily_routine_logs` / `workout_sessions` | `completed`, `log_date`, `status`, `ended_at` | streak + last-activity (mostly via the progression view) |
| `profiles` | `assigned_coach`, `current_phase`, `role` | coach scoping (RLS), display |

### New artifact (the only DB addition)
- **`v_client_pulse`** — a read-only view, `WITH (security_invoker = true)` (the exact pattern `v_client_progression` and `v_client_subscription_state` already use → RLS auto-applies: a client sees only their row, a coach sees assigned clients, admin sees all). It emits per `client_id`:
  - `pulse_status` ∈ `on_track | slipping | at_risk | regressing | dormant | new`
  - `severity` (int, for sorting), `reasons` (text[] — e.g. `{"No session in 9 days","Recovery −12","Subscription in grace"}`)
  - `streak_weeks`, `adherence_7d`, `adherence_target`, `momentum` (`up|flat|down`), `composite_trend`, `last_activity_at`, `churn_risk` (bool)

### UI components
- **Client:** new "Recovery Pulse" card in `js/clientDashboard.js` (`#client-dashboard-root`), placed beside the existing progression gauges. Reads `v_client_pulse` for self.
- **Coach:** "Needs Attention" panel at the top of `#section-clients` (`js/clients.js`) + a sidebar badge count; each row → `Clients.openRecovery()` (**F7 modal, reused**) and optional quick actions (message, reactivate sub).
- **Alerts:** reuse the **notifications inbox** (`notify()` RPC + `js/notificationsService.js`); deep-link `link_section='clients'` with the client preselected.

### Flow
```
nightly cron (existing subscription-checker, Vault-secured)
   └─ scan v_client_pulse for assigned clients
        └─ on transition into at_risk / regressing → notify(coach)  [idempotent per ISO week]
client dashboard  ── reads v_client_pulse (self)  → Pulse card (streak/ring/momentum)
coach Clients view ── reads v_client_pulse (assigned) → ranked queue → F7 ◉ Recovery modal
```

---

## 4. Technical architecture

- **One view, one classifier.** All thresholds live as constants inside `v_client_pulse` (no per-call logic in JS). `pulse_status` is chosen by priority: `regressing > at_risk > slipping > on_track`, with `new`/`dormant` guards for cold start.
  - *regressing*: ≥2 `progress_snapshots` and latest `composite_score` below prior by ≥ threshold (or `recovery` dropped / `overall_pain_scale` rising). Clinical priority — fires regardless of adherence.
  - *at_risk*: `adherence_7d` < 40% **or** no completed workout in 7d **or** (`effective_status` ∈ `grace|expired` **and** low adherence) → churn-risk.
  - *slipping*: `adherence_7d` 40–70% or `delta_7d_routine` materially negative.
  - *on_track*: adherence ≥ target and no regression.
  - *new/dormant*: program `published_at` too recent or no data yet → neutral (never alarm a brand-new client).
- **Read-only & RLS-safe.** `v_client_pulse` is `security_invoker=true`; no table writes, no new RLS policies, no changes to F7 logic.
- **Alerts via existing rails.** The daily `subscription-checker` edge function (already `verify_jwt=false`, Vault-gated, service-role) gains a second pass that reads `v_client_pulse` and calls `notify()` for assigned coaches on *transitions*, deduped with the established `data->>'window'` (ISO-week) pattern used by `ensure_subscription_notifications`. **No new edge function, no new cron, no architecture change.**
- **Frontend-first.** S1 (view) + S2/S3 (UI) deliver full value reading the view directly from the browser; S4 (cron alerts) is the only backend touch and is independently shippable.

**Net additions:** 1 view (+ 2–3 covering indexes), 2 UI surfaces, 1 cron extension. No new tables, no schema changes to existing tables, no new edge function.

---

## 5. Implementation steps

- **S1 — `v_client_pulse` view + indexes (1 migration, additive).** Define the classifier; `security_invoker=true`. Add covering indexes: `progress_snapshots(client_id, session_date desc)`, `daily_routine_logs(client_id, log_date)`, `workout_sessions(client_id, status, ended_at)`. *Verify live:* a client sees only their row; a coach sees assigned; thresholds produce correct status on seeded data; EXPLAIN is sane.
- **S2 — Client "Recovery Pulse" card.** `clientDashboard.js`: render streak + weekly ring + momentum + CTA from `v_client_pulse`; honest cold-start/empty state; respects subscription read-only (no "log" prompt when access is read-only). *Verify:* renders for a client with/without data; no console errors; build green.
- **S3 — Coach "Needs Attention" triage.** `clients.js` + `app.html`: ranked panel + sidebar badge; row → **F7 `openRecovery`**; quick actions reuse existing flows (message via notify, reactivate via `reactivate_subscription`). *Verify:* coach sees only assigned, correct ranking, deep-link opens the right client's F7 modal.
- **S4 — Proactive alerts (only backend touch; optional/phased).** Extend `subscription-checker` to notify assigned coaches on pulse transitions, idempotent per ISO week. *Verify:* alert fires once per transition, dedups, deep-links; missing/duplicate cron runs are safe.
- **S5 — Verify + simplify + docs.** Full client/coach/empty regression sweep, `/simplify`, update `FEATURE_STATUS` / `PROJECT_STATUS` / `NEXT_STEPS`.

---

## 6. Risks, edge cases, failure points

| Risk / edge case | Impact | Mitigation |
|---|---|---|
| **Cold start** — adherence tables are essentially empty today | New/quiet clients wrongly flagged "at risk" | `new`/`dormant` guards on program `published_at` age + minimum-data thresholds; never alert before a tenure floor |
| **Alert fatigue** — too many/again-and-again alerts | Coaches ignore the queue | Alert only on **transitions** (not steady state), dedup per ISO week, conservative thresholds, archivable via existing inbox |
| **Regression signal needs ≥2 snapshots** | Can't compute trend for first assessment | Skip the regression component when <2 `progress_snapshots`; never fabricate a trend |
| **Subscription read-only clients** (grace/expired) | Client card prompts an action they can't take | Pulse card respects `SubscriptionService.canWrite`; show "renew to resume logging" instead of a logging CTA |
| **`notify()` actor-spoofing** (audit M-1) | Don't widen an existing soft spot | Alerts are generated server-side by the Vault-gated cron (service role); F8 does not expand `notify()` client exposure |
| **View performance** for coaches with many clients | Slow Clients view | Reuse the pre-aggregated `v_client_progression`; add the S1 covering indexes; `v_client_pulse` stays a thin join (lateral top-2 snapshot) |
| **Formula drift** — F4 changes `formula_version` | Thresholds miscalibrated | Pulse reads `formula_version`; thresholds are constants in one view, easy to retune; no logic duplicated in JS |
| **Streak demotivation** — punishing prescribed rest days | Hurts adherence instead of helping | Streak is **weeks on-track vs target**, not literal daily; rest days don't break it |
| **Timezone for "today"/streak** | Off-by-one streaks across DST/locales | Use `log_date` (date) semantics already in the schema; document the project's date convention; compute in one place (the view) |
| **Don't touch F7** | Regression risk | F8 is read-only over F7's data and *reuses* the F7 Recovery modal; no change to F7 core logic |

---

## Verdict

Recovery Pulse is the highest-leverage feature that hits all three goals at once, because the platform already produces the underlying scores — F8 is the **decision + alert layer** that turns existing analytics into client habit, coach action, and retention. It is frontend-first, adds exactly one read-only view (+ indexes) and one optional cron extension, reuses the F7 Recovery modal and the notifications inbox, and changes no existing table, RLS policy, edge function, or F7 logic.

*Design only. No code, schema, data, migration, edge function, or deployment was created or modified.*
