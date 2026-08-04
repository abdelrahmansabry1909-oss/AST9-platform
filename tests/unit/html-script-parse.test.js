// KNOWN_LIMITATIONS L15 / ISSUE_LOG #22.
//
// `npm run build` only parses what is in the Vite module graph, and the rest of
// `test:unit` only parses what it imports. Most of the app's JavaScript is
// neither: ~54 classic IIFEs that `app.html` loads with a plain `<script src>`.
// On 2026-08-03 one of them (`js/rpm/graph-builder.js`) shipped as a syntax
// error, the whole file failed to parse, the Reactive Graph tab was dead, and
// every CI gate passed it. This test closes that class.
//
// Parse goal matters. `package.json` declares `"type": "module"`, so a plain
// `node --check` would parse the classic IIFEs as ESM — strict mode — and could
// report failures for code the browser accepts. Each file is therefore checked
// against the goal the browser will actually use:
//   <script src>                -> classic script  (vm.Script, sloppy mode)
//   <script type="module" src>  -> ES module       (node --check, type: module)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { spawnSync } from 'node:child_process';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Every HTML file the site actually serves. A script referenced from here is
// executed by a real browser, so it must parse.
const HTML_ENTRY_POINTS = ['app.html', 'index.html'];

const SCRIPT_TAG = /<script\b([^>]*)>/gis;
const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i;
const MODULE_TYPE = /\btype\s*=\s*["']module["']/i;

/**
 * Local scripts referenced by an HTML document, with cache-bust tokens stripped.
 * External (CDN) sources are excluded — they are pinned and verified separately
 * by cdn-script-pinning.test.js, and this repository cannot parse them.
 */
export function collectScriptReferences(html, htmlFile) {
  const references = [];
  for (const [, attributes] of html.matchAll(SCRIPT_TAG)) {
    const src = attributes.match(SRC_ATTR)?.[1];
    if (!src || /^(?:https?:)?\/\//i.test(src)) continue;
    references.push({
      htmlFile,
      src,
      // "js/foo.js?v=20260803d" and "/src/main.js" both resolve from the repo root
      path: src.split('?')[0].replace(/^\//, ''),
      isModule: MODULE_TYPE.test(attributes),
    });
  }
  return references;
}

const references = HTML_ENTRY_POINTS.flatMap((htmlFile) =>
  collectScriptReferences(readFileSync(join(repoRoot, htmlFile), 'utf8'), htmlFile)
);

test('the HTML entry points reference scripts to check', () => {
  // Guards against the regex silently matching nothing and the suite passing
  // while checking zero files.
  assert.ok(
    references.length >= 50,
    `expected the entry points to reference at least 50 local scripts, found ${references.length}`
  );
});

test('every referenced script exists on disk', () => {
  const missing = references
    .filter(({ path }) => !existsSync(join(repoRoot, path)))
    .map(({ htmlFile, src }) => `${htmlFile} -> ${src}`);
  assert.deepEqual(missing, [], `referenced scripts not found:\n  ${missing.join('\n  ')}`);
});

for (const { htmlFile, src, path, isModule } of references) {
  if (!existsSync(join(repoRoot, path))) continue; // reported by the test above

  test(`parses as ${isModule ? 'a module' : 'a classic script'}: ${path}  (${htmlFile})`, () => {
    const absolute = join(repoRoot, path);

    if (isModule) {
      const result = spawnSync(process.execPath, ['--check', absolute], { encoding: 'utf8' });
      assert.equal(
        result.status,
        0,
        `node --check rejected ${path}:\n${result.stderr?.trim()}`
      );
      return;
    }

    // Compiling, not running: the constructor throws SyntaxError on a parse
    // failure and never executes the code.
    assert.doesNotThrow(
      () => new Script(readFileSync(absolute, 'utf8'), { filename: absolute }),
      `${path} does not parse as a classic script`
    );
  });
}

test('the guard actually fails on a broken file', () => {
  // A check that cannot fail is not a check. This is the exact shape of the
  // 2026-08-03 defect: a function pasted inside an unterminated template literal.
  const broken = 'function a() { const s = `oops\nfunction b() { return 1; }\n';
  assert.throws(() => new Script(broken), SyntaxError);

  const validClassic = 'var x = 1; function y() { return x; }';
  assert.doesNotThrow(() => new Script(validClassic));
});

test('classic scripts are not parsed as modules', () => {
  // Regression guard for the parse-goal split itself. `package.json` is
  // "type": "module", so a bare `node --check` treats .js as ESM. Sloppy-mode
  // constructs that browsers accept in a classic <script> must not be reported
  // as failures — if this ever throws, the classifier has been broken.
  const sloppyButValid = 'var o = { a: 1, a: 2 };';
  assert.doesNotThrow(() => new Script(sloppyButValid));
});
