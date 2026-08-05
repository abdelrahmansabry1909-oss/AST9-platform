// A vendor-prefixed declaration must come BEFORE its standard counterpart.
//
// CSS resolves duplicate declarations last-wins, and the minifier keeps the last
// of a prefixed/standard pair. With the standard property written first, the
// build emitted ONLY `-webkit-backdrop-filter` for 29 of the app's declarations
// -- and Chrome 151 does not support that alias at all (`CSS.supports(
// '-webkit-backdrop-filter', 'blur(8px)')` is false), so every one of those
// blurs silently rendered nothing.
//
// Measured before the fix: 21 standard / 64 prefixed in the built CSS.
// After reordering the 29 pairs: 63 standard / 64 prefixed.
//
// This guard fails if a new pair is ever written standard-first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const cssDir = fileURLToPath(new URL('../../css/', import.meta.url));

// Properties where the prefixed form is a distinct property name that older
// engines require. Extend as the codebase grows.
const PREFIXED = ['backdrop-filter', 'mask-image', 'user-select', 'background-clip'];

const DECL = /^\s*(-webkit-|-moz-|-ms-)?([a-z-]+)\s*:\s*([^;]+);\s*$/;

/**
 * Pairs where a standard declaration is immediately followed by its own
 * prefixed form — the order that loses the standard property at build time.
 */
export function findStandardBeforePrefix(source, file) {
  const offenders = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i].match(DECL);
    const next = lines[i + 1].match(DECL);
    if (!current || !next) continue;
    if (current[1]) continue;                       // current is already prefixed
    if (!next[1]) continue;                         // next is not prefixed
    if (current[2] !== next[2]) continue;           // different properties
    if (!PREFIXED.includes(current[2])) continue;
    offenders.push(`${file}:${i + 1} — "${current[2]}" is declared before "${next[1]}${next[2]}"`);
  }
  return offenders;
}

const cssFiles = readdirSync(cssDir).filter((name) => name.endsWith('.css'));

test('there are stylesheets to check', () => {
  assert.ok(cssFiles.length > 0, 'no .css files found — the guard would pass vacuously');
});

for (const file of cssFiles) {
  test(`vendor prefix precedes the standard property: ${file}`, () => {
    const offenders = findStandardBeforePrefix(readFileSync(join(cssDir, file), 'utf8'), file);
    assert.deepEqual(
      offenders,
      [],
      `the standard property must come LAST so it wins, and so the minifier keeps it:\n  ${offenders.join('\n  ')}`
    );
  });
}

test('the guard actually detects the wrong order', () => {
  const wrong = '  backdrop-filter: blur(8px);\n  -webkit-backdrop-filter: blur(8px);\n';
  assert.equal(findStandardBeforePrefix(wrong, 'x.css').length, 1);

  const right = '  -webkit-backdrop-filter: blur(8px);\n  backdrop-filter: blur(8px);\n';
  assert.deepEqual(findStandardBeforePrefix(right, 'x.css'), []);
});
