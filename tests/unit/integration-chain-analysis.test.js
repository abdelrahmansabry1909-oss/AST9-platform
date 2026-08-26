// tests/unit/integration-chain-analysis.test.js
//
// The integration engine reports how one region's restriction is paid for by
// another. Three things have to hold, and none of them are visible by reading:
//
//  1. A healthy client produces NO findings. A chain engine that fires on
//     everybody is noise, and a coach learns to ignore the panel.
//  2. A rule whose inputs were never measured says so. Silently skipping is
//     how "your upper body is fine" gets reported for a client whose upper
//     body was never touched — the fake-success failure mode.
//  3. Every DOM id readForm() reaches for exists in app.html. Inventing an
//     element id is the exact 2026-08-02 regression (`#billing-catalog`); the
//     `el ? … : ''` guard turns it into silence, not an error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const APP_HTML     = read('app.html');
const SCORING_JS   = read('js/scoring.js');
const MAIN_JS      = read('src/main.js');

function loadEngine(file, globalName) {
  const sandbox = { window: {}, document: { getElementById: () => null }, console };
  vm.createContext(sandbox);
  vm.runInContext(read(file), sandbox);
  return sandbox.window[globalName];
}

// Arrays built inside the vm carry that realm's Array.prototype, so
// deepStrictEqual rejects a structurally identical [] with "same structure but
// not reference-equal". Re-home them before comparing.
const own = (arr) => [...arr];

const Engine = loadEngine('js/integrationEngine.js', 'IntegrationEngine');

// A client measured head to toe with everything inside Neumann's ranges.
const HEALTHY = Object.freeze({
  hip_flex_l: 120, hip_flex_r: 120, lumb_flex_deg: 50, lumb_ext_deg: 15,
  sh_abd_l: 180, sh_abd_r: 180, sh_ext_l: 55, sh_ext_r: 55,
  thor_rot_l: 30, thor_rot_r: 30, thor_ext: 22,
  cerv_rot_l: 90, cerv_rot_r: 90,
  pronation_l: 'neutral', pronation_r: 'neutral',
  hip_ir_l: 40, hip_ir_r: 40, tib_ir_l: 20, tib_ir_r: 20,
});

test('the engine loaded and exposes its rule set', () => {
  assert.ok(Engine, 'window.IntegrationEngine was not defined');
  assert.ok(Engine.RULES.length >= 6, `expected the six chain rules, got ${Engine.RULES.length}`);
});

// ── 1. No false positives ──────────────────────────────────────────
test('a client inside every normative range produces no findings', () => {
  const r = Engine.analyze(HEALTHY);
  assert.deepEqual(
    own(r.findings).map((f) => f.id), [],
    'a healthy client tripped a chain rule — the panel becomes noise and gets ignored',
  );
  assert.equal(r.assessed_count, r.total_rules, 'a fully measured client should leave nothing unassessable');
});

// ── 2. The relationships each fire on their own mechanism ──────────
const CASES = [
  {
    name: 'a hip-limited bend is reported as the lumbar spine taking the range',
    input: { ...HEALTHY, hip_flex_l: 45, hip_flex_r: 50, lumb_flex_deg: 62 },
    id: 'lumbopelvic_rhythm',
    saysAnyOf: ['lumbar spine is supplying'],
  },
  {
    name: 'a lumbar-limited bend is reported the other way round',
    input: { ...HEALTHY, lumb_flex_deg: 20 },
    id: 'lumbopelvic_rhythm',
    saysAnyOf: ['stiff segment is the lumbar spine'],
  },
  {
    name: 'a capped overhead reach with a stiff thorax names the thorax',
    input: { ...HEALTHY, sh_abd_l: 120, sh_abd_r: 125, thor_ext: 8 },
    id: 'thoracic_shoulder_rhythm',
    saysAnyOf: ['behind the shoulder, not in it'],
  },
  {
    name: 'a capped overhead reach with no thoracic measurement refuses to blame the thorax',
    input: { ...HEALTHY, sh_abd_l: 120, sh_abd_r: 125, thor_ext: null },
    id: 'thoracic_shoulder_rhythm',
    saysAnyOf: ['is unknown'],
  },
  {
    name: 'a stiff thorax with a full-range neck flags the neck working at its limit',
    input: { ...HEALTHY, thor_rot_l: 12, thor_rot_r: 14 },
    id: 'axial_rotation_budget',
    saysAnyOf: ['top of its range'],
  },
  {
    name: 'a flat thorax with a mobile low back flags the low back doing both jobs',
    input: { ...HEALTHY, thor_ext: 8, lumb_ext_deg: 18 },
    id: 'reciprocal_curves',
    saysAnyOf: ['work of two regions', 'producing the extension'],
  },
  {
    name: 'a stiff thorax is reported as a walking cost, not only a range number',
    input: { ...HEALTHY, thor_rot_l: 12, thor_rot_r: 14 },
    id: 'gait_counter_rotation',
    saysAnyOf: ['energy cost of walking'],
  },
  {
    name: 'over-pronation with a stiff hip is reported as rotation with nowhere to go',
    input: { ...HEALTHY, pronation_l: 'over', pronation_r: 'over', hip_ir_l: 22, hip_ir_r: 24 },
    id: 'rotation_chain_foot_to_pelvis',
    saysAnyOf: ['knee and lumbar spine are next'],
  },
];

for (const c of CASES) {
  test(c.name, () => {
    const found = Engine.analyze(c.input).findings.find((f) => f.id === c.id);
    assert.ok(found, `${c.id} did not fire`);
    const text = `${found.finding} ${found.why}`;
    assert.ok(
      c.saysAnyOf.some((s) => text.includes(s)),
      `${c.id} fired but explained it as: ${text}`,
    );
  });
}

// ── 3. Missing data is declared, never assumed ─────────────────────
test('rules whose inputs were not measured are listed, not silently dropped', () => {
  const lowerOnly = {
    hip_flex_l: 120, hip_flex_r: 120, hip_ir_l: 22, hip_ir_r: 24,
    pronation_l: 'over', pronation_r: 'over', tib_ir_l: 26, tib_ir_r: 25,
  };
  const r = Engine.analyze(lowerOnly);
  const skipped = r.not_assessed.map((n) => n.title);
  assert.ok(skipped.length >= 3, `expected the upper-body chains to be unassessable, got ${skipped.length}`);
  assert.ok(r.assessed_count < r.total_rules);
  for (const n of r.not_assessed) {
    assert.ok(n.needs.length, `"${n.title}" does not say what measurement it is missing`);
  }
});

test('an empty assessment reports nothing rather than everything', () => {
  const r = Engine.analyze({});
  assert.deepEqual(own(r.findings), [], 'an unmeasured client produced findings');
  assert.equal(r.not_assessed.length, r.total_rules);
});

test('findings are ordered most severe first', () => {
  const r = Engine.analyze({
    ...HEALTHY, thor_rot_l: 12, thor_rot_r: 14, thor_ext: 8,
    lumb_ext_deg: 18, sh_abd_l: 120, sh_abd_r: 125,
  });
  const rank = { severe: 0, moderate: 1, mild: 2 };
  const order = own(r.findings).map((f) => rank[f.severity]);
  assert.ok(order.length > 1, 'need several findings to test ordering');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'severe findings are not first');
});

// ── 4. The normative values are the book's, and stay put ───────────
test('the Neumann values are pinned', () => {
  // Changing any of these changes clinical output. They are Table 9-11 and
  // Figs. 9-54/55/56/66, Ch. 5 and Ch. 15 — not adjustable defaults.
  const n = Engine.NEUMANN;
  assert.equal(n.thor_rotation, 30);
  assert.equal(n.thor_extension, 20);
  assert.equal(n.lumb_flexion, 50);
  assert.equal(n.lumb_extension, 15);
  assert.equal(n.lumb_rotation, 5);
  assert.equal(n.cranio_rotation, 90);
  assert.equal(n.head_turn_total, n.cranio_rotation + n.thor_rotation + n.lumb_rotation);
  assert.equal(n.bend_lumbar, 40);
  assert.equal(n.bend_hip, 70);
  assert.equal(n.elevation_full, n.gh_share + n.scap_share);
  assert.equal(n.gh_share / n.scap_share, 2, 'scapulohumeral rhythm is 2:1');
});

test('every finding cites where it came from', () => {
  const r = Engine.analyze({
    ...HEALTHY, thor_rot_l: 10, thor_rot_r: 10, thor_ext: 5, lumb_ext_deg: 18,
    sh_abd_l: 100, sh_abd_r: 100, hip_flex_l: 40, hip_flex_r: 40,
    pronation_l: 'over', pronation_r: 'over', hip_ir_l: 15, hip_ir_r: 15,
  });
  assert.ok(r.findings.length >= 5);
  for (const f of r.findings) {
    assert.match(f.source, /Neumann/, `"${f.title}" has no citation`);
    assert.ok(f.actions.length, `"${f.title}" states a problem with nothing to do about it`);
    assert.ok(f.chain.includes('↔') || f.chain.includes('→'), `"${f.title}" does not name a chain`);
  }
});

// ── 5. Wiring: the ids exist, the panel is reachable ───────────────
// readForm keeps four pre-NeuCore fallbacks — `gf('ns-ankle-df-l') || gf('ns-ankle-mob')`
// and friends — whose elements were removed from the form long ago. They are
// inert (`g()` returns '' for a missing element) and are left alone here
// because nothing asked for them to be removed. Pinned by name so the guard
// below still fails on a NEW id that does not exist.
const RETIRED_FALLBACK_IDS = ['ns-toetouch', 'ns-ankle-mob', 'ns-pronsup', 'ns-load'];

test('every element id readForm() reads exists in app.html', () => {
  // `const g = id => { const e = document.getElementById(id); return e ? … : '' }`
  // means a typo returns empty rather than throwing. This is the only place a
  // wrong id gets caught.
  const ids = [...SCORING_JS.matchAll(/\bg[if]?\('(ns-[\w-]+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 40, `expected the full form, found ${ids.length} ids`);
  const missing = [...new Set(ids)]
    .filter((id) => !APP_HTML.includes(`id="${id}"`))
    .filter((id) => !RETIRED_FALLBACK_IDS.includes(id));
  assert.deepEqual(missing, [], `readForm reads ids that are not in app.html: ${missing.join(', ')}`);
});

test('the retired fallback ids are still exactly the four known ones', () => {
  // If one of these reappears on the form, drop it from the list. If a fifth
  // shows up, it is a new bug, not a legacy one.
  const ids = new Set([...SCORING_JS.matchAll(/\bg[if]?\('(ns-[\w-]+)'\)/g)].map((m) => m[1]));
  const stillDead = RETIRED_FALLBACK_IDS.filter(
    (id) => ids.has(id) && !APP_HTML.includes(`id="${id}"`),
  );
  assert.deepEqual(stillDead, RETIRED_FALLBACK_IDS);
});

test('the new thoracic and abduction inputs are on the assessment form', () => {
  for (const id of ['ns-thor-rot-l', 'ns-thor-rot-r', 'ns-thor-ext', 'ns-thor-flex',
                    'ns-sh-abd-l', 'ns-sh-abd-r']) {
    assert.ok(APP_HTML.includes(`id="${id}"`), `${id} is missing from app.html`);
    assert.ok(SCORING_JS.includes(`'${id}'`), `${id} is on the form but readForm never reads it`);
  }
});

test('lumbar free-text is parsed to a number rather than retyped as a number input', () => {
  // Those two fields have always been free text and may already hold "45°" or
  // "approx 45". Switching the input type would discard that.
  assert.match(SCORING_JS, /lumb_flex_deg:\s*_firstNumber/);
  assert.match(SCORING_JS, /lumb_ext_deg:\s*_firstNumber/);
  assert.match(APP_HTML, /id="ns-lumb-flex"[^>]*class="form-input"/, 'ns-lumb-flex should stay free text');
});

test('runMovementAnalysis renders the panel, unhides it, and folds it', () => {
  assert.match(MAIN_JS, /IntegrationEngine\.renderIntegration\(IntegrationEngine\.analyze\(/);
  assert.match(MAIN_JS, /getElementById\('integration-panel'\)\?\.classList\.remove\('hidden'\)/);
  assert.ok(MAIN_JS.includes("_foldCard('integration-panel')"));
  assert.ok(
    MAIN_JS.indexOf('renderIntegration') < MAIN_JS.indexOf("_foldCard('integration-panel')"),
    'the panel is folded before it is rendered',
  );
  assert.match(APP_HTML, /<div id="integration-panel" class="card hidden"/);
});

test('the engines are loaded with cache-busting tokens', () => {
  // js/*.js is served raw and unhashed.
  for (const file of ['integrationEngine', 'scoring']) {
    const tag = APP_HTML.match(new RegExp(`<script[^>]+src="js/${file}\\.js(\\?v=[^"]*)?"`));
    assert.ok(tag, `app.html does not load js/${file}.js`);
    assert.ok(tag[1], `js/${file}.js needs a ?v= token — it changed in this branch`);
  }
});

test('the integration engine loads before the module that calls it', () => {
  assert.ok(
    APP_HTML.indexOf('js/integrationEngine.js') < APP_HTML.indexOf('/src/main.js'),
    'window.IntegrationEngine must exist before src/main.js runs',
  );
});
