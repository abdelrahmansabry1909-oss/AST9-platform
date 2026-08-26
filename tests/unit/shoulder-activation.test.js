// tests/unit/shoulder-activation.test.js
//
// The scapular activation curves are READINGS OFF A PUBLISHED GRAPH (Neumann
// Fig. 5-51, data from Bagg & Forrest 1986), not tabulated figures. That makes
// them easy to "tidy" into something smoother and wrong, so they are pinned
// here along with the shape claims the panel makes in prose — the upper
// trapezius plateauing mid-arc, the lower trapezius being near-silent below 90
// degrees, the serratus climbing throughout. If a number moves, the text beside
// the chart stops being true.
//
// Also guarded: the chart must not be built while its panel is folded. Chart.js
// cannot recover from a first paint that lands in a hidden box — measured, the
// canvas keeps plausible dimensions, never retina-scales, and resize(),
// render() and update() all leave it blank.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ELEVATION_ANGLES,
  SCAPULAR_MUSCLES,
  DESCRIBED_ONLY,
  computeShoulderActivation,
} from '../../src/neucore/simulation/ShoulderActivationDB.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const CHART_SRC = read('src/neucore/simulation/ShoulderActivationChart.js');
const MAIN_JS   = read('src/main.js');
const APP_HTML  = read('app.html');

const muscle = (key) => SCAPULAR_MUSCLES.find((m) => m.key === key);

// ── The data ───────────────────────────────────────────────────────
test('the angles are the sample points on the published x-axis', () => {
  assert.deepEqual(ELEVATION_ANGLES, [30, 60, 90, 120, 150, 165]);
});

test('every curve has one value per angle', () => {
  for (const m of SCAPULAR_MUSCLES) {
    assert.equal(m.curve.length, ELEVATION_ANGLES.length, `${m.key} curve is the wrong length`);
    assert.ok(m.curve.every((v) => v >= 0 && v <= 100), `${m.key} has a value outside 0-100 %MVIC`);
  }
});

test('the readings are pinned', () => {
  assert.deepEqual(muscle('upper_trapezius').curve,   [26, 38, 45, 52, 80, 95]);
  assert.deepEqual(muscle('serratus_anterior').curve, [16, 30, 47, 58, 82, 95]);
  assert.deepEqual(muscle('lower_trapezius').curve,   [2, 5, 9, 22, 55, 95]);
});

test('every curve rises across the arc — none of them fall', () => {
  for (const m of SCAPULAR_MUSCLES) {
    for (let i = 1; i < m.curve.length; i++) {
      assert.ok(m.curve[i] >= m.curve[i - 1], `${m.key} drops between ${ELEVATION_ANGLES[i - 1]}° and ${ELEVATION_ANGLES[i]}°`);
    }
  }
});

test('the lower trapezius is near-silent below 90 degrees', () => {
  // The panel says so in prose and an implication is written on it.
  const lt = muscle('lower_trapezius').curve;
  const at90 = lt[ELEVATION_ANGLES.indexOf(90)];
  assert.ok(at90 < 15, `lower trapezius reads ${at90}% at 90°, which is not "near-silent"`);
  assert.ok(lt[ELEVATION_ANGLES.indexOf(120)] < 25, 'the under-25%-below-120° claim no longer holds');
  assert.ok(lt[ELEVATION_ANGLES.indexOf(165)] > 90, 'the lower trapezius should carry end range');
});

test('the upper trapezius plateaus through the middle of the arc', () => {
  const ut = muscle('upper_trapezius').curve;
  const early = ut[ELEVATION_ANGLES.indexOf(60)];
  const mid   = ut[ELEVATION_ANGLES.indexOf(90)];
  const late  = ut[ELEVATION_ANGLES.indexOf(150)];
  assert.ok(mid - early < 15, 'the mid-arc plateau is gone');
  assert.ok(late - mid > 25, 'the end-range climb is gone');
});

test('the serratus anterior leads the upper trapezius by end range', () => {
  const sa = muscle('serratus_anterior').curve;
  const ut = muscle('upper_trapezius').curve;
  assert.ok(sa[ELEVATION_ANGLES.indexOf(30)] < ut[ELEVATION_ANGLES.indexOf(30)], 'serratus should start lower');
  assert.ok(sa[ELEVATION_ANGLES.indexOf(120)] > ut[ELEVATION_ANGLES.indexOf(120)], 'serratus should overtake by 120°');
});

test('deltoid and supraspinatus are described, never plotted', () => {
  // They have no curve in the source, so a curve here would be invented.
  const keys = SCAPULAR_MUSCLES.map((m) => m.key);
  assert.ok(!keys.includes('deltoid'), 'a deltoid curve appeared with no source behind it');
  assert.ok(!keys.includes('supraspinatus'), 'a supraspinatus curve appeared with no source behind it');
  assert.ok(DESCRIBED_ONLY.some((d) => /deltoid|supraspinatus/i.test(d.label)),
    'they should still be named in the described-only notes');
});

// ── The client model ───────────────────────────────────────────────
test('an unmeasured shoulder reports no reach and no implications', () => {
  const r = computeShoulderActivation({});
  assert.equal(r.reach, null);
  assert.deepEqual([...r.implications], []);
  assert.equal(r.reachedFraction, null);
});

test('abduction is preferred over flexion, and the worst side is used', () => {
  const both = computeShoulderActivation({ sh_abd_l: 120, sh_abd_r: 140, sh_flex_l: 90, sh_flex_r: 90 });
  assert.equal(both.reach.degrees, 120);
  assert.equal(both.reach.motion, 'abduction');

  const flexOnly = computeShoulderActivation({ sh_flex_l: 100, sh_flex_r: 95 });
  assert.equal(flexOnly.reach.degrees, 95);
  assert.equal(flexOnly.reach.motion, 'flexion', 'the fallback must say it is flexion, not silently mix the two');
});

test('one measured side is still a reading', () => {
  const r = computeShoulderActivation({ sh_abd_l: 110, sh_abd_r: null });
  assert.equal(r.reach.degrees, 110);
});

test('a full arc with a mobile thorax raises nothing', () => {
  const r = computeShoulderActivation({ sh_abd_l: 180, sh_abd_r: 180, thor_ext: 22 });
  assert.deepEqual([...r.implications], []);
  assert.equal(r.reachedFraction, 1);
});

const ids = (r) => [...r.implications].map((i) => i.id);

test('a stiff thorax with a short arc names the thorax', () => {
  const r = computeShoulderActivation({ sh_abd_l: 120, sh_abd_r: 125, thor_ext: 8 });
  assert.ok(ids(r).includes('thoracic_cap'));
});

test('an arc stopping at 90 with a mobile thorax points at the serratus', () => {
  const r = computeShoulderActivation({ sh_abd_l: 88, sh_abd_r: 90, thor_ext: 22 });
  assert.ok(ids(r).includes('serratus_suspect'));
  assert.ok(!ids(r).includes('thoracic_cap'), 'the thorax is fine here and must not be blamed');
});

test('a short arc with a stiff thorax does NOT also blame the serratus', () => {
  // Both are plausible; the thoracic finding is the one with evidence behind it.
  const r = computeShoulderActivation({ sh_abd_l: 85, sh_abd_r: 85, thor_ext: 8 });
  assert.ok(ids(r).includes('thoracic_cap'));
  assert.ok(!ids(r).includes('serratus_suspect'));
});

test('an arc between 90 and 150 flags the under-loaded lower trapezius', () => {
  const r = computeShoulderActivation({ sh_abd_l: 130, sh_abd_r: 130, thor_ext: 22 });
  assert.ok(ids(r).includes('late_arc_lost'));
});

test('every implication cites a source and says something actionable', () => {
  const r = computeShoulderActivation({ sh_abd_l: 85, sh_abd_r: 85, thor_ext: 8 });
  assert.ok(r.implications.length);
  for (const i of r.implications) {
    assert.match(i.source, /Neumann/, `"${i.title}" has no citation`);
    assert.ok(i.detail.length > 80, `"${i.title}" has no substance behind it`);
  }
});

// ── The rendering contract ─────────────────────────────────────────
test('the chart is never built during construction', () => {
  // Chart.js cannot recover from a first paint inside a hidden box, and the
  // caller folds this panel shut on the line after `new`.
  // _initChart may be called from exactly one place: _ensureChart, which has
  // already checked the canvas has a box. Slicing to just the constructor was
  // not enough — _build() is defined further down the file and was calling
  // _initChart() directly, entirely outside the slice, so this guard passed
  // while the eager build it exists to forbid was still in the code.
  const callSites = [...CHART_SRC.matchAll(/this\._initChart\(\)/g)];
  assert.equal(callSites.length, 1, `_initChart is called ${callSites.length} times; only _ensureChart may call it`);

  const ensureStart = CHART_SRC.search(/\n {2}_ensureChart\(\)\s*\{/);
  const ensureEnd   = CHART_SRC.indexOf('\n  _build()');
  assert.ok(ensureStart > -1 && ensureEnd > ensureStart, 'could not locate the _ensureChart method');
  assert.ok(
    callSites[0].index > ensureStart && callSites[0].index < ensureEnd,
    'the one _initChart call is outside _ensureChart, so it can run against a hidden canvas',
  );

  const ctor = CHART_SRC.slice(CHART_SRC.indexOf('constructor('), ensureStart);
  assert.ok(
    !/^\s*this\._ensureChart\(\);\s*$/m.test(ctor),
    'the constructor calls _ensureChart synchronously — the panel is folded on the next line, '
    + 'so the chart paints into a hidden canvas and stays blank',
  );
});

test('the chart is built on reveal, from both triggers', () => {
  assert.match(CHART_SRC, /addEventListener\('resize'/, 'the fold\'s window resize is not listened for');
  assert.match(CHART_SRC, /new ResizeObserver/, 'nothing watches the wrapper for a size change');
  // Observing the canvas itself does not work — Chart.js pins its inline width.
  assert.match(CHART_SRC, /canvas'\)\?\.parentElement/, 'the observer must watch the wrapper, not the canvas');
});

test('_ensureChart refuses to build into a box with no size', () => {
  assert.match(CHART_SRC, /box\.width < 1 \|\| box\.height < 1/);
});

test('the category axis is indexed, not valued', () => {
  // getPixelForValue takes an INDEX on a category scale; passing a degree put
  // the cutoff band off the right edge and it silently never drew.
  assert.match(CHART_SRC, /getPixelForValue\(0\)/);
  assert.match(CHART_SRC, /getPixelForValue\(last\)/);
});

test('the panel is wired into the analysis run and folds with the others', () => {
  assert.match(APP_HTML, /<div id="shoulder-activation-panel" class="hidden"/);
  assert.match(MAIN_JS, /new ShoulderActivationChart\(shoulderWrap, legacyAssessment\)/);
  assert.ok(MAIN_JS.includes("_foldCard('shoulder-activation-panel')"));
  assert.ok(
    MAIN_JS.indexOf('new ShoulderActivationChart') < MAIN_JS.indexOf("_foldCard('shoulder-activation-panel')"),
    'the panel is folded before the chart is created',
  );
  assert.match(MAIN_JS, /shoulderChart\?\.destroy\(\)/, 'a re-run must dispose the previous chart');
});

test('the source is credited as a graph reading, not as exact data', () => {
  assert.match(CHART_SRC, /Fig\. 5-51/);
  assert.match(CHART_SRC, /±5/, 'the uncertainty of reading values off a plot must be stated to the coach');
});
