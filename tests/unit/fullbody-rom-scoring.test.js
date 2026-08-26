// tests/unit/fullbody-rom-scoring.test.js
//
// Three defects that all made the movement analysis look lower-body-only, and
// all of which the existing suite passed straight through.
//
// 1. js/scoring.js collected elbow, wrist and cervical measurements, gave them
//    norms, and never scored them. The coach typed numbers that reached nothing.
// 2. src/main.js `_collectAssessment()` supplied `sh_ir_*` where
//    src/neucore/scoring/ScoringEngine.js reads `shoulder_flexion_*`, plus four
//    other name mismatches. Seven of twenty scored inputs were permanently
//    undefined. Nulls are filtered from the averages, so the gaps silently
//    RAISED scores: a client with 60°/180° shoulders scored a flawless 100.
// 3. That engine divided load tolerance by 5 while the form offers 3/2/1/0, so
//    a perfect result scored 60 and the top of the scale was unreachable.
//
// The existing scoring-engine-composite.test.js passed throughout all three,
// because it asserts values "observed from the engine itself" — it locks
// behaviour, which is exactly what was wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ScoringEngine as ModuleEngine } from '../../src/neucore/scoring/ScoringEngine.js';

const root = new URL('../../', import.meta.url);
const HTML = readFileSync(new URL('app.html', root), 'utf8');
const MAIN = readFileSync(new URL('src/main.js', root), 'utf8');

// js/scoring.js is a browser IIFE ending in `window.ScoringEngine = ...`.
// calculate() takes a plain object and touches no DOM.
function loadLegacyEngine() {
  const src = readFileSync(new URL('js/scoring.js', root), 'utf8');
  const sandbox = { window: {}, document: { getElementById: () => null }, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.ScoringEngine;
}

const LEGACY = loadLegacyEngine();

// Healthy lower body at norm, nothing else measured.
const LOWER_AT_NORM = {
  hip_ir_l: 35, hip_ir_r: 35, hip_er_l: 45, hip_er_r: 45,
  hip_flex_l: 120, hip_flex_r: 120, hip_ext_l: 10, hip_ext_r: 10,
  hip_abd_l: 40, hip_abd_r: 40, tib_ir_l: 20, tib_ir_r: 20,
  ankle_df_l: 10, ankle_df_r: 10,
};

// ── 1. Upper-body and cervical data is actually scored ─────────────

test('elbow, wrist and cervical measurements reach the ROM score', () => {
  const withoutUpper = LEGACY.calculate(LOWER_AT_NORM);
  // Same client, but with a badly restricted elbow, wrist and neck.
  const withRestricted = LEGACY.calculate({
    ...LOWER_AT_NORM,
    elbow_flex_l: 70, elbow_flex_r: 70,
    wrist_flex_l: 20, wrist_flex_r: 20,
    cerv_rot_l: 20,   cerv_rot_r: 20,
  });
  assert.ok(
    withRestricted.rom_score < withoutUpper.rom_score,
    `restricted elbow/wrist/cervical must lower ROM, got ${withRestricted.rom_score} ` +
    `against ${withoutUpper.rom_score} — the measurements are being discarded again`,
  );
});

test('elbow_ext does not produce NaN despite a norm minimum of zero', () => {
  // (value / norm.min) * 100 with min 0: 0/0 is NaN, and NaN propagates through
  // every average without throwing, so the whole ROM score silently dies.
  for (const v of [0, 5, 10]) {
    const s = LEGACY.calculate({ ...LOWER_AT_NORM, elbow_ext_l: v, elbow_ext_r: v });
    assert.ok(Number.isFinite(s.rom_score), `elbow_ext ${v} gave rom_score ${s.rom_score}`);
    assert.ok(Number.isFinite(s.composite_score), `elbow_ext ${v} gave composite ${s.composite_score}`);
  }
});

test('reaching neutral elbow extension scores full marks', () => {
  // NORMS.elbow_ext.min is 0, meaning neutral is the target. 0 must not be
  // treated as a total deficit.
  const atNeutral = LEGACY.calculate({ ...LOWER_AT_NORM, elbow_ext_l: 0, elbow_ext_r: 0 });
  assert.equal(atNeutral.rom_score, LEGACY.calculate(LOWER_AT_NORM).rom_score);
});

// ── 2. ROM is reported by region ───────────────────────────────────

test('an unmeasured region reports null, never zero', () => {
  const s = LEGACY.calculate(LOWER_AT_NORM);
  assert.equal(s.region_scores.upper, null, 'unmeasured upper must be null, not 0');
  assert.equal(s.region_scores.spine, null, 'unmeasured spine must be null, not 0');
  assert.ok(s.region_scores.lower > 0, 'measured lower region must carry a score');
});

test('a limited region is visible in its own score', () => {
  const s = LEGACY.calculate({
    ...LOWER_AT_NORM,
    sh_flex_l: 60, sh_flex_r: 60, sh_ir_l: 20, sh_ir_r: 20,
  });
  assert.ok(s.region_scores.upper < 60,
    `a 60/160 shoulder should show a low upper score, got ${s.region_scores.upper}`);
  assert.equal(s.region_scores.lower, 100, 'the healthy lower body must stay unaffected');
});

test('the composite still averages every scored joint, not the regions', () => {
  // Regions are presentation. If the composite were computed from the three
  // region means instead, one measured upper joint would carry a third of the
  // score. Guard against that reweighting.
  const s = LEGACY.calculate({ ...LOWER_AT_NORM, wrist_flex_l: 20, wrist_flex_r: 20 });
  const regionMean = (s.region_scores.upper + s.region_scores.lower) / 2;
  assert.notEqual(s.rom_score, parseFloat(regionMean.toFixed(1)),
    'rom_score must not be the mean of the region means');
});

// ── 3. The field-name mismatch feeding the simulation engine ───────

const LEGS_AT_NORM = {
  ankle_dorsiflexion_left_cm: 10, ankle_dorsiflexion_right_cm: 10,
  hip_ir_left: 45, hip_ir_right: 45,
  hip_extension_left: 20, hip_extension_right: 20,
  hip_flexion_left: 120, hip_flexion_right: 120,
  bal_eo_l: 30, bal_eo_r: 30,
};

test('_collectAssessment supplies every field the simulation engine scores', () => {
  const reads = [...MAIN.matchAll(/\b(shoulder_flexion_(?:left|right)|hip_abduction_(?:left|right)|sl_rdl_[lr]|oh_squat)\s*:/g)]
    .map((m) => m[1]);
  for (const field of ['shoulder_flexion_left', 'shoulder_flexion_right',
                       'hip_abduction_left', 'hip_abduction_right',
                       'sl_rdl_l', 'sl_rdl_r', 'oh_squat']) {
    assert.ok(reads.includes(field),
      `_collectAssessment must supply ${field} — ScoringEngine scores it, and an ` +
      `absent field is filtered from the average rather than flagged, so the ` +
      `omission raises the score instead of failing`);
  }
});

test('a restricted shoulder lowers the simulation composite', () => {
  const frozen = new ModuleEngine({
    ...LEGS_AT_NORM, shoulder_flexion_left: 60, shoulder_flexion_right: 60,
  }).fullScores();
  assert.ok(frozen.composite_score < 100,
    `60°/180° shoulders with perfect legs scored ${frozen.composite_score} — ` +
    `this read a flawless 100 before the field names were reconciled`);
});

test('weak hip abduction lowers the force score', () => {
  const weak = new ModuleEngine({
    ...LEGS_AT_NORM, hip_abduction_left: 10, hip_abduction_right: 10,
  }).fullScores();
  assert.ok(weak.force_score < 100,
    `10°/45° abduction scored force ${weak.force_score} — hip_abduction was never delivered`);
});

// ── 4. Load-tolerance scale ────────────────────────────────────────

test('the best load-tolerance result the form allows scores 100', () => {
  const best = new ModuleEngine({
    sl_squat_l: 3, sl_squat_r: 3, sl_rdl_l: 3, sl_rdl_r: 3, oh_squat: 3,
  }).fullScores();
  assert.equal(best.control_score, 100,
    'the selects offer 3/2/1/0; dividing by 5 made a flawless result score 60');
});

test('the load-tolerance divisor matches the options the form actually renders', () => {
  // Pins the scale to the markup, so changing the select without the engine
  // (or the reverse) fails here rather than silently skewing every score.
  const block = HTML.slice(HTML.indexOf('id="ns-sl-squat-l"'));
  const values = [...block.slice(0, 400).matchAll(/value="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(values.length, 'could not read the load-tolerance options from app.html');
  assert.equal(Math.max(...values), ModuleEngine.LOAD_MAX,
    `form maximum is ${Math.max(...values)} but the engine divides by ${ModuleEngine.LOAD_MAX}`);
});

test('a value above the scale cannot push a component past 100', () => {
  const over = new ModuleEngine({ sl_squat_l: 5, sl_squat_r: 5 }).fullScores();
  assert.ok(over.control_score <= 100, `got ${over.control_score}`);
});

// ── 5. The cache-bust token ────────────────────────────────────────

test('js/scoring.js carries a ?v= token so the change reaches existing users', () => {
  // js/*.js is served raw and unhashed. Without a token bump every returning
  // user keeps the cached old file and none of the above ships.
  assert.match(HTML, /<script src="js\/scoring\.js\?v=[0-9a-z]+"><\/script>/,
    'js/scoring.js must carry a ?v= token in app.html');
});
