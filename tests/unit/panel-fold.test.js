// tests/unit/panel-fold.test.js
//
// The Generate page's analysis panels fold shut (js/panelFold.js). Three things
// about that are easy to break and expensive to notice:
//
//  1. Collapsing by setting `display` on an element the app already styles. That
//     is the exact shape of PR #105, PR #108 and the 2026-08-24 lane leak — a
//     losing `display` rule leaves the box stuck open, and nothing throws.
//  2. The simulation page cannot use the wrapper trick (its siblings are grid
//     items), so its hide is a bare selector that must OUTRANK the
//     `display: flex !important` column rules. Existing is not the invariant;
//     winning is.
//  3. js/*.js is served raw and unhashed, so a change without a `?v=` bump in
//     app.html reaches nobody with a warm cache.
//
// These are static contracts. Whether the chevron actually opens the box is a
// browser question, checked against a running page, not asserted here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const APP_HTML  = read('../../app.html');
const MAIN_JS   = read('../../src/main.js');
const FOLD_JS   = read('../../js/panelFold.js');
const STYLES    = read('../../css/styles.css');
const PREMIUM   = read('../../css/neucore-premium.css');

// ── Specificity ────────────────────────────────────────────────────
// CSS Selectors L3 §9: (ids, classes+attributes+pseudo-classes, elements).
// :not()/:is() contribute the specificity of their argument, not themselves.
function specificity(selector) {
  let s = selector.trim();
  let ids = 0, classes = 0, elements = 0;

  for (const match of s.matchAll(/:(?:not|is|has)\(([^()]*)\)/g)) {
    const inner = specificity(match[1]);
    ids += inner[0]; classes += inner[1]; elements += inner[2];
  }
  s = s.replace(/:(?:not|is|has)\([^()]*\)/g, ' ');

  s = s.replace(/::[a-z-]+/g, () => { elements += 1; return ' '; });
  s = s.replace(/#[\w-]+/g,   () => { ids += 1;      return ' '; });
  s = s.replace(/\.[\w-]+/g,  () => { classes += 1;  return ' '; });
  s = s.replace(/\[[^\]]*\]/g, () => { classes += 1; return ' '; });
  s = s.replace(/:[a-z-]+(\([^()]*\))?/g, () => { classes += 1; return ' '; });
  s.replace(/[a-z][\w-]*/gi, () => { elements += 1; return ' '; });

  return [ids, classes, elements];
}

const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

test('the specificity calculator is correct on known selectors', () => {
  // A miscounting calculator would vouch for whatever the file happens to say.
  assert.deepEqual(specificity('.a'), [0, 1, 0]);
  assert.deepEqual(specificity('#a'), [1, 0, 0]);
  assert.deepEqual(
    specificity('body.nc-bright:not(.nc-client) #neucore-gait-container .gait-data-column'),
    [1, 3, 1],
  );
  assert.deepEqual(
    specificity('body.nc-bright:not(.nc-client) #neucore-gait-container .gait-page.nc-fold-collapsed > .gait-data-column'),
    [1, 5, 1],
  );
  assert.equal(cmp([1, 5, 1], [1, 3, 1]) > 0, true);
});

// Every rule in `css` declaring an !important display, one entry per selector.
function importantDisplayRules(css) {
  const out = [];
  // Strip comments first: prose here quotes declarations verbatim, and a brace
  // inside a comment desynchronises a naive rule scan for everything after it.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '\n');
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl = m[2].match(/(?:^|;)\s*display\s*:\s*([a-z-]+)\s*!important/i);
    if (!decl) continue;
    for (const sel of m[1].split(',')) {
      const s = sel.trim();
      if (!s || s.startsWith('@')) continue;
      out.push({ selector: s, value: decl[1].toLowerCase(), spec: specificity(s) });
    }
  }
  return out;
}

const PREMIUM_RULES = importantDisplayRules(PREMIUM);

test('the stylesheet actually yielded important display rules to compare', () => {
  assert.ok(PREMIUM_RULES.length >= 20, `expected many rules, got ${PREMIUM_RULES.length}`);
});

// ── 1. The card fold never fights the app over `display` ───────────
test('the collapsed card hides a wrapper the fold owns, not the panel', () => {
  assert.match(
    STYLES,
    /\.nc-fold-collapsed\s*>\s*\.nc-fold-body\s*\{\s*display:\s*none;\s*\}/,
    'the closed state must hide .nc-fold-body',
  );
});

test('the card fold claims no !important display anywhere', () => {
  // .nc-fold-body is styled by this feature alone, so it needs no !important.
  // Reaching for one means the fold started hiding something the app also
  // styles — the failure mode this whole approach exists to avoid.
  const foldRules = importantDisplayRules(STYLES)
    .filter((r) => r.selector.includes('nc-fold'));
  assert.deepEqual(foldRules.map((r) => r.selector), []);
});

test('panelFold.js never sets display or toggles .hidden itself', () => {
  assert.doesNotMatch(FOLD_JS, /style\.display/, 'the fold must not set inline display');
  assert.doesNotMatch(FOLD_JS, /['"]hidden['"]/, '.hidden belongs to the show/hide path, not the fold');
});

// ── 2. The simulation fold outranks the column layout ──────────────
for (const column of ['gait-stage-column', 'gait-data-column']) {
  test(`the collapsed simulation page outranks .${column}`, () => {
    const layout = PREMIUM_RULES.filter(
      (r) => r.selector.endsWith(`.${column}`) && !r.selector.includes('nc-fold-collapsed'),
    );
    const hide = PREMIUM_RULES.filter(
      (r) => r.selector.endsWith(`.${column}`) && r.selector.includes('nc-fold-collapsed'),
    );

    assert.ok(layout.length, `no layout rule found for .${column}`);
    assert.ok(hide.length, `no fold hide found for .${column}`);
    assert.ok(hide.every((r) => r.value === 'none'), `the fold rule for .${column} must hide it`);

    const strongestLayout = layout.reduce((a, b) => (cmp(b.spec, a.spec) > 0 ? b : a));
    const weakestHide     = hide.reduce((a, b) => (cmp(b.spec, a.spec) < 0 ? b : a));

    // A tie is not good enough — it would be settled by source order, which the
    // bundler is free to change.
    assert.ok(
      cmp(weakestHide.spec, strongestLayout.spec) > 0 ||
        // The unprefixed pair only has to beat the unprefixed base stylesheet.
        !weakestHide.selector.startsWith('body'),
      `"${weakestHide.selector}" (${weakestHide.spec}) does not outrank ` +
      `"${strongestLayout.selector}" (${strongestLayout.spec})`,
    );

    const scoped = hide.filter((r) => r.selector.startsWith('body'));
    assert.ok(scoped.length, `the Porcelain-scoped hide for .${column} is missing`);
    assert.ok(
      scoped.every((r) => cmp(r.spec, strongestLayout.spec) > 0),
      `the Porcelain hide for .${column} must outrank ${strongestLayout.spec}`,
    );
  });
}

// ── 3. Cache busting and wiring ────────────────────────────────────
test('app.html loads panelFold.js with a cache-busting token', () => {
  const tag = APP_HTML.match(/<script[^>]+src="js\/panelFold\.js(\?v=[^"]*)?"/);
  assert.ok(tag, 'app.html does not load js/panelFold.js');
  assert.ok(tag[1], 'js/*.js is served unhashed — the tag needs a ?v= token');
});

test('panelFold.js loads before the module that calls it', () => {
  const fold = APP_HTML.indexOf('js/panelFold.js');
  const main = APP_HTML.indexOf('/src/main.js');
  assert.ok(fold > -1 && main > -1);
  assert.ok(fold < main, 'window.PanelFold must exist before src/main.js runs');
});

test('every analysis panel with a header is folded after it renders', () => {
  for (const call of ["_foldCard('score-panel')", "_foldCard('gait-panel')"]) {
    assert.ok(MAIN_JS.includes(call), `runMovementAnalysis does not call ${call}`);
  }
  assert.match(
    MAIN_JS,
    /PanelFold\?\.attach\(gaitWrap,\s*\{[^}]*regionSelector:\s*'\.gait-page'/s,
    'the simulation page is not folded',
  );

  // Folding must follow the render — both renderers rewrite innerHTML, which
  // would throw away a chevron attached beforehand.
  assert.ok(
    MAIN_JS.indexOf('ScoringEngine.renderScores(scores)') < MAIN_JS.indexOf("_foldCard('score-panel')"),
    'the score panel is folded before it is rendered',
  );
  assert.ok(
    MAIN_JS.indexOf('new GaitAnalysisPage(') < MAIN_JS.indexOf('PanelFold?.attach(gaitWrap'),
    'the simulation page is folded before it is built',
  );
});

// ── 4. Motion and accessibility ────────────────────────────────────
test('the chevron animation respects prefers-reduced-motion', () => {
  const blocks = [...STYLES.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g)];
  assert.ok(
    blocks.some((b) => b[1].includes('nc-fold-chevron')),
    'the chevron transition is not disabled under prefers-reduced-motion',
  );
});

test('the whole header bar toggles, not only the arrow', () => {
  // Asking someone to hit a 24px chevron in a report header is the wrong
  // target: people aim at the bar. Owner-reported as "the minimize button
  // doesn't work" — they were clicking the title.
  assert.match(FOLD_JS, /header\.addEventListener\('click'/, 'the header bar is not clickable');
  assert.match(
    FOLD_JS,
    /closest\('button, a, input, select, textarea, label'\)/,
    'clicks on controls inside the header must not toggle the fold',
  );
  assert.match(STYLES, /\.nc-fold-head\s*\{[^}]*cursor:\s*pointer/, 'the bar does not read as clickable');
});

test('the chevron is a 24px target, not a bare 10x12 glyph', () => {
  // WCAG 2.5.8. Measured 24x24 in the browser; pinned here so a later tidy-up
  // of the padding cannot silently shrink it back.
  const rule = STYLES.match(/\.nc-fold-chevron\s*\{([^}]*)\}/);
  assert.ok(rule, '.nc-fold-chevron has no rule');
  assert.match(rule[1], /min-width:\s*24px/);
  assert.match(rule[1], /padding:\s*6px/);
});

test('the chevron reports its state to assistive technology', () => {
  assert.match(FOLD_JS, /aria-expanded/);
  assert.match(FOLD_JS, /aria-label/);
  assert.match(FOLD_JS, /btn\.type\s*=\s*'button'/, 'a bare <button> inside a form would submit it');
});
