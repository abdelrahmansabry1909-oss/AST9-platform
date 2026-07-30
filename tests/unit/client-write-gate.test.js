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
const MIGRATION_VERSION = '20260730000000';
const MIGRATION_FILENAME = `${MIGRATION_VERSION}_client_write_subscription_gate.sql`;
const ROLLBACK_FILENAME = `${MIGRATION_VERSION}_client_write_subscription_gate_down.sql`;
const MIGRATION_SQL = readFileSync(
  new URL(`../../supabase/migrations/${MIGRATION_FILENAME}`, import.meta.url),
  'utf8'
);
const ROLLBACK_SQL = readFileSync(
  new URL(`../../supabase/rollbacks/${ROLLBACK_FILENAME}`, import.meta.url),
  'utf8'
);
const POLICY_PREDICATE =
  'client_id IS DISTINCT FROM (SELECT auth.uid()) OR ' +
  '(SELECT public.client_has_write_access((SELECT auth.uid())))';
const MANIFEST = JSON.parse(
  readFileSync(
    new URL('../client-write-gate.expectations.json', import.meta.url),
    'utf8'
  )
);

function normalizedSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function migrationPolicyBlocks() {
  return [...MIGRATION_SQL.matchAll(/CREATE POLICY "([^"]+)"([\s\S]*?);/g)].map(
    ([, name, sql]) => ({ name, sql: normalizedSql(sql) })
  );
}

function expectedPolicyNames() {
  return GATED_TABLES.flatMap((table) =>
    WRITE_VERBS.map((verb) => `${table}_require_active_subscription_${verb.toLowerCase()}`)
  );
}

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

test('migration and rollback versions and filenames match', () => {
  assert.match(MIGRATION_FILENAME, new RegExp(`^${MIGRATION_VERSION}_.+\\.sql$`));
  assert.equal(
    ROLLBACK_FILENAME,
    MIGRATION_FILENAME.replace(/\.sql$/, '_down.sql')
  );
  assert.match(ROLLBACK_SQL, new RegExp(`Reverses ${MIGRATION_FILENAME.replace('.', '\\.')}`));
});

test('migration creates the exact seven-table by three-verb policy matrix', () => {
  const blocks = migrationPolicyBlocks();
  assert.equal(blocks.length, 21);
  assert.deepEqual(
    blocks.map(({ name }) => name).sort(),
    expectedPolicyNames().sort()
  );

  for (const table of GATED_TABLES) {
    for (const verb of WRITE_VERBS) {
      const name = `${table}_require_active_subscription_${verb.toLowerCase()}`;
      const block = blocks.find((policy) => policy.name === name);
      assert.ok(block, `missing ${name}`);
      assert.match(
        block.sql,
        new RegExp(
          `^ON public\\.${table} AS RESTRICTIVE FOR ${verb} TO authenticated `
        ),
        `${name} must be RESTRICTIVE and authenticated-only`
      );
    }
  }
});

test('every migration policy has the exact null-safe predicate and verb clauses', () => {
  for (const { name, sql } of migrationPolicyBlocks()) {
    const verb = name.slice(name.lastIndexOf('_') + 1).toUpperCase();
    const predicateCount = sql.split(POLICY_PREDICATE).length - 1;
    assert.equal(
      predicateCount,
      verb === 'UPDATE' ? 2 : 1,
      `${name} predicate count`
    );

    if (verb === 'INSERT') {
      assert.match(sql, / WITH CHECK \(/);
      assert.doesNotMatch(sql, / USING \(/);
    } else if (verb === 'UPDATE') {
      assert.match(sql, / USING \(/);
      assert.match(sql, / WITH CHECK \(/);
    } else {
      assert.match(sql, / USING \(/);
      assert.doesNotMatch(sql, / WITH CHECK \(/);
    }
  }

  assert.doesNotMatch(MIGRATION_SQL, /client_id\s*<>/i);
});

test('migration never gates reads or changes database functions', () => {
  assert.doesNotMatch(MIGRATION_SQL, /\bFOR\s+SELECT\b/i);
  assert.doesNotMatch(
    MIGRATION_SQL,
    /\b(?:CREATE(?:\s+OR\s+REPLACE)?|DROP|ALTER)\s+FUNCTION\b/i
  );
  assert.doesNotMatch(MIGRATION_SQL, /\bAS\s+PERMISSIVE\b/i);
});

test('rollback drops exactly the 21 added policies and preserves the shared helper', () => {
  const drops = [
    ...ROLLBACK_SQL.matchAll(
      /DROP POLICY IF EXISTS "([^"]+)" ON public\.([a-z_]+);/g
    ),
  ].map(([, name, table]) => ({ name, table }));

  assert.equal(drops.length, 21);
  assert.deepEqual(
    drops.map(({ name }) => name).sort(),
    expectedPolicyNames().sort()
  );
  for (const { name, table } of drops) {
    assert.ok(name.startsWith(`${table}_`), `${name} is dropped from the wrong table`);
  }
  assert.doesNotMatch(ROLLBACK_SQL, /\bDROP\s+FUNCTION\b/i);
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
