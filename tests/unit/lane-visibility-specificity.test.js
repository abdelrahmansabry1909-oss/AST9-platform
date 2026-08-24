// tests/unit/lane-visibility-specificity.test.js
//
// The Rehab and Athletic Performance lanes hide each other with
// `display:none !important`. The Porcelain reskin sets sidebar LAYOUT with
// `display:flex !important` on the same elements. Both sides are !important, so
// the cascade is settled on specificity — and the reskin rules were written
// later, deeper, and higher.
//
// Result (owner-reported, 2026-08-24): every signed-in coach and admin saw the
// whole Athletic Performance nav group inside the Rehab lane, and the Rehab nav
// inside the Athletic lane.
//
// service-lane-default.test.js already guarded this contract and passed
// throughout, because it asserts the hide rules EXIST. They did exist. They
// lost. Existence is not the invariant — outranking is.
//
// So this file compares specificity: for each lane, the winning `display`
// declaration on a nav element belonging to the hidden lane must be a hide.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../../css/neucore-premium.css', import.meta.url), 'utf8');

// ── Specificity ────────────────────────────────────────────────────
// CSS Selectors L3 §9: (ids, classes+attributes+pseudo-classes, elements).
// :not()/:is() contribute the specificity of their argument, not themselves.
function specificity(selector) {
  let s = selector.trim();
  let ids = 0, classes = 0, elements = 0;

  // Score :not(...) / :is(...) arguments, then strip them.
  for (const match of s.matchAll(/:(?:not|is)\(([^()]*)\)/g)) {
    const inner = specificity(match[1]);
    ids += inner[0]; classes += inner[1]; elements += inner[2];
  }
  s = s.replace(/:(?:not|is)\([^()]*\)/g, ' ');

  s = s.replace(/::[a-z-]+/g, () => { elements += 1; return ' '; });   // pseudo-elements
  s = s.replace(/#[\w-]+/g,   () => { ids += 1;      return ' '; });
  s = s.replace(/\.[\w-]+/g,  () => { classes += 1;  return ' '; });
  s = s.replace(/\[[^\]]*\]/g, () => { classes += 1; return ' '; });
  s = s.replace(/:[a-z-]+(\([^()]*\))?/g, () => { classes += 1; return ' '; });
  s.replace(/[a-z][\w-]*/gi, () => { elements += 1; return ' '; });

  return [ids, classes, elements];
}

const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

test('the specificity calculator is correct on known selectors', () => {
  // A miscounting calculator would silently vouch for whatever the file says,
  // so pin it against hand-computed values first.
  assert.deepEqual(specificity('body.service-rehab .athletic-only'), [0, 2, 1]);
  assert.deepEqual(specificity('body.nc-bright:not(.nc-client) .sidebar .nav-item'), [0, 4, 1]);
  assert.deepEqual(
    specificity('body.nc-bright.service-rehab:not(.nc-client) .sidebar .nav-item.athletic-only'),
    [0, 6, 1],
  );
  assert.deepEqual(specificity('.a'), [0, 1, 0]);
  assert.deepEqual(specificity('#a'), [1, 0, 0]);
  assert.deepEqual(specificity('div'), [0, 0, 1]);
  assert.equal(cmp([0, 6, 1], [0, 5, 1]) > 0, true);
  assert.equal(cmp([0, 4, 1], [0, 4, 1]), 0);
});

// ── Rule extraction ────────────────────────────────────────────────
// Every rule declaring an !important display, flattened one selector per entry,
// keeping source order so ties can be broken the way a browser breaks them.
function importantDisplayRules() {
  const out = [];
  let order = 0;
  // Strip comments first. Prose in this file quotes selectors and declarations
  // verbatim, braces included, and a brace inside a comment desynchronises a
  // naive rule scan for everything after it.
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '\n');
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    const decl = body.match(/(?:^|;)\s*display\s*:\s*([a-z-]+)\s*!important/i);
    if (!decl) continue;
    for (const sel of m[1].split(',')) {
      const s = sel.trim();
      if (!s || s.startsWith('@') || s.startsWith('/*')) continue;
      out.push({ selector: s, value: decl[1].toLowerCase(), spec: specificity(s), order: order++ });
    }
  }
  return out;
}

const RULES = importantDisplayRules();

test('the stylesheet actually yielded important display rules to compare', () => {
  // Guards against a parser change silently emptying the set and passing.
  assert.ok(RULES.length >= 20, `expected many !important display rules, got ${RULES.length}`);
});

// Does `selector` match a nav element carrying `laneClass`, for a <body> with
// `bodyClasses`? Deliberately conservative: it only reasons about the compound
// selectors this stylesheet actually uses for the sidebar.
function matchesLaneNav(selector, laneClass, bodyClasses, navKind) {
  const parts = selector.split(/\s+/).filter(Boolean);
  const key = parts[parts.length - 1];

  // The subject must be the nav element itself, not a descendant of it.
  const subjectOk =
    new RegExp(`^\\.(${navKind}|${laneClass})(\\.|$)`).test(key) &&
    !/>/.test(selector) &&
    !/\*/.test(key);
  if (!subjectOk) return false;

  // Every class on the subject compound must be one this element carries.
  const onSubject = [...key.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const carried = new Set([navKind, laneClass, 'role-coach-admin']);
  if (!onSubject.every((c) => carried.has(c))) return false;

  // Ancestor compounds: body conditions must hold, `.sidebar` is satisfied.
  for (const part of parts.slice(0, -1)) {
    if (part === '.sidebar') continue;
    if (!part.startsWith('body')) return false;
    for (const [, neg] of part.matchAll(/:not\(\.([\w-]+)\)/g)) {
      if (bodyClasses.includes(neg)) return false;
    }
    for (const [, cls] of part.replace(/:not\([^)]*\)/g, '').matchAll(/\.([\w-]+)/g)) {
      if (!bodyClasses.includes(cls)) return false;
    }
    if (/:hover|:focus-within/.test(part)) return false;  // handled per-case below
  }
  return true;
}

function winner(laneClass, bodyClasses, navKind) {
  const candidates = RULES.filter((r) => matchesLaneNav(r.selector, laneClass, bodyClasses, navKind));
  if (!candidates.length) return null;
  return candidates.reduce((best, r) => {
    const d = cmp(r.spec, best.spec);
    return d > 0 || (d === 0 && r.order > best.order) ? r : best;
  });
}

// `nc-bright` is on <body> for EVERY authenticated user (app.html, _showApp).
// Testing the lanes without it would test a state no signed-in user is ever in.
const CASES = [
  ['Rehab lane hides athletic nav items',    'athletic-only', ['nc-bright', 'service-rehab'],    'nav-item'],
  ['Rehab lane hides the athletic header',   'athletic-only', ['nc-bright', 'service-rehab'],    'nav-section'],
  ['Athletic lane hides rehab nav items',    'rehab-only',    ['nc-bright', 'service-athletic'], 'nav-item'],
  ['Athletic lane hides the rehab header',   'rehab-only',    ['nc-bright', 'service-athletic'], 'nav-section'],
  ['No lane class hides athletic nav items', 'athletic-only', ['nc-bright'],                     'nav-item'],
  ['No lane class hides the athletic header','athletic-only', ['nc-bright'],                     'nav-section'],
];

for (const [name, laneClass, bodyClasses, navKind] of CASES) {
  test(name, () => {
    const win = winner(laneClass, bodyClasses, navKind);
    assert.ok(win, `no !important display rule matched .${navKind}.${laneClass} on body.${bodyClasses.join('.')}`);
    assert.equal(
      win.value, 'none',
      `body.${bodyClasses.join('.')} .${navKind}.${laneClass} resolves to display:${win.value}, ` +
      `won by "${win.selector}" at specificity (${win.spec}). The lane hide must outrank every ` +
      `layout rule matching the same element — raise its specificity rather than moving it later ` +
      `in the file, so the bundler cannot reorder the fix away.`,
    );
  });
}

test('the lane that is meant to be visible is not hidden', () => {
  // The trap: a hide rule that is not lane-scoped outranks the show rule in the
  // OTHER lane too, hiding the Athletic nav inside the Athletic lane — fixing
  // the Rehab sidebar by breaking the Performance platform.
  const shown = winner('athletic-only', ['nc-bright', 'service-athletic'], 'nav-item');
  assert.ok(shown, 'expected a rule governing athletic nav inside the athletic lane');
  assert.notEqual(
    shown.value, 'none',
    `the Athletic nav must stay visible in the Athletic lane, but "${shown.selector}" hides it. ` +
    `A lane hide missing its own lane class applies in both lanes.`,
  );
});
