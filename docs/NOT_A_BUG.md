# AST9 — Not a Bug / Intended Behavior

> Things that can look like bugs but are intended. Before "fixing" any of these,
> check here first. Each entry: behavior → why intended → who approved / phase →
> what not to change.

---

## 1. Athletic Performance is locked for coaches
- **Behavior:** Coaches see a `Performance 🔒` switcher; selecting it opens a
  "locked" modal and bounces back to Rehab. All Athletic sections are blocked for
  non-admins.
- **Why intended:** Athletic Performance is an unfinished, admin-only preview; it
  must not reach coaches or clients until fully smoked.
- **Approved / phase:** Owner — Phase R1A, PR #72.
- **Do not change:** the `ATHLETIC_SECTIONS` gate and `switchService` admin check
  in `js/dashboard.js`, or the `modal-athletic-locked` flow, without owner approval.

## 2. Clients cannot see the Athletic switcher
- **Behavior:** The service switcher is not shown to clients at all.
- **Why intended:** Service switching is a coach/admin concept; clients only ever
  see their assigned (Rehab) experience.
- **Approved / phase:** Owner — service-shell design (F1) + R1A.
- **Do not change:** the role visibility of the switcher.

## 3. Supabase Preview check fails / is skipped on frontend-only PRs
- **Behavior:** The "Supabase Preview" CI check reports failure (or is skipped) and
  the PR shows `UNSTABLE`.
- **Why intended:** The preview project has a baseline-migration gap; the check is
  isolated and known-non-blocking. `mergeable=MERGEABLE` is what matters.
- **Approved / phase:** Owner — documented across migration phases.
- **Do not change:** do not chase this check green; do not add a baseline migration
  just to satisfy it without owner direction.

## 4. Real browser smoke is unavailable in the agent/Antigravity environment
- **Behavior:** Automated authenticated browser save/visual smoke cannot be run
  here; reports say "owner manual smoke pending."
- **Why intended:** Environment limitation (no real authenticated browser session),
  not an app defect. Backend behavior is verified by impersonated SQL instead.
- **Approved / phase:** Owner — standing limitation.
- **Do not change:** do not fabricate a "smoke passed" result; label honestly.

## 5. No fake AI scores, norms, percentiles, or risk %
- **Behavior:** Movement observations store raw values + coach qualitative rating +
  finding tags + pain/confidence + self-referential asymmetry + notes only. No
  0–100 score, no norm band, no percentile, no risk %, no ML output.
- **Why intended:** Product rule — no invented/normative medical content. Scoring is
  deliberately deferred.
- **Approved / phase:** Owner — F3B movement observations design.
- **Do not change:** do not add scoring/normative/ML fields to athletic tables
  without an explicit, approved phase.
