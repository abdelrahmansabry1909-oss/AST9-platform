// tests/unit/scoring-engine-composite.test.js
//
// Regression tests for the movement composite score, covering the recursion
// defect fixed in fix/neucore-scoring-composite-recursion:
//   fullScores() -> _composite() -> fullScores() -> ... (RangeError), which
//   GaitAnalysisPage caught and rendered as "Score unavailable".
//
// All expected values below were observed from the engine itself (not assumed),
// so they lock the *actual* preserved arithmetic — the mean, the null filtering,
// and every normalization/threshold value are unchanged by the fix.
//
// NOTE (documented, out of scope for this fix): `_neurologyScore()` returns
// `Math.max(0, _avg(vals) - painPenalty)`, and `null - 0` coerces to 0 in JS, so
// with no balance data neurology_score is 0 (never null). The composite is
// therefore never null, and the `'Insufficient data'` recommendation branch is
// currently unreachable. Changing that is a clinical-algorithm change and is
// explicitly excluded from this recursion fix — see docs/ISSUE_LOG.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScoringEngine } from '../../src/neucore/scoring/ScoringEngine.js';

// Fully-populated, normative assessment: every field at its normalization
// target, so each component and the composite compute to 100.
const NORMATIVE = {
  hip_ir_left: 45, hip_ir_right: 45,
  ankle_dorsiflexion_left_cm: 10, ankle_dorsiflexion_right_cm: 10,
  shoulder_flexion_left: 180, shoulder_flexion_right: 180,
  hip_flexion_left: 120, hip_flexion_right: 120,
  sl_squat_l: 5, sl_squat_r: 5, sl_rdl_l: 5, sl_rdl_r: 5, oh_squat: 5,
  hip_abduction_left: 45, hip_abduction_right: 45,
  hip_extension_left: 20, hip_extension_right: 20,
  bal_eo_l: 30, bal_eo_r: 30,
  sp_flex_pain: false,
};

test('fullScores() completes without recursion or RangeError', () => {
  // The defect made these throw "Maximum call stack size exceeded".
  assert.doesNotThrow(() => new ScoringEngine(NORMATIVE).fullScores());
  assert.doesNotThrow(() => new ScoringEngine({}).fullScores());
  // phaseRecommendation() also routes through _composite() and must not recurse.
  assert.doesNotThrow(() => new ScoringEngine(NORMATIVE).phaseRecommendation());
});

test('complete normative assessment → finite component scores and composite', () => {
  const s = new ScoringEngine(NORMATIVE).fullScores();
  for (const k of ['rom_score', 'control_score', 'force_score', 'neurology_score', 'composite_score']) {
    assert.ok(Number.isFinite(s[k]), `${k} should be finite, got ${s[k]}`);
  }
  // Every field at norm → each component 100 → composite (arithmetic mean) 100.
  assert.deepEqual(s, {
    rom_score: 100, control_score: 100, force_score: 100,
    neurology_score: 100, composite_score: 100,
  });
});

test('Movement Simulation receives numeric scores (not "Score unavailable")', () => {
  // GaitAnalysisPage.js:254 consumes fullScores() and only shows the
  // "Score unavailable" fallback (line 292) when the call throws — the old
  // recursion. With the fix it gets a finite numeric composite, so the UI
  // renders numeric score values.
  const s = new ScoringEngine(NORMATIVE).fullScores();
  assert.equal(typeof s.composite_score, 'number');
  assert.ok(Number.isFinite(s.composite_score));
});

test('composite is the arithmetic mean over non-null components (null filtering preserved)', () => {
  // Only ROM data supplied. control_score and force_score are null and MUST be
  // excluded from the average (not treated as 0 in the denominator).
  const s = new ScoringEngine({ hip_ir_left: 45 }).fullScores();
  assert.equal(s.rom_score, 100);
  assert.equal(s.control_score, null);
  assert.equal(s.force_score, null);
  assert.equal(s.neurology_score, 0);          // no balance data → 0 (see file header)
  // mean of the available [100 (rom), 0 (neurology)] = 50, NOT 25 (which is what
  // counting the two nulls as 0 would give) — proves null filtering is intact.
  assert.equal(s.composite_score, 50);
});

test('empty assessment: rom/control/force null; documented neurology-0 behavior', () => {
  const e = new ScoringEngine({});
  const s = e.fullScores();
  assert.equal(s.rom_score, null);
  assert.equal(s.control_score, null);
  assert.equal(s.force_score, null);
  // Preserved clinical behavior: neurology (and therefore composite) is 0, not
  // null — so the recommendation is Phase 1, not "Insufficient data".
  // (Latent, out of scope — docs/ISSUE_LOG.md.)
  assert.equal(s.neurology_score, 0);
  assert.equal(s.composite_score, 0);
  assert.deepEqual(e.phaseRecommendation(), { phase: 'Phase 1 — Foundation', referral: true });
});

test('phase thresholds unchanged (80 / 60 / 40 boundaries + referral)', () => {
  const phaseOf = (a) => new ScoringEngine(a).phaseRecommendation();

  // composite 100 (>= 80) → Phase 3.
  assert.deepEqual(phaseOf(NORMATIVE), { phase: 'Phase 3 — Performance', referral: false });

  // composite 75 (>= 60): ROM+control+force at norm, no balance (neurology 0).
  const { bal_eo_l, bal_eo_r, sp_flex_pain, ...romControlForce } = NORMATIVE;
  assert.deepEqual(phaseOf(romControlForce), { phase: 'Phase 2 — Strength & Control', referral: false });

  // composite 50 (>= 40, < 60) → Phase 1, no referral.
  assert.deepEqual(phaseOf({ hip_ir_left: 45 }), { phase: 'Phase 1 — Foundation', referral: false });

  // composite 30 (< 40) → Phase 1 with referral.
  assert.deepEqual(phaseOf({ hip_ir_left: 27 }), { phase: 'Phase 1 — Foundation', referral: true });
});
