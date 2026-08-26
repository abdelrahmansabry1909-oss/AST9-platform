// tests/unit/gait-engine-parity.test.js
//
// Two gait engines read the same assessment and are meant to report the same
// deficits: js/gaitEngine.js renders the Gait Analysis card, and
// src/neucore/gait/GaitRules.js drives the deficit cards on the simulation
// page. They drifted — fifteen rules against ten, and the missing five were
// every spine and shoulder rule. A coach measuring an upper body saw a
// lower-limb report, which is what "it is all lower body" meant.
//
// Drift is silent: both engines run, neither throws, and the simulation page
// just says less. So the id sets are compared directly.
//
// The other half is supply. A rule cannot fire on a field nothing collects,
// and three rules were dead that way — an element id that is not on the form,
// and a select comparison against a value no option emits. Those are invisible
// to reading and to every other test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { evaluateGaitRules, GAIT_RULE_IDS } from '../../src/neucore/gait/GaitRules.js';
import { GAIT_PHASES } from '../../src/neucore/simulation/MuscleActivationDB.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const APP_HTML = read('app.html');
const MAIN_JS  = read('src/main.js');

function legacyEngine() {
  const sandbox = { window: {}, document: { getElementById: () => null }, console };
  vm.createContext(sandbox);
  vm.runInContext(read('js/gaitEngine.js'), sandbox);
  return sandbox.window.GaitEngine;
}

const Legacy = legacyEngine();

// js/gaitEngine.js names two rules differently for the same deficit.
const ALIASES = new Map([
  ['limited_dorsiflexion', 'limited_df'],
  ['poor_sl_balance_eo',   'poor_balance_eo'],
  ['oh_squat_issues',      'oh_squat_forward_lean'],
]);

test('both engines loaded', () => {
  assert.ok(Legacy?.RULES?.length, 'js/gaitEngine.js did not expose RULES');
  assert.ok(GAIT_RULE_IDS.length, 'GaitRules did not export its ids');
});

test('the simulation engine covers every deficit the legacy engine does', () => {
  const moduleIds = new Set(GAIT_RULE_IDS);
  const missing = [...Legacy.RULES]
    .map((r) => ALIASES.get(r.id) ?? r.id)
    .filter((id) => !moduleIds.has(id));

  assert.deepEqual(
    missing, [],
    `the simulation page cannot report: ${missing.join(', ')}. ` +
    `A rule only in js/gaitEngine.js never reaches the deficit cards.`,
  );
});

test('the two engines have not drifted the other way either', () => {
  const legacyIds = new Set([...Legacy.RULES].map((r) => ALIASES.get(r.id) ?? r.id));
  const extra = GAIT_RULE_IDS.filter((id) => !legacyIds.has(id));
  assert.deepEqual(extra, [], `only the simulation engine reports: ${extra.join(', ')}`);
});

test('every phase a rule names is a real gait phase', () => {
  // 'initial_contact' exists in js/gaitEngine.js but not in GAIT_PHASES.
  // Porting it verbatim would have written a phase nothing renders.
  const phases = new Set(GAIT_PHASES);
  const bad = [];
  for (const d of evaluateGaitRules(EVERYTHING_WRONG)) {
    for (const p of d.phases) if (!phases.has(p)) bad.push(`${d.id}:${p}`);
  }
  assert.deepEqual(bad, [], `rules name phases that do not exist: ${bad.join(', ')}`);
});

// ── The rules actually fire ────────────────────────────────────────
// Field names are the _collectAssessment() shape, not readForm()'s.
const EVERYTHING_WRONG = Object.freeze({
  ankle_dorsiflexion_left_cm: 4, ankle_dorsiflexion_right_cm: 4,
  ankle_pronation_left: 15, ankle_pronation_right: 15,
  ankle_supination_left: 15, ankle_supination_right: 15,
  hip_ir_left: 15, hip_ir_right: 40,
  hip_er_left: 25, hip_er_right: 25,
  hip_extension_left: 4, hip_extension_right: 4,
  sl_squat_l: 1, sl_squat_r: 1,
  sl_rdl_l: 1, sl_rdl_r: 1,
  bal_eo_l: 12, bal_eo_r: 12,
  bal_ec_l: 3, bal_ec_r: 3,
  oh_squat_forward_lean: true,
  sh_ir_left: 40, sh_ir_right: 45,
  thoracic_rotation_left: 12, thoracic_rotation_right: 12,
  sp_flex_pain: true, sp_rotl_pain: true, sp_rotr_pain: true,
});

test('a client failing everything trips every rule', () => {
  const fired = new Set(evaluateGaitRules(EVERYTHING_WRONG).map((d) => d.id));
  const silent = GAIT_RULE_IDS.filter((id) => !fired.has(id));
  assert.deepEqual(
    silent, [],
    `these rules cannot fire even on a client who fails their test: ${silent.join(', ')}`,
  );
});

test('an empty assessment trips nothing', () => {
  assert.equal(evaluateGaitRules({}).length, 0, 'a rule fired on no data');
  assert.equal(evaluateGaitRules(null).length, 0);
});

const NEW_RULES = ['limited_hip_er', 'limited_shoulder_ir', 'limited_spine_flexion',
                   'limited_thoracic_rotation', 'poor_sl_balance_ec'];

for (const id of NEW_RULES) {
  test(`${id} is present and gradeable`, () => {
    const d = evaluateGaitRules(EVERYTHING_WRONG).find((x) => x.id === id);
    assert.ok(d, `${id} did not fire`);
    assert.ok(['mild', 'moderate', 'severe'].includes(d.activeSeverity),
      `${id} produced severity "${d.activeSeverity}"`);
    assert.ok(d.compensations.length && d.future_risk.length,
      `${id} has no compensations or risks to render`);
  });
}

test('rules that grade themselves report worse severity for worse numbers', () => {
  const mild   = evaluateGaitRules({ ...EVERYTHING_WRONG, thoracic_rotation_left: 26, thoracic_rotation_right: 26 });
  const severe = evaluateGaitRules({ ...EVERYTHING_WRONG, thoracic_rotation_left: 8,  thoracic_rotation_right: 8 });
  const of = (list) => list.find((d) => d.id === 'limited_thoracic_rotation').activeSeverity;
  assert.equal(of(mild), 'mild');
  assert.equal(of(severe), 'severe');
});

// ── The supply side ────────────────────────────────────────────────
test('hip IR asymmetry needs both sides, not one', () => {
  // `(parseFloat(left) || 0) - (parseFloat(right) || 0)` read an unmeasured
  // side as a measured zero, so one recorded hip looked like a 45 degree
  // asymmetry.
  const oneSide = evaluateGaitRules({ hip_ir_left: 45 });
  assert.ok(
    !oneSide.some((d) => d.id === 'hip_ir_asymmetry'),
    'a single measured hip was reported as an asymmetry',
  );
  const bothSides = evaluateGaitRules({ hip_ir_left: 45, hip_ir_right: 20 });
  assert.ok(bothSides.some((d) => d.id === 'hip_ir_asymmetry'), 'a real asymmetry was missed');
});

test('every element id _collectAssessment reads exists in app.html', () => {
  const body = MAIN_JS.slice(MAIN_JS.indexOf('function _collectAssessment'));
  const ids = [...body.matchAll(/getElementById\('(ns-[\w-]+)'\)|\bg\('(ns-[\w-]+)'\)/g)]
    .map((m) => m[1] || m[2]);
  assert.ok(ids.length > 20, `expected the collect block, found ${ids.length} ids`);
  const missing = [...new Set(ids)].filter((id) => !APP_HTML.includes(`id="${id}"`));
  assert.deepEqual(
    missing, [],
    `_collectAssessment reads ids that are not on the form: ${missing.join(', ')}`,
  );
});

test('the foot selects are compared against values the form actually emits', () => {
  // The supination select emits 'stuck_supinated'. Comparing to 'stuck' meant
  // the value was always the "normal" branch and the rule was unreachable.
  for (const [id, value] of [['ns-pronation-l', 'over'], ['ns-supination-l', 'stuck_supinated']]) {
    const select = APP_HTML.slice(APP_HTML.indexOf(`id="${id}"`));
    const options = [...select.slice(0, select.indexOf('</select>'))
      .matchAll(/value="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(options.includes(value), `${id} has no option with value="${value}"`);
    assert.ok(MAIN_JS.includes(`'${value}'`), `_collectAssessment never compares against '${value}'`);
  }
});

test('an unassessed foot is undefined, not a normal reading', () => {
  const collect = MAIN_JS.slice(MAIN_JS.indexOf('function _footFinding'));
  assert.match(collect, /return undefined/, '_footFinding must return undefined for a blank select');
  assert.doesNotMatch(
    MAIN_JS,
    /ankle_pronation_left:\s*g\([^)]*\)\s*===/,
    'the inline ternary defaulted an unassessed foot to a normal value',
  );
});

test('the retired sl_rdl_trunk_rotation flag is gone from both sides', () => {
  const RULES_SRC = read('src/neucore/gait/GaitRules.js');
  assert.ok(
    !MAIN_JS.includes('ns-sl-rdl-rotation'),
    '_collectAssessment still reads an element id that is not on the form',
  );
  assert.match(RULES_SRC, /parseFloat\(a\.sl_rdl_l\)/, 'the rule still reads the dead boolean');
});
