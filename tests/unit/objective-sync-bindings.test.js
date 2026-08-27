// tests/unit/objective-sync-bindings.test.js
//
// The Objective form and the 3D body map are joined by three separate tables
// that must agree, and nothing enforced that until now:
//
//   ObjectiveSync.BINDINGS   field id  -> joint + rom name   (form -> colour)
//   JOINT_ASSESSMENT_MAP     joint     -> rom names          (the pop-out panel)
//   app.html                 the input ids that actually exist
//
// Every way they can drift is silent. `_bindForm` does `if (!el) return`, so a
// binding naming a dead id simply never fires. `_bindBus` looks up
// `_byRom[joint|field]`, so a panel field with no matching binding writes
// nothing back to the form. Neither logs. This is the same failure class as
// the gait rules that were dead on supply for months.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const SYNC     = read('src/neucore/core/ObjectiveSync.js');
const BONES    = read('src/neucore/skeleton/BoneDefinitions.js');
const REGISTRY = read('src/neucore/core/JointRegistry.js');
const ENGINE   = read('js/integrationEngine.js');
const HTML     = read('app.html');

// ── parse the three tables ─────────────────────────────────────────
const bindings = [...SYNC.matchAll(
  /\{\s*field:\s*'([a-z0-9-]+)',\s*joint:\s*'(\w+)',(?:\s*rom:\s*'(\w+)',)?[^}]*?kind:\s*'(\w+)'/g
)].map((m) => ({ field: m[1], joint: m[2], rom: m[3], kind: m[4] }));

const formIds = new Set(
  [...HTML.matchAll(/<(?:input|select|textarea)\b[^>]*id="(ns-[a-z0-9-]+)"/gi)].map((m) => m[1])
);

function assessmentMap() {
  const start = BONES.indexOf('export const JOINT_ASSESSMENT_MAP');
  const end = BONES.indexOf('\n};', start);
  const body = BONES.slice(start, end);
  const map = {};
  for (const m of body.matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)) {
    map[m[1]] = [...m[2].matchAll(/'([a-z_]+)'/g)].map((f) => f[1]);
  }
  return map;
}

const MAP = assessmentMap();

test('the binding table parsed at all', () => {
  assert.ok(bindings.length >= 50, `only parsed ${bindings.length} bindings — the regex has drifted from the source`);
  assert.ok(Object.keys(MAP).length >= 10, 'JOINT_ASSESSMENT_MAP did not parse');
});

test('every binding names a form field that exists', () => {
  // _bindForm silently skips a missing element, so a typo is invisible.
  const dead = bindings.filter((b) => !formIds.has(b.field)).map((b) => b.field);
  assert.deepEqual(dead, [], `binding(s) name a form id that is not on the page: ${dead.join(', ')}`);
});

test('every ROM binding is reachable from the 3D panel', () => {
  // _bindBus resolves `_byRom[jointKey|field]` from the event the panel emits.
  // A rom name the panel never offers can never round-trip back to the form.
  const unreachable = bindings
    .filter((b) => b.kind === 'rom')
    .filter((b) => !(MAP[b.joint] || []).includes(b.rom))
    .map((b) => `${b.joint}.${b.rom}`);
  assert.deepEqual(
    unreachable,
    [],
    `ROM binding(s) absent from JOINT_ASSESSMENT_MAP, so a panel edit writes nothing back: ${unreachable.join(', ')}`,
  );
});

test('every binding targets a joint the skeleton actually builds', () => {
  const interactive = new Set(
    [...BONES.matchAll(/'(\w+)'/g)]
      .map((m) => m[1])
      .filter((k) => BONES.slice(BONES.indexOf('ALL_INTERACTIVE_JOINTS'), BONES.indexOf('JOINT_ASSESSMENT_MAP')).includes(`'${k}'`)),
  );
  const unknown = [...new Set(bindings.map((b) => b.joint))].filter((j) => !interactive.has(j));
  assert.deepEqual(unknown, [], `binding(s) target a non-interactive joint: ${unknown.join(', ')}`);
});

// ── the fields this phase was asked to wire ────────────────────────
const NEWLY_WIRED = [
  'ns-sh-abd-l', 'ns-sh-abd-r',
  'ns-thor-rot-l', 'ns-thor-rot-r', 'ns-thor-ext', 'ns-thor-flex',
  'ns-cerv-rot-l', 'ns-cerv-rot-r', 'ns-cerv-flex', 'ns-cerv-ext',
  'ns-lumb-flex', 'ns-lumb-ext', 'ns-si-pain',
  'ns-elbow-flex-l', 'ns-elbow-flex-r', 'ns-elbow-ext-l', 'ns-elbow-ext-r',
  'ns-wrist-flex-l', 'ns-wrist-flex-r', 'ns-wrist-ext-l', 'ns-wrist-ext-r',
];

test('all 21 previously unbound fields are wired to the body map', () => {
  const bound = new Set(bindings.map((b) => b.field));
  const missing = NEWLY_WIRED.filter((f) => !bound.has(f));
  assert.deepEqual(missing, [], `still unbound: ${missing.join(', ')}`);
  assert.equal(NEWLY_WIRED.length, 21);
});

// ── the L22 ruling ─────────────────────────────────────────────────
// Owner ruling 2026-08-26. Three sources used to disagree; a regression in any
// one of them puts the body-map colour out of step with the finding text
// beside it, and out of step with the hint the coach is shown.
test('lumbar norms agree across ObjectiveSync, JointRegistry, the engine and the form', () => {
  const normOf = (field) => {
    const row = SYNC.match(new RegExp(`field: '${field}'[^}]*norm:\\s*(\\d+)`));
    assert.ok(row, `no norm found for ${field}`);
    return Number(row[1]);
  };
  assert.equal(normOf('ns-lumb-flex'), 50, 'ObjectiveSync lumbar flexion');
  assert.equal(normOf('ns-lumb-ext'), 15, 'ObjectiveSync lumbar extension');

  assert.match(REGISTRY, /LumbarSpine:\s*\{\s*flexion:\s*50,\s*extension:\s*15/,
    'JOINT_NORMATIVE still carries the old 60/25 lumbar values');

  assert.match(ENGINE, /lumb_flexion:\s*50/, 'integrationEngine lumbar flexion moved');
  assert.match(ENGINE, /lumb_extension:\s*15/, 'integrationEngine lumbar extension moved');

  // The coach must be shown the same number the engine scores against.
  assert.match(HTML, /id="ns-lumb-flex"[^>]*placeholder="50°"/, 'the flexion placeholder disagrees with the norm');
  assert.match(HTML, /id="ns-lumb-ext"[^>]*placeholder="15°"/, 'the extension placeholder disagrees with the norm');
});

test('thoracic norms match the values the integration engine scores against', () => {
  const normOf = (field) => Number(SYNC.match(new RegExp(`field: '${field}'[^}]*norm:\\s*(\\d+)`))[1]);
  assert.equal(normOf('ns-thor-rot-l'), 30);
  assert.equal(normOf('ns-thor-ext'), 20);
  assert.equal(normOf('ns-thor-flex'), 30);
  assert.match(ENGINE, /thor_rotation:\s*30/);
  assert.match(ENGINE, /thor_extension:\s*20/);
  assert.match(ENGINE, /thor_flexion:\s*30/);
});

// ── the two deliberate non-colour cases ────────────────────────────
test('a zero norm drives no colour instead of dividing by zero', () => {
  // Elbow extension: 0 degrees IS normal, so (norm - v)/norm is both
  // meaningless and a divide-by-zero. The field still syncs and stores.
  assert.match(SYNC, /if \(!b\.norm\) return 0;/,
    'the zero-norm guard is gone — elbow extension will compute NaN/Infinity deficits');
  const elbowExt = bindings.filter((b) => b.rom && b.rom.startsWith('elbow_extension'));
  assert.equal(elbowExt.length, 2, 'both elbow extension sides should still be bound for sync');
  for (const b of elbowExt) assert.equal(b.kind, 'rom');
});

test('"NP" is not read as pain', () => {
  // The cervical fields are free text: "P" / "NP". A substring match would
  // read every "NP" as painful and light the neck on a normal assessment.
  const set = SYNC.match(/POSITIVE_FLAGS = new Set\(\[([^\]]*)\]/);
  assert.ok(set, 'POSITIVE_FLAGS not found');
  const values = [...set[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.ok(values.includes('p'), '"p" should count as pain');
  assert.ok(values.includes('yes'), '"yes" should count as pain');
  assert.ok(!values.includes('np'), '"np" must NOT count as pain');
  assert.match(SYNC, /POSITIVE_FLAGS\.has\(String\(raw\)\.trim\(\)\.toLowerCase\(\)\)/,
    'flags must be matched as whole values, never as substrings');
});
