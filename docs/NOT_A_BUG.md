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

## 4. Authenticated staging smoke skips when staging is not configured
- **Behavior:** The authenticated Playwright project skips when all staging
  configuration is absent. Partial configuration fails; production targets are
  rejected, external frontend targets are rejected, and production Supabase HTTP
  and WebSocket endpoints are blocked.
- **Why intended:** P3A requires disposable staging identities. Production users
  and production data must never be used as CI fixtures.
- **Approved / phase:** Owner — P3A-1 production-verification baseline.
- **Do not change:** do not remove the staging target validation, synthetic email
  marker, production request blocker, or privacy settings. Do not report skipped
  tests as authenticated smoke passing.

## 5. No fake AI scores, norms, percentiles, or risk %
- **Behavior:** Movement observations store raw values + coach qualitative rating +
  finding tags + pain/confidence + self-referential asymmetry + notes only. No
  0–100 score, no norm band, no percentile, no risk %, no ML output.
- **Why intended:** Product rule — no invented/normative medical content. Scoring is
  deliberately deferred.
- **Approved / phase:** Owner — F3B movement observations design.
- **Do not change:** do not add scoring/normative/ML fields to athletic tables
  without an explicit, approved phase.

## 6. The shoulder chart has no deltoid curve and no client line
- **Behavior:** The scapular activation chart plots exactly three muscles (upper
  trapezius, serratus anterior, lower trapezius) and draws no client-specific
  EMG series. The middle deltoid, supraspinatus and middle trapezius appear only
  as text under a "Described, not plotted" heading.
- **Why intended:** Both absences are the product rule in #5 applied to the rehab
  lane. Neumann Fig. 5-51 plots curves for those three muscles only; the others
  are described in prose with no plotted data, so a curve for them would be
  invented. Likewise the source gives graded normative curves but no graded
  client-side modifiers — only paralysis cases — so a client EMG line would be
  fabricated data drawn in the same visual language as the measured curves. What
  the assessment can honestly state is where the arc **stops**, so that is what
  is drawn, as a cutoff band.
- **Approved / phase:** [DECISIONS.md](DECISIONS.md) D15 and D16 (PR #209).
- **Do not change:** do not add a deltoid/supraspinatus curve or a client EMG
  series. `tests/unit/shoulder-activation.test.js` fails if either appears. If
  real client EMG is ever measured, revisit D16 first — not the chart.

## 7. The analysis panels start folded shut
- **Behavior:** After a movement analysis runs, the score, integration, scapular
  activation and gait panels all render collapsed. The whole panel header is the
  toggle, not just the chevron.
- **Why intended:** The four panels together are far longer than a viewport, so
  an expanded default buried the rest of the page. The header is the hit target
  because the first version made only the chevron clickable and the owner
  reported the control as not working — people aim at the bar.
- **Approved / phase:** Owner-directed, PR #208.
- **Do not change:** a chart inside a folded panel must be built on reveal, never
  on construction — see [ISSUE_LOG.md](ISSUE_LOG.md) #27 for why Chart.js cannot
  recover from a first paint in a hidden box.
