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
  // The guard requires the app screen to be up and every other screen down,
  // rather than naming individual gates. An earlier version listed two of the
  // five and tested an `#app` element that does not exist, so its third clause
  // could never fire.
  assert.ok(tourSource.includes('screen-app'), 'gate check must require #screen-app to be visible');
  assert.ok(/\[id\^="screen-"\]/.test(tourSource), 'gate check must sweep every #screen-* element, not a hand-written list');
  assert.ok(!/getElementById\('app'\)/.test(tourSource), "gate check must not test #app — no such element exists in app.html");
});

test('every gate screen the guard must cover exists in app.html', () => {
  const screens = [...new Set([...appHtml.matchAll(/id="(screen-[a-z-]+)"/g)].map((m) => m[1]))];
  assert.ok(screens.includes('screen-app'), 'app.html must contain #screen-app');
  // Recorded so a future screen shows up here rather than silently escaping.
  assert.ok(screens.length >= 5, `expected the full set of gate screens, found ${screens.join(', ')}`);
});

// ── Navigation (added when the tour learned to open the screens it describes) ──
//
// The tour originally only ringed sidebar icons and never changed section, so
// it described screens the user never saw — and the "+ Add Client" step, whose
// anchor lives inside #section-clients, had no anchor to ring at all and fell
// back to a centred card with no spotlight.
//
// A step's section is derived from its `#nav-x` anchor and may be overridden
// with an explicit `section`. These guard the two ways that can break: naming a
// section that does not exist, and routing a client somewhere they may not go.

/** Every step, with the section it will open (null = stays put). */
function tourStepsWithSections(source) {
  const steps = [];
  for (const key of ['COACH_CHAPTERS', 'CLIENT_CHAPTERS']) {
    const at = source.indexOf(`const ${key} = [`);
    if (at === -1) continue;
    let depth = 0, end = -1;
    const from = source.indexOf('[', at);
    for (let i = from; i < source.length; i++) {
      if (source[i] === '[') depth++;
      else if (source[i] === ']') { depth--; if (!depth) { end = i; break; } }
    }
    for (const line of source.slice(from, end).split('\n')) {
      const sel = /sel:\s*'([^']+)'/.exec(line);
      if (!sel) continue;
      const explicit = /section:\s*'([^']+)'/.exec(line);
      const derived = /^#nav-([a-z0-9-]+)$/.exec(sel[1]);
      steps.push({
        role: key === 'CLIENT_CHAPTERS' ? 'client' : 'coach',
        sel: sel[1],
        section: explicit ? explicit[1] : (derived ? derived[1] : null),
      });
    }
  }
  return steps;
}

test('every section a tour step opens exists in app.html', () => {
  const steps = tourStepsWithSections(tourSource);
  assert.ok(steps.length >= 20, `expected the full step set, found ${steps.length}`);
  for (const s of steps) {
    if (!s.section) continue;
    assert.ok(
      appHtml.includes(`id="section-${s.section}"`),
      `step "${s.sel}" opens section "${s.section}", which has no #section-${s.section} in app.html`
    );
  }
});

test('no client tour step opens a section outside CLIENT_SAFE_SECTIONS', () => {
  for (const s of tourStepsWithSections(tourSource).filter((x) => x.role === 'client' && x.section)) {
    assert.ok(
      clientSafeSections.has(s.section),
      `client step "${s.sel}" opens "${s.section}", which is not client-safe`
    );
  }
});

test('a step whose anchor is not a nav item names its section explicitly', () => {
  // Otherwise the anchor cannot be found: it only renders once its own section
  // is active, which is exactly the bug this navigation work fixed.
  for (const s of tourStepsWithSections(tourSource)) {
    if (/^#nav-[a-z0-9-]+$/.test(s.sel) || s.sel === '#notif-bell') continue;
    assert.ok(s.section, `step "${s.sel}" is not a nav anchor and must declare a section`);
  }
});

test('the tour navigates and restores, without gaining write access', () => {
  assert.ok(/Dashboard\.showSection\(/.test(tourSource), 'tour must open the section each step describes');
  assert.ok(/_returnSection/.test(tourSource), 'tour must restore the section the user started on');
  // Navigation must not have smuggled in mutation.
  assert.ok(!/openModal\(|\.click\(\)|\.submit\(/i.test(tourSource), 'navigation must not open modals or press controls');
});

test('no tour step anchors to an element the stylesheet only reveals on hover', () => {
  // `#notif-bell` is `display:none !important` above 901px unless the sidebar is
  // :hover or :focus-within. During a tour the cursor sits on the card, so that
  // step spotlighted nothing and the card floated centred — the same symptom as
  // an anchor inside a closed section, from a different cause.
  const css = ['neucore-premium.css', 'styles.css', 'neucore-design-system.css']
    .map((f) => {
      try { return readFileSync(new URL(`../../css/${f}`, import.meta.url), 'utf8'); }
      catch { return ''; }
    })
    .join('\n');

  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map((m) => ({ sel: m[1].replace(/\s+/g, ' ').trim(), decls: m[2] }));

  const hoverGated = (id) => {
    const mentions = rules.filter((r) => r.sel.includes('#' + id));
    const hiddenByDefault = mentions.some(
      (r) => /display\s*:\s*none/i.test(r.decls) && !/:hover|:focus-within/.test(r.sel)
    );
    const shownOnHover = mentions.some(
      (r) => /:hover|:focus-within/.test(r.sel) && /display\s*:\s*(?!none)/i.test(r.decls)
    );
    return hiddenByDefault && shownOnHover;
  };

  for (const s of tourStepsWithSections(tourSource)) {
    const id = /^#([a-z0-9-]+)$/.exec(s.sel)?.[1];
    if (!id) continue;
    assert.ok(
      !hoverGated(id),
      `step anchors to #${id}, which the stylesheet hides unless hovered — it would spotlight nothing`
    );
  }
});

test('client steps target their section, because a client has no sidebar', () => {
  // `body.nc-client #sidebar` is display:none at every width — mobile-shell.css
  // covers <=768px and neucore-premium.css covers >=769px — so every client
  // step that anchored a `#nav-*` item spotlighted nothing at all. Client steps
  // point at their section instead, and the tour treats a section as a screen:
  // it dims and centres rather than drawing a border around everything.
  const clientSteps = tourStepsWithSections(tourSource).filter((s) => s.role === 'client');
  assert.ok(clientSteps.length >= 8, `expected the client step set, found ${clientSteps.length}`);
  for (const s of clientSteps) {
    assert.ok(
      s.sel.startsWith('#section-'),
      `client step "${s.sel}" must anchor its section — a client never sees the sidebar`
    );
    assert.ok(
      appHtml.includes(`id="${s.sel.slice(1)}"`),
      `client step anchors ${s.sel}, which does not exist in app.html`
    );
  }
  assert.ok(
    /classList\.contains\('section'\)/.test(tourSource),
    'the positioner must treat a section target as a screen, not ring it'
  );
});
