# PRE_MERGE_ACTION_PLAN.md — Client Mobile Redesign → `main`

**Type:** Analysis & planning only. No code changed, nothing committed, nothing deployed. This document is the only output.
**Date:** 2026-06-06
**Branch:** `claude/interesting-buck-452459` · **HEAD:** `f453382` (local = origin, in sync)
**Decision scope:** should the redesign branch merge into `main` (which auto-triggers the GitHub Pages deploy)?
**Inputs reviewed:** `DESIGN_QA_CHECKLIST.md`, `DEPLOYMENT_READINESS_REPORT.md`, `CLIENT_DASHBOARD_MOBILE_REDESIGN.md`.

**Legend — Category:** MFBM = Must Fix Before Merge · FAM = Fix After Merge · AR = Accept Risk · NA = Not Applicable (already done / not a defect).
**Effort:** S ≤ 30 min · M ≈ 0.5–1 day · L ≈ multi-day.

---

## 1. Master issue inventory (every item from both reports)

| # | Issue (source) | Risk | User impact | Effort | Category | Recommendation |
|---|---|---|---|---|---|---|
| D-1 | Desktop had no Train item; Daily Routine/My Program duplicated (QA §2.1) | Medium | Confusing desktop client IA | — | **NA — DONE** | Resolved in Phase 1 (`f453382`); confirm in smoke test |
| D-2 | Raw Notifications nav reachable by desktop clients (QA §2.1) | Low | Two views of same data | — | **NA — DONE** | `nav-notifications` now coach/admin-only; resolved Phase 1 |
| D-3 | `my-graph` via More + desktop nav (QA §2.1) | Info | None (intended parity) | — | **NA** | Not a defect |
| L-1 / N-1 | Footer notification bell still routes desktop clients to raw inbox (Deploy L-1, QA §8 N-1) | Low | Minor desktop inconsistency; client can reach raw inbox | S | **FAM** | Gate `#notif-bell` for client on desktop; keep for coach/admin |
| L-2 | Modal overlays trap focus but don't `aria-hidden`/`inert` siblings (Deploy L-2) | Low | SR users can reach background while modal open (focus-trap mitigates) | S | **FAM** | Add `inert`/`aria-hidden` to siblings on open |
| L-3 | Daily Routine checkbox lacks Enter/Space (Deploy L-3) — **pre-existing**, shared module | Low | Keyboard-only desktop clients can't toggle a task via keyboard (pointer/touch works) | S–M | **FAM** | Add keydown handler in `dailyRoutine.js`; verify coach view |
| L-4 | Today degrades score-read error to "Not yet" (Deploy L-4) | Low | Transient error looks like no-data | S | **AR** | Calm degradation is acceptable; optional later |
| L-5 | F2/F6 sit two reveals deep in Train (Deploy L-5) | Low | Workout logging / request-alternative are deeper than before | M | **AR** | Reachable + intentional (routine is the primary daily action); revisit in a future Train iteration |
| M-1 | three.js example-script 404s (Deploy M-1) — **pre-existing**, unrelated to redesign | Medium→Low | Console 404 noise only; no functional effect | S | **FAM** | Remove 3 vestigial `<script>` tags after verifying nothing reads those globals |
| M-2 | ~1.04 MB single JS bundle / chunk warning (Deploy M-2) — **pre-existing** | Medium | Slower first load (~290 KB gzip) | L | **AR** | Acceptable at current scale; backlog a code-split pass |
| M-3 | No real-device/browser smoke test was possible in this environment (Deploy M-3) | Medium | Mobile-first redesign unverified on real hardware | S (manual) | **MFBM** (verification, not a code fix) | Run one real-device pass before trusting the live deploy |
| H-A | Subscription **write-gate is client-side only** (Deploy H-A = audit H-1) — **pre-existing, not changed by redesign** | High | Expired client could still write via API (RLS doesn't enforce) | M–L (backend/RLS) | **AR for this merge; separate track** | Does not block the redesign merge (presentation-only); schedule a dedicated RLS hardening task |
| S-1 | Shared `disclosure` helper (QA §5.1) | None (quality) | None | S | **FAM** | Optional `/simplify` cleanup |
| S-2 | Shared `screenHeader` helper (QA §5.1) | None (quality) | None | S | **FAM** | Optional `/simplify` cleanup |
| S-3 | CSS utility classes vs inline styles (QA §5.1) | None (quality) | Slightly smaller bundle | M | **FAM** | Optional; pairs with M-2 perf work |
| N-2 (QA) | `my-program` hidden via one-off inline `display:none` (QA §8) | Info | None | S | **AR** | Fine for a single retired item |
| N-2 (Deploy) | Desktop section header to group Today/Train/Progress/Coach | None | Minor polish | S | **FAM** | Optional; constrained by shared `nav-dashboard` position |
| N-3 (Deploy) | Pause 3D loop under `prefers-reduced-motion` | None | A11y nicety | S | **FAM** | Optional |
| — | Dead nav paths / orphaned sections / obsolete modules (QA §2.2–2.5) | None | None | — | **NA** | None found |

---

## 2. Specific evaluations (as requested)

**Desktop client navigation consolidation — NA (DONE).** Completed in Phase 1 (`f453382`): added `nav-client-train`; gated Daily Routine + Notifications to coach/admin; hid My Program. Desktop client primary nav now mirrors mobile (Today · Train · Progress · Coach). Coach/admin nav verified unchanged. **No further pre-merge work; just confirm in the smoke test.**

**Notifications duplication — split.** Nav-level duplication (D-2) is **resolved** (coach/admin-only). The only residual is the **footer bell (L-1)**, which still routes desktop clients to the raw inbox. Low impact, ~S effort. **FAM** — not a blocker.

**Accessibility findings (L-2, L-3) — FAM.** The redesign added solid a11y (focus trap/restore, dialog/tablist roles, `aria-live`, reduced-motion). Remaining: siblings not made inert under a modal (L-2) and the routine checkbox keyboard gap (L-3, **pre-existing** in the shared module). Both Low, both ~S–M. Mitigations exist (focus trap; pointer/touch toggling). **Not merge-blocking.**

**Three.js legacy script 404s (M-1) — FAM (pre-existing).** Vestigial `<script defer>` tags for files removed from three.js years ago; the redesign's hologram uses the bundled `src/` engine, not these. Console noise only. Trivial cleanup, unrelated to the redesign. **Accept for merge; clean up after.**

**Bundle size warning (M-2) — AR (pre-existing).** One ~1.04 MB chunk (~290 KB gzip). Pre-dates the redesign; the redesign's own additions are small. A code-split/`manualChunks` pass is the real fix (L effort). **Accept now; backlog.**

**Subscription write-gate (H-A) — AR for this merge; separate hardening track.** Genuine High-severity posture issue, but **pre-existing on `main`** and **not touched** by this presentation-only redesign (which only adds read-only affordances: renew CTA, `readOnly` tracker). Merging the redesign does not worsen it. It should be fixed with a dedicated RLS migration (backend), independent of this merge and ideally before broad production reliance. **Does not block the redesign merge.**

**F2 / F6 discoverability (L-5) — AR.** Workout logging (F2) and request-alternative (F6) live two reveals deep in Train ("Your full plan" → workout row). For a rehab client the primary daily action is the routine ("Start session"), which is one tap; the full program is secondary, so the depth is acceptable. Reachable and intentional. **Revisit in a future Train iteration, not now.**

---

## 3. Merge / deploy determination

**Is the redesign safe to merge today?** **Yes.** It introduces **no Critical, High, or Medium defects.** All client routes resolve (1:1 wiring verified in the built artifact), F1–F7 remain accessible, coach/admin and RLS are provably unaffected, and no required code fix is outstanding (every code item is FAM or AR). The single pre-merge item (M-3) is a **verification**, not a code change.

**Is it safe to deploy today?** **Yes, relative to current production.** Deploy = merge to `main` → Pages build/deploy. The artifact is complete and self-consistent (all client modules copied to `dist/js/`, CSS bundled+hashed under `/AST9_HUB/`, no raw `css/` 404s, `dist/` gitignored so CI rebuilds clean). The only High item (H-A) is pre-existing and unchanged, so the deploy is no less safe than what is live today.

**Exact work remaining before Feature 8 should begin:**
1. **Pre-merge (required, verification):** one real-device smoke test (M-3) — iOS Safari + Android Chrome — covering the five tabs, More sheet + deep-links, hologram open/close cycle, lapsed-subscription read-only, and offline note.
2. **Merge:** open PR `claude/interesting-buck-452459` → `main`; confirm the Actions deploy is green; spot-check the live URL.
3. **Post-merge small fixes (optional, recommended, all FAM/S):** L-1 (bell gating), then L-2 / L-3 (a11y), then M-1 (404 cleanup).
4. **Separate hardening track (not a Feature-8 blocker):** H-A subscription write-gate RLS enforcement; M-2 bundle code-split.
5. **Feature 8** may begin after the merge decision. H-A should be scheduled but is pre-existing and does not gate starting F8.

---

## 4. Final recommendation

# READY TO MERGE
### (conditioned on one real-device smoke test — verification only; no code fixes are required before merge)

**Rationale:** The Client Mobile Redesign at `f453382` is complete, internally consistent, and verified on paper end-to-end. The desktop navigation consolidation and the notifications-nav duplication are already resolved (Phase 1). Every remaining issue is either **Not Applicable (done)**, **Accept Risk (pre-existing or low)**, or **Fix After Merge (Low / Nice-to-have)** — **none are merge blockers**. The only High item (H-A) pre-dates the redesign and is unchanged by it, so merging does not increase production risk. The one genuine pre-merge gate is a **real-device smoke test** (M-3), because this is a mobile-first redesign that could not be exercised on real hardware in this environment; treat that as a verification step, not a fix.

If the smoke test passes, merge immediately and proceed with the post-merge follow-ups and the separate H-A hardening track. **Do not start Feature 8 until after the merge decision.**
