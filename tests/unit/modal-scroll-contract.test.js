// A modal that clips its overflow must give the scroll to its body.
//
// `css/styles.css` sizes every modal with `max-height: 90vh; overflow-y: auto`,
// so a tall modal scrolls and its footer stays reachable. A later premium rule
// set `overflow: hidden !important` on the same element to clip children to the
// 20px corner radius -- and the shorthand plus `!important` beat the base
// `overflow-y`. The cap survived, the scroll did not, so everything past 90vh
// was clipped with no way to reach it.
//
// Measured on the add-client modal (content 872px): unreachable "Create
// Account" at 1366x768 (183px clipped), 1280x720 (226px) and 390x844 (198px).
// Across all 17 modals x 6 viewports: 69 failing assertions before, 0 after.
//
// The fix keeps the clipping and moves the scroll to `.modal-body`, with the
// panel a flex column so header and footer stay pinned. This guard fails if
// any of the three pieces of that contract goes missing, because losing any
// one of them silently restores the bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssDir = fileURLToPath(new URL('../../css/', import.meta.url));

/**
 * Collect declarations from every rule whose selector targets a class,
 * keyed by that class. `.modal` and `.modal-body` are tracked separately —
 * `\b` would treat them as the same token, so the boundary is explicit.
 */
export function collectModalDeclarations(source) {
  const found = { panelClipsOverflow: false, panelIsFlexColumn: false, bodyScrolls: false, bodyCanShrink: false };
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = ruleRe.exec(source))) {
    const selector = match[1].trim();
    const decls = match[2];
    const has = (prop, value) =>
      new RegExp(`(^|[;\\s])${prop}\\s*:\\s*${value}\\s*(!important)?\\s*(;|$)`, 'i').test(decls);

    // Only rules that apply to EVERY modal can satisfy the contract. An
    // id-scoped rule fixes one dialog and leaves the other sixteen broken --
    // `#modal-ex-video` already carried both `overflow-y:auto` and
    // `flex-direction:column`, which silently satisfied an earlier draft of
    // this guard while the bug was live in every other modal.
    if (selector.includes('#')) continue;

    // `.modal` the panel, not `.modal-body` / `.modal-header` / `.modal-footer`.
    const isPanel = /\.modal(?![-\w])/.test(selector) && !selector.includes('::');
    const isBody = /\.modal-body(?![-\w])/.test(selector);

    if (isPanel) {
      if (has('overflow', 'hidden')) found.panelClipsOverflow = true;
      if (has('display', 'flex')) found.panelIsFlexColumn = has('flex-direction', 'column') || found.panelIsFlexColumn;
    }
    if (isBody) {
      if (has('overflow-y', 'auto') || has('overflow', 'auto')) found.bodyScrolls = true;
      if (has('min-height', '0')) found.bodyCanShrink = true;
    }
  }
  return found;
}

const sources = readdirSync(cssDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(cssDir + f, 'utf8'))
  .join('\n');

const state = collectModalDeclarations(sources);

test('a modal that clips overflow gives the scroll to its body', () => {
  if (!state.panelClipsOverflow) return; // nothing clips; base overflow-y:auto still applies
  assert.ok(
    state.bodyScrolls,
    '.modal sets overflow:hidden but no .modal-body rule sets overflow-y:auto — ' +
      'content past max-height is clipped and the footer becomes unreachable'
  );
});

test('a clipping modal is a flex column so its footer stays pinned', () => {
  if (!state.panelClipsOverflow) return;
  assert.ok(
    state.panelIsFlexColumn,
    '.modal sets overflow:hidden but is not display:flex + flex-direction:column — ' +
      'the body cannot be the only scrolling region'
  );
});

test('the scrolling modal body is allowed to shrink below its content', () => {
  if (!state.panelClipsOverflow) return;
  assert.ok(
    state.bodyCanShrink,
    '.modal-body scrolls but has no min-height:0 — a flex child defaults to ' +
      'min-height:auto and refuses to shrink, pushing the footer back out of the panel'
  );
});

// The guard must actually detect the broken shape, not just pass on anything.
test('guard detects the original defect', () => {
  const broken = `
    .modal { max-height: 90vh; overflow-y: auto; }
    body.nc-bright .modal { border-radius: 20px !important; overflow: hidden !important; }
    body.nc-bright .modal-body { padding: 24px !important; }
  `;
  const s = collectModalDeclarations(broken);
  assert.equal(s.panelClipsOverflow, true, 'should see the clipping panel');
  assert.equal(s.bodyScrolls, false, 'should see that no body rule restores the scroll');
  assert.equal(s.panelIsFlexColumn, false, 'should see that the panel is not a flex column');
});

test('guard accepts the repaired shape', () => {
  const repaired = `
    body.nc-bright .modal { overflow: hidden !important; display: flex !important; flex-direction: column !important; }
    body.nc-bright .modal-body { overflow-y: auto !important; min-height: 0 !important; }
  `;
  const s = collectModalDeclarations(repaired);
  assert.equal(s.panelClipsOverflow, true);
  assert.equal(s.bodyScrolls, true);
  assert.equal(s.panelIsFlexColumn, true);
  assert.equal(s.bodyCanShrink, true);
});
