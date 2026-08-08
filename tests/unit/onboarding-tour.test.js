import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tourSource = readFileSync(new URL('../../js/tour.js', import.meta.url), 'utf8');
const appHtml = readFileSync(new URL('../../app.html', import.meta.url), 'utf8');
const stylesCss = readFileSync(new URL('../../css/styles.css', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../../js/dashboard.js', import.meta.url), 'utf8');

// Extract CLIENT_SAFE_SECTIONS list from js/dashboard.js
const safeSectionsMatch = dashboardSource.match(/CLIENT_SAFE_SECTIONS\s*=\s*new\s*Set\(\[\s*([\s\S]*?)\s*\]\)/);
assert.ok(safeSectionsMatch, 'CLIENT_SAFE_SECTIONS must be defined in js/dashboard.js');
const clientSafeSections = new Set(
  [...safeSectionsMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1])
);

// Helper to test if a selector exists in app.html
function selectorExistsInHtml(html, sel) {
  if (sel.startsWith('#')) {
    const id = sel.slice(1);
    return new RegExp(`id="${id}"`).test(html);
  }
  if (sel.startsWith('[') && sel.endsWith(']')) {
    const attrMatch = sel.slice(1, -1).match(/^([a-z0-9_-]+)\*="([^"]+)"$/i);
    if (attrMatch) {
      const [, attr, val] = attrMatch;
      return new RegExp(`${attr}="[^"]*${val.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}[^"]*"`).test(html);
    }
  }
  return false;
}

// Find section parent ID of an element ID in app.html
function findParentSectionOfId(html, id) {
  const lines = html.split('\n');
  let currentSection = null;
  for (const line of lines) {
    const secMatch = line.match(/<div[^>]*class="[^"]*section[^"]*"[^>]*id="section-([a-z0-9-]+)"/);
    if (secMatch) {
      currentSection = secMatch[1];
    }
    if (line.includes(`id="${id}"`)) {
      // Return section ID if inside a section, or 'global' if in global sidebar/nav
      return currentSection || 'global';
    }
  }
  return null;
}

test('every selector in js/tour.js resolves to an element in app.html', () => {
  const selectors = [...tourSource.matchAll(/sel:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(selectors.length >= 13, `Expected at least 13 selectors, found ${selectors.length}`);

  for (const sel of selectors) {
    assert.ok(
      selectorExistsInHtml(appHtml, sel),
      `Selector "${sel}" from js/tour.js must match an element in app.html`
    );
  }
});

test('every client tour step targets an anchor inside CLIENT_SAFE_SECTIONS or global shell', () => {
  // Parse CLIENT_CHAPTERS array content from js/tour.js
  const clientChaptersMatch = tourSource.match(/const CLIENT_CHAPTERS = \[([\s\S]*?)\];/);
  assert.ok(clientChaptersMatch, 'CLIENT_CHAPTERS must be defined in js/tour.js');
  const clientSelectors = [...clientChaptersMatch[1].matchAll(/sel:\s*'([^']+)'/g)].map(m => m[1]);

  for (const sel of clientSelectors) {
    if (sel.startsWith('#nav-')) {
      const id = sel.slice(1);
      const section = findParentSectionOfId(appHtml, id);
      // Nav items in global sidebar link to sections via Dashboard.showSection('...')
      const navItemMatch = appHtml.match(new RegExp(`id="${id}"[^>]*onclick="Dashboard\\.showSection\\('([^']+)'\\)`));
      if (navItemMatch) {
        const targetSection = navItemMatch[1];
        assert.ok(
          clientSafeSections.has(targetSection),
          `Client tour anchor ${sel} targets section "${targetSection}", which must be in CLIENT_SAFE_SECTIONS`
        );
      }
    }
  }
});

test('the Single Gold Moment (#D4AF37) appears exactly once in the entire tour', () => {
  const goldHexMatchesInTour = [...tourSource.matchAll(/#D4AF37/gi)];
  const goldHexMatchesInCss = [...stylesCss.matchAll(/\.nc-tour-btn-finish[^{]*\{[^}]*#D4AF37/gi)];
  assert.equal(goldHexMatchesInTour.length + goldHexMatchesInCss.length, 1, 'Gold #D4AF37 must appear exactly once across tour JS and CSS');
});

test('tour does not mutate data or trigger RPCs other than complete_onboarding', () => {
  const rpcCalls = [...tourSource.matchAll(/sb\.rpc\('([^']+)'\)/g)].map(m => m[1]);
  assert.deepEqual(rpcCalls, ['complete_onboarding'], 'Tour must only invoke complete_onboarding RPC');
  assert.ok(!/openModal\(|closeModal\(|Dashboard\.openModal|Dashboard\.closeModal/i.test(tourSource), 'Tour must not call modal functions or mutate data');
});

test('tour CSS does not set display: ... !important on shell-toggled elements', () => {
  const tourCssBlock = stylesCss.match(/\/\* ── ONBOARDING TOUR [\s\S]*/);
  assert.ok(tourCssBlock, 'Porcelain tour CSS section must exist in css/styles.css');
  assert.ok(!/display:[^;]*!important/i.test(tourCssBlock[0]), 'Tour CSS must never use display: ... !important');
});

test('tour start is guarded against starting over gate screens (_isGateVisible)', () => {
  assert.ok(tourSource.includes('_isGateVisible'), 'Tour must include gate screen visibility check');
  assert.ok(tourSource.includes('screen-login'), 'Tour gate check must inspect #screen-login');
  assert.ok(tourSource.includes('screen-legal-required'), 'Tour gate check must inspect #screen-legal-required');
});
