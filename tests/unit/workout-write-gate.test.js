import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RLS_DENIED,
  runWorkoutGateSuite,
  WORKOUT_GATE_ACTOR_KEYS,
  WORKOUT_GATE_CASES,
} from '../staging/workout-write-gate.mjs';

const MIGRATION = readFileSync(
  new URL(
    '../../supabase/migrations/20260728010000_workout_write_subscription_gate.sql',
    import.meta.url
  ),
  'utf8'
);
const FLAT = MIGRATION.replace(/\s+/g, ' ');
const GATED_TABLES = ['workout_sessions', 'workout_exercise_logs'];
const GATED_VERBS = ['INSERT', 'UPDATE', 'DELETE'];
const FAKE_UUID = '99999999-9999-4999-8999-999999999999';

function syntheticContext(available = new Set(), reads = []) {
  return {
    users: Object.fromEntries(
      ['admin', 'coach', 'activeClient', 'inactiveClient'].map((key, i) => [
        key,
        { id: `0000000${i}-0000-4000-8000-000000000000` },
      ])
    ),
    captured: new Proxy(
      {},
      {
        get(_t, property) {
          if (typeof property !== 'string') return undefined;
          reads.push(property);
          return available.has(property) ? FAKE_UUID : undefined;
        },
      }
    ),
  };
}

test('every case targets a known actor and a gated table', () => {
  const actors = new Set(WORKOUT_GATE_ACTOR_KEYS);
  for (const testCase of WORKOUT_GATE_CASES) {
    assert.ok(actors.has(testCase.actor), `unknown actor in "${testCase.name}"`);
    assert.ok(GATED_TABLES.includes(testCase.table), `ungated table in "${testCase.name}"`);
    assert.ok(['allowed', 'denied'].includes(testCase.expect), `bad expectation in "${testCase.name}"`);
  }
  const names = WORKOUT_GATE_CASES.map(({ name }) => name);
  assert.equal(new Set(names).size, names.length, 'case names must be unique');
});

test('the matrix proves both the block and that nothing else regressed', () => {
  const denied = WORKOUT_GATE_CASES.filter((c) => c.expect === 'denied');
  const allowed = WORKOUT_GATE_CASES.filter((c) => c.expect === 'allowed');

  // The block itself: a lapsed client refused on both gated tables.
  assert.deepEqual(
    denied.map((c) => c.table).sort(),
    ['workout_exercise_logs', 'workout_sessions']
  );
  assert.ok(denied.every((c) => c.actor === 'inactiveClient'));

  // Regression cover: an active client keeps write access, and staff writing
  // on behalf of a lapsed client is deliberately unaffected.
  assert.ok(allowed.some((c) => c.actor === 'activeClient' && c.table === 'workout_sessions'));
  assert.ok(allowed.some((c) => c.actor === 'activeClient' && c.table === 'workout_exercise_logs'));
  assert.ok(allowed.some((c) => c.actor === 'coach'));
  assert.ok(allowed.some((c) => c.actor === 'admin'));
});

test('the denial assertion is specific to row-level security', () => {
  assert.match('new row violates row-level security policy for table "workout_sessions"', RLS_DENIED);
  assert.doesNotMatch('something went wrong', RLS_DENIED);
  assert.doesNotMatch('permission denied for function foo()', RLS_DENIED);
  assert.doesNotMatch('null value in column "workout_key" violates not-null constraint', RLS_DENIED);
});

test('no case reads a captured session id before the case that captures it', () => {
  const available = new Set();
  for (const testCase of WORKOUT_GATE_CASES) {
    const reads = [];
    testCase.row(syntheticContext(available, reads));
    for (const key of reads) {
      assert.ok(available.has(key), `"${testCase.name}" reads "${key}" before it is captured`);
    }
    if (testCase.captureAs) available.add(testCase.captureAs);
  }
});

test('staff probes do not collide with the one-active-session-per-client index', () => {
  const context = syntheticContext();
  const coachCase = WORKOUT_GATE_CASES.find((c) => c.actor === 'coach');
  const adminCase = WORKOUT_GATE_CASES.find((c) => c.actor === 'admin');

  assert.equal(coachCase.row(context).status, 'active');
  assert.equal(adminCase.row(context).status, 'completed');
});

// Cross-artifact contract. The gate only works because the policies are
// RESTRICTIVE; a permissive policy would be OR'd with the existing
// ownership-only policy and would block nothing at all.
test('migration gates every write verb on both tables, restrictively', () => {
  for (const table of GATED_TABLES) {
    for (const verb of GATED_VERBS) {
      assert.match(
        FLAT,
        new RegExp(`ON public\\.${table} AS RESTRICTIVE FOR ${verb} TO authenticated`, 'i'),
        `${table} is not restrictively gated for ${verb}`
      );
    }
  }
});

test('migration never gates SELECT, so a lapsed client keeps view-only access', () => {
  assert.doesNotMatch(FLAT, /AS RESTRICTIVE FOR SELECT/i);
  assert.doesNotMatch(FLAT, /AS RESTRICTIVE FOR ALL/i);
});

test('migration hardens the helper against anon and is atomic', () => {
  assert.match(
    FLAT,
    /REVOKE ALL ON FUNCTION public\.client_has_write_access\(uuid\) FROM PUBLIC, anon;/i
  );
  assert.match(
    FLAT,
    /GRANT EXECUTE ON FUNCTION public\.client_has_write_access\(uuid\) TO authenticated, service_role;/i
  );
  assert.match(FLAT, /SECURITY DEFINER/);
  assert.match(FLAT, /effective_status IN \('active', 'grace'\)/);
  assert.match(MIGRATION, /^BEGIN;$/m);
  assert.match(MIGRATION, /^COMMIT;$/m);
});

test('a matching rollback exists and removes exactly what the migration adds', () => {
  const rollback = readFileSync(
    new URL(
      '../../supabase/rollbacks/20260728010000_workout_write_subscription_gate_down.sql',
      import.meta.url
    ),
    'utf8'
  ).replace(/\s+/g, ' ');

  for (const table of GATED_TABLES) {
    for (const verb of GATED_VERBS) {
      const suffix = verb.toLowerCase();
      const stem = table === 'workout_sessions' ? 'workout_sessions' : 'workout_logs';
      assert.match(
        rollback,
        new RegExp(`DROP POLICY IF EXISTS "${stem}_require_active_subscription_${suffix}"`, 'i')
      );
    }
  }
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.client_has_write_access\(uuid\)/i);
});

test('suite resets fixtures before and after a case failure and keeps the original error', async () => {
  let resetCalls = 0;
  await assert.rejects(
    () =>
      runWorkoutGateSuite({}, {}, {}, {
        runCases: async () => {
          throw new Error('gate case failed');
        },
        reset: async () => {
          resetCalls += 1;
        },
      }),
    /gate case failed/
  );
  assert.equal(resetCalls, 2);
});

test('suite reports both the case failure and a reset failure', async () => {
  let resetCalls = 0;
  await assert.rejects(
    () =>
      runWorkoutGateSuite({}, {}, {}, {
        runCases: async () => {
          throw new Error('gate case failed');
        },
        reset: async () => {
          resetCalls += 1;
          if (resetCalls === 2) throw new Error('fixture reset failed');
        },
      }),
    /gate case failed[\s\S]*fixture reset failed/
  );
});

test('suite refuses to run cases when the initial reset fails', async () => {
  let caseCalls = 0;
  await assert.rejects(
    () =>
      runWorkoutGateSuite({}, {}, {}, {
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
