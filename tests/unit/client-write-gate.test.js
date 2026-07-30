import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLIENT_WRITE_ACTOR_KEYS,
  CLIENT_WRITE_CASES,
  RLS_DENIED,
  runClientWriteSuite,
} from '../staging/client-write-gate.mjs';

const GATED_TABLES = [
  'daily_routine_logs',
  'phase_submissions',
  'subjective_assessments',
  'exercise_alternative_requests',
  'progress_logs',
  'client_questions',
  'workout_logs',
];
const WRITE_VERBS = ['INSERT', 'UPDATE', 'DELETE'];
const MANIFEST = JSON.parse(
  readFileSync(
    new URL('../client-write-gate.expectations.json', import.meta.url),
    'utf8'
  )
);

test('every case names a known actor, gated table, verb, and expectation', () => {
  const actors = new Set(CLIENT_WRITE_ACTOR_KEYS);
  for (const testCase of CLIENT_WRITE_CASES) {
    assert.ok(actors.has(testCase.actor), `unknown actor in "${testCase.name}"`);
    assert.ok(
      ['activeClient', 'inactiveClient'].includes(testCase.owner),
      `unknown row owner in "${testCase.name}"`
    );
    assert.ok(GATED_TABLES.includes(testCase.table), `ungated table in "${testCase.name}"`);
    assert.ok(
      [...WRITE_VERBS, 'SELECT'].includes(testCase.verb),
      `unknown verb in "${testCase.name}"`
    );
    assert.ok(
      ['allowed', 'denied'].includes(testCase.expect),
      `bad expectation in "${testCase.name}"`
    );
  }
});

test('case names are unique', () => {
  const names = CLIENT_WRITE_CASES.map(({ name }) => name);
  assert.equal(new Set(names).size, names.length, 'case names must be unique');
});

test('every table denies at least one inactive-client write', () => {
  for (const table of GATED_TABLES) {
    assert.ok(
      CLIENT_WRITE_CASES.some(
        (testCase) =>
          testCase.table === table &&
          testCase.actor === 'inactiveClient' &&
          testCase.owner === 'inactiveClient' &&
          WRITE_VERBS.includes(testCase.verb) &&
          testCase.expect === 'denied'
      ),
      `${table} has no inactive-client denial`
    );
  }
});

test('every table preserves active-client and staff writes', () => {
  for (const table of GATED_TABLES) {
    assert.ok(
      CLIENT_WRITE_CASES.some(
        (testCase) =>
          testCase.table === table &&
          testCase.actor === 'activeClient' &&
          testCase.owner === 'activeClient' &&
          WRITE_VERBS.includes(testCase.verb) &&
          testCase.expect === 'allowed'
      ),
      `${table} has no active-client write cover`
    );
    assert.ok(
      CLIENT_WRITE_CASES.some(
        (testCase) =>
          testCase.table === table &&
          ['coach', 'admin'].includes(testCase.actor) &&
          testCase.owner === 'inactiveClient' &&
          WRITE_VERBS.includes(testCase.verb) &&
          testCase.expect === 'allowed'
      ),
      `${table} has no staff write cover`
    );
  }
});

test('every table explicitly preserves lapsed-client SELECT', () => {
  for (const table of GATED_TABLES) {
    assert.ok(
      CLIENT_WRITE_CASES.some(
        (testCase) =>
          testCase.table === table &&
          testCase.actor === 'inactiveClient' &&
          testCase.owner === 'inactiveClient' &&
          testCase.verb === 'SELECT' &&
          testCase.expect === 'allowed'
      ),
      `${table} has no explicit lapsed-client read assertion`
    );
  }
});

test('denial regex accepts only the specific row-level-security message', () => {
  assert.match(
    'new row violates row-level security policy for table "daily_routine_logs"',
    RLS_DENIED
  );
  assert.doesNotMatch(
    'null value in column "client_id" violates not-null constraint',
    RLS_DENIED
  );
  assert.doesNotMatch('permission denied for function client_has_write_access', RLS_DENIED);
  assert.doesNotMatch('something went wrong', RLS_DENIED);
});

test('UPDATE and DELETE denial probes target service-seeded rows', () => {
  for (const testCase of CLIENT_WRITE_CASES.filter(
    ({ expect, verb }) => expect === 'denied' && ['UPDATE', 'DELETE'].includes(verb)
  )) {
    assert.equal(
      typeof testCase.targetId,
      'function',
      `${testCase.name} has no service-seeded target`
    );
  }
});

test('expectation manifest covers the exact table and verb contract', () => {
  assert.deepEqual(
    MANIFEST.tables.map(({ table }) => table),
    GATED_TABLES
  );
  for (const entry of MANIFEST.tables) {
    assert.deepEqual(entry.gatedVerbs, WRITE_VERBS);
    assert.deepEqual(entry.allowedWriters, [
      'active-or-grace owning client',
      'coach',
      'admin',
    ]);
    assert.equal(entry.selectGated, false);
    assert.equal(entry.lapsedClientCanSelectOwnRows, true);
  }
});

test('suite resets fixtures before and after a case failure and keeps the original error', async () => {
  let resetCalls = 0;
  await assert.rejects(
    () =>
      runClientWriteSuite({}, {}, {}, {
        runCases: async () => {
          throw new Error('client write case failed');
        },
        reset: async () => {
          resetCalls += 1;
        },
      }),
    /client write case failed/
  );
  assert.equal(resetCalls, 2);
});

test('suite reports both the case failure and a reset failure', async () => {
  let resetCalls = 0;
  await assert.rejects(
    () =>
      runClientWriteSuite({}, {}, {}, {
        runCases: async () => {
          throw new Error('client write case failed');
        },
        reset: async () => {
          resetCalls += 1;
          if (resetCalls === 2) throw new Error('fixture reset failed');
        },
      }),
    /client write case failed[\s\S]*fixture reset failed/
  );
});

test('suite refuses to run cases when the initial reset fails', async () => {
  let caseCalls = 0;
  await assert.rejects(
    () =>
      runClientWriteSuite({}, {}, {}, {
        runCases: async () => {
          caseCalls += 1;
        },
        reset: async () => {
          throw new Error('initial fixture reset failed');
        },
      }),
    /initial fixture reset failed/
  );
  assert.equal(caseCalls, 0);
});
