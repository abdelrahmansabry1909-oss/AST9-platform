// tests/unit/service-lane-default.test.js
//
// Locks the service-lane visibility contract that keeps the Rehab and Athletic
// Performance shells separate.
//
// The defect this prevents: every lane show/hide rule in neucore-premium.css is
// scoped under `body.service-rehab` or `body.service-athletic`. When <body>
// carried no lane class, no rule applied and BOTH lanes' navigation rendered at
// once. The athletic nav items' only other protection was an inline
// `style="display:none"`, which dashboard.js `setRoleVisibility()` strips for
// every coach and admin — before `setService('rehab')` runs, and not at all on a
// path where that profile load does not finish.
//
// Static checks over the shipped markup and stylesheet. This does not prove what
// a browser renders; it proves the three preconditions the separation depends on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const HTML = readFileSync(new URL('app.html', root), 'utf8');
const PREMIUM_CSS = readFileSync(new URL('css/neucore-premium.css', root), 'utf8');

const LANE_CLASSES = ['rehab-only', 'athletic-only'];

function laneClassesOn(classAttribute) {
  return LANE_CLASSES.filter((lane) => new RegExp(`\\b${lane}\\b`).test(classAttribute));
}

// Every <div> carrying `marker` as a whole class word, with its class attribute.
function elementsWithClass(marker) {
  const pattern = new RegExp(`<div[^>]*\\bclass="([^"]*\\b${marker}\\b[^"]*)"[^>]*>`, 'g');
  return [...HTML.matchAll(pattern)].map((match) => ({
    classAttribute: match[1],
    id: (match[0].match(/\bid="([^"]+)"/) || [])[1]
      || (match[0].match(/showSection\('([^']+)'\)/) || [])[1]
      || '(unidentified)',
  }));
}

test('<body> declares exactly one default service lane', () => {
  const bodyTag = HTML.match(/<body\b[^>]*>/);
  assert.ok(bodyTag, 'app.html must contain a <body> tag');

  const classAttribute = (bodyTag[0].match(/\bclass="([^"]*)"/) || [])[1] || '';
  const lanes = ['service-rehab', 'service-athletic'].filter((lane) =>
    new RegExp(`\\b${lane}\\b`).test(classAttribute),
  );

  // Without this, no lane rule matches and both shells render together.
  assert.deepEqual(lanes, ['service-rehab'],
    `<body> must ship with the service-rehab default lane, got class="${classAttribute}"`);
});

test('every nav item and nav section header is scoped to exactly one lane', () => {
  const navElements = [...elementsWithClass('nav-item'), ...elementsWithClass('nav-section')];

  // Guards against the test silently passing on an empty match set.
  assert.ok(navElements.length >= 40,
    `expected the full navigation to be found, got ${navElements.length} elements`);

  for (const element of navElements) {
    assert.equal(laneClassesOn(element.classAttribute).length, 1,
      `nav element ${element.id} must carry exactly one of ${LANE_CLASSES.join('/')}: ` +
      `class="${element.classAttribute}"`);
  }
});

test('lane visibility rules stay scoped under the body lane classes', () => {
  // The <body> default is only load-bearing while these rules remain scoped this
  // way. If a rule is ever unscoped, the default stops being what separates the
  // lanes and this contract needs rethinking rather than patching.
  const requiredRules = [
    /body\.service-rehab\s+\.athletic-only\s*\{[^}]*display:\s*none\s*!important/,
    /body\.service-athletic\s+\.rehab-only\s*\{[^}]*display:\s*none\s*!important/,
  ];

  for (const rule of requiredRules) {
    assert.match(PREMIUM_CSS, rule);
  }

  // No lane class may be hidden or shown by an unscoped top-level rule, which
  // would apply in both lanes at once.
  for (const lane of LANE_CLASSES) {
    const unscoped = new RegExp(`^\\.${lane}\\s*\\{`, 'm');
    assert.doesNotMatch(PREMIUM_CSS, unscoped,
      `.${lane} must not be styled by an unscoped top-level rule`);
  }
});

test('a missing lane class still hides the Athletic shell', () => {
  // Second line of defence behind the <body> default. Every other lane rule is
  // scoped to a lane class, so without this one an absent class means no rule
  // matches and both shells render together — the ISSUE_LOG #19 defect. This
  // covers the runtime path the markup default cannot: a JS failure before
  // Dashboard.setService(), or any future code that drops the class.
  //
  // Measured in Chromium against the real stylesheet: with no lane class the
  // athletic nav computes to display:none and the rehab nav to flex.
  assert.match(
    PREMIUM_CSS,
    /body:not\(\.service-rehab\):not\(\.service-athletic\)\s+\.athletic-only\s*\{[^}]*display:\s*none\s*!important/,
    'a fallback rule must hide .athletic-only when <body> carries no lane class',
  );

  // The fallback must only ever hide. A rule that forces something visible is
  // the failure mode that pinned the login overlay and leaked role nav before.
  const fallback = PREMIUM_CSS.match(
    /body:not\(\.service-rehab\):not\(\.service-athletic\)[^{]*\{([^}]*)\}/,
  );
  assert.ok(fallback, 'fallback lane rule must be present');
  assert.doesNotMatch(fallback[1], /display:\s*(?!none)[a-z-]+/i,
    'the fallback lane rule must only hide, never force an element visible');
});
