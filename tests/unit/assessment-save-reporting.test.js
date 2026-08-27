// tests/unit/assessment-save-reporting.test.js
//
// A failed assessment save must never look like a successful one.
//
// It did, for a long time, and it took four independent silences to manage it
// (docs/ISSUE_LOG.md #29):
//   1. the caller did not await the save, and toasted success on the next line;
//   2. one try/catch wrapped every insert and ended in a bare console.warn;
//   3. `if (!aRow) return` exited silently, skipping every dependent insert;
//   4. supabase-js RETURNS `{ error }` rather than throwing, and none of the
//      inserts destructured it — so an RLS denial or an unknown column raised
//      no exception and the catch never ran at all.
//
// (4) is the one that made the other three lethal, and it is the one a reader
// is most likely to reintroduce, because `await sb.from(x).insert({...})` looks
// complete on its own. These tests exist to make that specific omission fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const DASH = readFileSync(new URL('js/dashboard.js', root), 'utf8');

// The body of _saveToSupabase, from its declaration to the next top-level
// function in the file.
function saveFunctionBody() {
  const start = DASH.indexOf('async function _saveToSupabase(');
  assert.ok(start > -1, '_saveToSupabase not found — has it been renamed?');
  const after = DASH.slice(start + 10);
  const nextFn = after.search(/\n {2}(?:async )?function /);
  assert.ok(nextFn > -1, 'could not find the end of _saveToSupabase');
  return DASH.slice(start, start + 10 + nextFn);
}

const BODY = saveFunctionBody();

test('every insert in the save path checks its returned error', () => {
  // supabase-js does not throw. An insert whose `{ error }` is discarded fails
  // in total silence — this is failure (4), and it is the whole ballgame.
  const inserts = [...BODY.matchAll(/(?:const \{([^}]*)\} = )?await sb\s*\n?\s*\.?from\(['"]([a-z_]+)['"]\)[\s\S]{0,40}?\.insert\(/g)];
  assert.ok(inserts.length >= 5, `expected at least 5 inserts, parsed ${inserts.length} — the regex has drifted`);

  const unchecked = inserts
    .filter((m) => !m[1] || !/\berror\b/.test(m[1]))
    .map((m) => m[2]);
  assert.deepEqual(
    unchecked,
    [],
    `insert(s) whose returned error is discarded: ${unchecked.join(', ')}. `
    + 'supabase-js returns errors instead of throwing, so these fail silently.',
  );
});

test('every checked error is actually acted on', () => {
  // Destructuring the error and then ignoring it would pass the test above.
  const names = [...BODY.matchAll(/const \{[^}]*error:\s*(\w+)[^}]*\}/g)].map((m) => m[1]);
  assert.ok(names.length >= 5, `parsed only ${names.length} named errors`);
  for (const n of names) {
    assert.ok(
      new RegExp(`if\\s*\\(${n}\\)\\s*return fail\\(`).test(BODY),
      `${n} is destructured but never turned into a failure`,
    );
  }
});

test('the empty-row case is reported, not returned past', () => {
  assert.ok(
    /if \(!aRow\) return fail\(/.test(BODY),
    'an empty assessment row must be reported — `if (!aRow) return` skipped every '
    + 'dependent insert and told nobody',
  );
});

test('the save reports success explicitly', () => {
  assert.match(BODY, /return \{ ok: true \}/, 'the happy path must return a status the caller can check');
});

test('the bare console.warn swallow is gone', () => {
  assert.ok(
    !/console\.warn\(['"]Supabase save/.test(DASH),
    'the "Supabase save (non-fatal)" swallow is back — a lost assessment is not non-fatal',
  );
  assert.match(BODY, /console\.error\(/, 'failures should reach the console as errors');
});

test('silent data loss is reported to monitoring', () => {
  assert.match(BODY, /Sentry\?\.captureException/, 'a failed save should raise an alert, not just a console line');
  assert.match(BODY, /area: 'assessment_save'/, 'the Sentry event should be tagged so it can be alerted on');
});

test('monitoring can never break the save path', () => {
  // A throw from inside the error reporter would replace a reported failure
  // with an unreported one — the exact bug, one level up.
  // Slice to the end of `fail`, not to the first `try {` — the first `try` IS
  // the Sentry wrapper, so stopping there cuts off what we are checking for.
  const failStart = BODY.indexOf('const fail =');
  const failEnd = BODY.indexOf('return { ok: false', failStart);
  assert.ok(failStart > -1 && failEnd > failStart, 'could not locate the fail() helper');
  const failFn = BODY.slice(failStart, failEnd);
  assert.match(failFn, /try \{[\s\S]*catch/, 'the Sentry call must be wrapped so it cannot throw');
});

// ── the caller ─────────────────────────────────────────────────────
test('the caller awaits the save before reporting on it', () => {
  assert.match(
    DASH,
    /const saved = await _saveToSupabase\(/,
    'the save must be awaited — fire-and-forget means the success toast fires first',
  );
});

test('a failed save is surfaced to the coach', () => {
  const idx = DASH.indexOf('const saved = await _saveToSupabase(');
  const after = DASH.slice(idx, idx + 1600);
  assert.match(after, /if \(!saved\?\.ok\)/, 'the caller must branch on the save result');
  assert.match(after, /toast\(/, 'the failure must reach the coach, not just the console');
  assert.match(after, /'warning'/, 'reuse the existing warning toast rather than a new style');
  assert.ok(
    /Not saved/.test(after),
    'the message should say plainly that nothing was stored',
  );
});

test('a failed save does not claim the program was lost', () => {
  // The program is generated locally and stays valid and exportable; only the
  // save failed. Telling a coach their work is gone when it is on screen would
  // be its own kind of dishonesty.
  const idx = DASH.indexOf('const saved = await _saveToSupabase(');
  const after = DASH.slice(idx, idx + 1600);
  assert.ok(/still on screen/.test(after), 'the coach should be told the program survives');
});
