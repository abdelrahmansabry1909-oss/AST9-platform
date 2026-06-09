# Feature 8 · Coach Visibility — RLS Architecture Plan

**Status:** Analysis & architecture only. **No SQL, no migration, no code.** Awaiting approval (per `AI_WORKFLOW_GUARDRAILS.md` §2 + §8 — touches **RLS · roles · coach/client visibility**).

**Trigger:** during F8 test-account verification, a coach was observed to read all clients via `v_client_pulse`, traced to the global `profiles` SELECT policy `is_admin_or_coach() OR id = auth.uid()`.

---

## 0. Guardrails framing (§2)

- **Objective:** decide the safest way to make Feature 8 coach visibility assigned-scoped, and document the broader root cause.
- **Files/objects likely affected (at implementation time, later):** `public.v_client_pulse` (recommended), optionally the `profiles` SELECT policy (separate phase). No front-end code change required for the recommended fix.
- **Data/RLS/Edge impact:** RLS/view behavior change on a read-only view (recommended) — additive, idempotent, reversible. No table data changes.
- **Risk level:** **Low** for the recommended fix (B); **High** for the broad fix (A) — quantified below.
- **Verification plan:** per-role JWT-claims impersonation + UI smoke (§9).

---

## 1. Corrected problem statement (what's actually true)

Investigation refined the original premise. Two distinct facts:

1. **The F8 coach panel's *rendered output* is already assigned-scoped in practice.** Every per-client source table the pulse view reads — `workout_sessions`, `daily_routine_logs`, `progress_snapshots`, `subscriptions`, `client_programs` — is already RLS-scoped to `is_admin() OR assigned_coach = auth.uid()` (see §2.3). So a **non-assigned** client's data is invisible to a coach; that client therefore computes as `new` (severity 0, no lapsed status) and **cannot pass the panel filter** (`severity≥2 OR churn_risk OR effective_status in (grace,expired)`). Verified in the F8 run: the test coach's panel showed only its 4 assigned test clients; the 2 real (other-owner) clients appeared as `new` and were excluded.

2. **What genuinely leaks** is narrower-but-real:
   - **(L1) `v_client_pulse` row enumeration:** because `profiles` is globally readable by staff and the view's client set derives from `profiles` (via `v_client_progression`), a coach's `SELECT * FROM v_client_pulse` returns a **row (client_id + `new` + zeros) for every client** — i.e. it discloses client *existence/count*, though no PII and no real metrics. **Severity: Low.**
   - **(L2) `profiles` PII exposure (the real issue, and it is NOT F8-specific):** the global `profiles` SELECT policy lets **any coach read every client's full profile** — `full_name, email, phone, age, goal, injury_history` — directly via `clients.js` (`loadAll`, `select('*').eq('role','client')`), the dashboard, and client pickers. **Severity: Medium–High, but latent today** (only 1 admin, 0 real coaches; admin is allowed to see all). Becomes live the moment a real `coach` account exists.

**Implication:** the F8 panel is functionally safe today, but (a) the view's *contract* ("coach = assigned") is not actually enforced by the view, and (b) the platform has a real coach-PII exposure that must be fixed before onboarding real coaches.

---

## 2. Investigation findings (live)

### 2.1 `profiles` policies
| Policy | Cmd | Predicate |
|---|---|---|
| Coaches and admins read all profiles | SELECT | `is_admin_or_coach() OR id = auth.uid()` ← **root cause** |
| Admins insert profiles | INSERT | `with check: get_my_role() in ('admin','coach')` |
| Admins update any profile | UPDATE | `get_my_role() = 'admin'` |
| Users update own profile | UPDATE | `id = auth.uid()` |

### 2.2 Helper functions (all `STABLE SECURITY DEFINER`, read `profiles` by `auth.uid()`)
`is_admin()`, `is_coach()`, `is_admin_or_coach()`, `get_my_role()`. A reusable **`is_admin()` + `assigned_coach = auth.uid()`** idiom is already the established per-table pattern. *(No `is_assigned_coach(client_id)` helper exists yet — could be added for DRY, optional.)*

### 2.3 Per-table SELECT RLS — **already assigned-scoped (the important finding)**
| Table | Coach read predicate |
|---|---|
| `workout_sessions` | `is_admin() OR coach_id=uid OR (assigned_coach=uid)` |
| `daily_routine_logs` | `is_admin() OR (assigned_coach=uid)` |
| `progress_snapshots` | `is_admin() OR (assigned_coach=uid)` |
| `subscriptions` | `is_admin() OR (assigned_coach=uid)` |
| `client_programs` | `is_admin() OR coach_id=uid OR (assigned_coach=uid)` |
| `assessments`, `subjective_assessments`, `exercise_alternative_requests`, `case_shares` | scoped to admin / owner-coach / assigned / participant |
| `coach_messages` | `sender_id=uid OR receiver_id=uid` |
| **`profiles`** | **`is_admin_or_coach() OR self`  ← the only global-for-staff one** |

So `profiles` is the lone outlier; everything else already enforces assignment.

### 2.4 Code dependencies on the global `profiles` read (grep of `js/`)
| Surface | Reads profiles how | Needs global read? |
|---|---|---|
| `clients.js:17` Clients table (`loadAll`) | `select('*').eq('role','client')` (all clients) | **This is L2** — should be assigned-scoped for coaches |
| `clients.js:564` Needs Attention names | `select(...).in('id', rows.client_id)` (only filtered rows) | No — already only assigned rows |
| `dashboard.js:216/327/436/980/1002/1048` | client/coach lists & counts | Mostly admin views; coach client-count would change under A |
| `workoutSession.js:614`, `dailyRoutine.js:429`, `rpm/graph-builder.js:112` | client pickers `eq('role','client')` (all) | Coach pickers would scope under A |
| `communityUI.js:153` | client reads **their coach's** profile (thread name) | **Yes — A must preserve client→assigned-coach read** |
| `community.js:490` `loadOtherCoaches` | coach reads other coaches/admins | **Yes — A must preserve coach→staff read** |
| `communityUI.js:330` referral client select | already `eq('assigned_coach', uid)` | No (parked feature) |
| `charts.js`, `progressReport.js`, `progressionEngine.js`, `rpm/approval.js` | per-id or admin contexts | Per-id reads unaffected |

**Conclusion:** tightening `profiles` globally (A) has real cross-surface dependencies — especially **community/messaging name resolution** (client must read its coach; coach must read other staff). Any A implementation must preserve those or community breaks.

---

## 3. Option analysis

### A. Tighten the global `profiles` SELECT policy
Replace with role-aware predicate, e.g.:
`is_admin() OR id = auth.uid() OR (is_coach() AND (assigned_coach = auth.uid() OR role IN ('coach','admin'))) OR (id = (select assigned_coach from profiles me where me.id = auth.uid()))`
- **Pros:** fixes the *root cause* — closes L1 **and** L2 (clients.js PII), platform-wide and "correct."
- **Cons / blast radius:** **High.** Affects every coach screen that lists clients (Clients table, dashboard counts, pickers) and **risks breaking community/messaging** (client reading coach name; coach reading other coaches) unless the predicate is carefully crafted and fully regression-tested. A self-referential `profiles` predicate (reading `assigned_coach` of the caller from `profiles` inside a `profiles` policy) needs a `SECURITY DEFINER` helper to avoid RLS recursion. Larger surface, more failure modes.

### B. Leave `profiles`; scope `v_client_pulse` explicitly  ✅ **recommended (now)**
Add a final predicate to the read-only view:
```sql
... FROM flags
WHERE public.is_admin()
   OR flags.client_id = (select auth.uid())
   OR EXISTS (select 1 from profiles p
              where p.id = flags.client_id and p.assigned_coach = (select auth.uid()));
```
- **Pros:** mirrors the existing per-table pattern exactly; makes the view's "coach = assigned" contract **actually enforced**; **eliminates L1 enumeration**; **zero blast radius** (only consumers of `v_client_pulse` are the S2 card + S3 panel); `CREATE OR REPLACE` (idempotent); trivial rollback. Admin still all, client still self.
- **Cons:** does **not** fix L2 (the `profiles`/`clients.js` PII exposure) — that remains for a follow-up. (Acceptable: L2 is latent with 0 real coaches.)

### C. New coach-scoped wrapper view for F8 only
A separate `v_client_pulse_coach` filtering by `assigned_coach`, with the panel querying the wrapper.
- **Pros:** keeps base view untouched.
- **Cons:** an extra object for no benefit over B (only F8 consumes the base view today); two objects to keep in sync. **Reject.**

---

## 4. Recommended approach

**Two-track:**

1. **Now — Option B** (scope `v_client_pulse`). Smallest correct change that makes the F8 coach panel/view provably assigned-scoped, closes L1, and is safely reversible with no impact on any other screen. This unblocks F8 smoke with an honest "coach = assigned" guarantee.
2. **Follow-up (separate, explicitly-approved phase) — Option A** (tighten `profiles`) to close **L2** (coach PII exposure in `clients.js`/dashboard/pickers). **Required before any real `coach` account is created.** Must include a community/messaging regression and a `SECURITY DEFINER` helper (e.g. `my_assigned_coach()`) to avoid `profiles` policy recursion.

**Reject C.**

**Why B is safest:** it touches exactly one read-only object that only Feature 8 consumes, follows the same `is_admin() OR assigned_coach=auth.uid()` idiom already proven on five sibling tables, is idempotent and instantly reversible, and cannot affect community, messaging, the Clients table, pickers, or admin workflows. A, by contrast, changes a policy that ~10 code paths depend on (including client-side community name resolution) and carries genuine regression risk — appropriate as its own gated phase, not bundled into F8.

---

## 5. Exact objects likely affected

**Option B (now):**
- `public.v_client_pulse` — `CREATE OR REPLACE VIEW` adding the scope `WHERE` (keeps `security_invoker=true`, same columns, same grants). **Only object changed.**
- New migration `supabase/migrations/<ts>_feature8_v_client_pulse_scope.sql` + paired rollback in `supabase/rollbacks/`.

**Option A (follow-up, for reference):**
- `profiles` SELECT policy (drop "Coaches and admins read all profiles"; create admin/coach/client-scoped policies).
- Likely a `SECURITY DEFINER` helper `my_assigned_coach()`.
- Front-end: none required if the policy preserves all current reads; otherwise targeted fixes in `community*`/pickers.

---

## 6. RLS implications per surface (requested list #5)
| Surface | Under B (recommended) | Under A (follow-up) |
|---|---|---|
| **`v_client_pulse`** | Coach = assigned only; admin = all; client = self. L1 closed. | Same (and L1 closed at source). |
| **`v_client_progression`** | Unchanged. Shares L1: `progressionEngine.listAll()` (`select('*')`, js/progressionEngine.js:45) returns all clients to a coach (zeros for non-assigned, since the data tables are scoped); `getScores()` is per-`client_id`. **Scope it the same way in the A/follow-up phase.** | Closed at source via `profiles`. |
| **`clients.js` (Clients table, L2)** | **Unchanged — still all clients to a coach.** Flagged as follow-up. | Coach sees only assigned; admin all. |
| **Coach Needs Attention panel** | Provably assigned-scoped (view enforces it). | Same. |
| **F7 recovery modal (`openRecovery`)** | Data already per-table scoped (empty for non-assigned). With B, coach reaches it only from assigned rows; opening an arbitrary id still shows no data. | Coach can only enumerate assigned clients to open. |
| **Program publishing** | Unaffected (`client_programs` already scoped; only the client *picker* lists all). | Picker scopes to assigned. |
| **Daily routine** | Unaffected (`daily_routine_logs` scoped; picker lists all). | Picker scopes to assigned. |
| **Subscriptions** | Unaffected (admin-write; coach-read already scoped). | Same. |
| **Case studies** | Unaffected (`case_shares` scoped by status/owner/admin). | Verify author/client name display still resolves. |
| **Community / messaging** | **Unaffected** (profiles untouched). | **Risk:** must preserve client→coach name (`communityUI.js:153`) and coach→staff list (`community.js:490`); regress thread names + dropdowns. |

---

## 7. Migration strategy

**B (now):**
1. Author `<ts>_feature8_v_client_pulse_scope.sql` = the current `v_client_pulse` definition **plus** the §3.B `WHERE`. `CREATE OR REPLACE` (no drop; columns/grants/`security_invoker` preserved).
2. Paired rollback file = the **current** definition (captured verbatim from `pg_get_viewdef`, already on hand).
3. Apply to prod via MCP (same path as S1); record in migration registry.
4. Verify (§9) before/after.
- Additive, idempotent, no data change, no dependent-object breakage (signature identical).

**A (follow-up, outline only):** add `my_assigned_coach()` SECURITY DEFINER helper → drop+recreate `profiles` SELECT policies (admin-all / coach-assigned+staff / client-self+coach) in one migration → full community/messaging + pickers regression → paired rollback restoring the single original policy.

---

## 8. Backward-compatibility risks
- **B:** essentially none. Only `v_client_pulse` consumers (S2 card, S3 panel) are affected, and only to *remove* non-assigned rows — which the panel already filtered out. Client card (`.eq('client_id', self)`) and admin unaffected.
- **A:** material. Could break (i) client community thread coach-name, (ii) coach↔coach messaging/referral dropdowns, (iii) any community member-name display, (iv) coach client pickers/counts. All must be regression-tested; risk of `profiles`-policy recursion if not using a SECURITY DEFINER helper.

---

## 9. Verification / smoke plan (requested #8)
Run via JWT-claims impersonation (service-role SQL) **and** authenticated UI, using the existing `@ast9.test` fixtures:

**Core (post-B):**
1. **Test coach sees only assigned** — `v_client_pulse` as `test.coach` returns exactly the 6 assigned test clients (panel = 4 qualifying); **zero** rows for any non-assigned/real client.
2. **Admin sees all** — admin `v_client_pulse` returns all clients (test + real); panel unchanged.
3. **Client sees self only** — `pulse.track` returns 1 row (own); client card renders.
4. **Real clients absent under test coach** — the 2 `@gmail.com` clients do **not** appear in the test coach's `v_client_pulse` at all (not even as `new`).
5. **No coach/admin regressions** — admin Clients table, F7 modal, program publish, daily routine, subscriptions all still load; **community thread names + messaging unaffected** (B doesn't touch `profiles`, so this is automatic — but smoke it anyway).

**Gate:** 0 console errors; per-role counts match; rollback rehearsed (re-apply prior view def → behavior reverts).

**(A phase adds:** coach Clients table shows only assigned; client community thread still shows coach name; coach→coach messaging dropdown still populates.)

---

## 10. Rollback strategy
- **B:** `CREATE OR REPLACE VIEW public.v_client_pulse` back to the captured current definition (in the paired rollback file). Instant, inert — S2/S3 revert to prior behavior. No data implications.
- **A:** drop the new `profiles` policies; recreate the original "Coaches and admins read all profiles" policy; drop the helper. Restores prior behavior exactly.

---

## 11. Risk assessment
| Item | Likelihood | Impact | Mitigation |
|---|---|---|---|
| B changes other screens | Very low | Low | Only F8 consumes `v_client_pulse`; identical signature. |
| B mis-scopes (admin/client) | Low | Med | Predicate mirrors proven per-table idiom; verify all 3 roles (§9). |
| L2 (coach PII) left open after B | Certain (by design) | Med, **latent** | 0 real coaches today; schedule A before onboarding coaches; tracked as follow-up. |
| A breaks community/messaging | Medium | High | Preserve client→coach + coach→staff reads; full regression; SECURITY DEFINER helper to avoid recursion. |
| `profiles` policy recursion (A) | Medium | High | Use `my_assigned_coach()` SECURITY DEFINER, never self-select inside the policy. |

---

## 12. Recommendation summary
**Do B now** (one-line view scope; zero blast radius; closes the F8 enumeration and makes "coach = assigned" real) → resume F8 smoke. **Schedule A as a separate, approved phase** to close the genuine coach-PII exposure in `clients.js`/dashboard/pickers **before any real coach account exists**, with a dedicated community/messaging regression.

---

*Analysis only — no SQL, migration, or code applied. Do not implement until approved. No S4, no referrals, no destructive smoke, no new test data.*
