import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTOR_FIXTURE_KEYS,
  DENIAL_REASONS,
  RPC_BY_OPERATION,
  SUBSCRIPTION_WRITE_CASES,
} from '../staging/subscription-writes.mjs';
import { signInFixture } from '../staging/user-client.mjs';
import { createFixtureContract, SERVICE_ROLE_KEY, SEED_CONFIRM_KEY } from '../staging/fixture-contract.mjs';
import { PRODUCTION_SUPABASE_REF } from '../smoke/staging-target.mjs';

const STAGING_REF = 'stagingprojectref9999';

const safeEnv = {
  AST9_E2E_STAGING_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  AST9_E2E_STAGING_SUPABASE_ANON_KEY: 'anon-key-value-1234567890',
  AST9_E2E_IDENTITY_MARKER: 'ast9e2e',
  AST9_E2E_ADMIN_EMAIL: 'admin+ast9e2e@example.test',
  AST9_E2E_ADMIN_PASSWORD: 'admin-password',
  AST9_E2E_COACH_EMAIL: 'coach+ast9e2e@example.test',
  AST9_E2E_COACH_PASSWORD: 'coach-password',
  AST9_E2E_CLIENT_EMAIL: 'client+ast9e2e@example.test',
  AST9_E2E_CLIENT_PASSWORD: 'client-password',
  AST9_E2E_INACTIVE_CLIENT_EMAIL: 'inactive+ast9e2e@example.test',
  AST9_E2E_INACTIVE_CLIENT_PASSWORD: 'inactive-password',
  AST9_E2E_UNASSIGNED_CLIENT_EMAIL: 'unassigned+ast9e2e@example.test',
  AST9_E2E_UNASSIGNED_CLIENT_PASSWORD: 'unassigned-password',
};

const mutationEnv = {
  ...safeEnv,
  [SERVICE_ROLE_KEY]: 'service-role-key-1234567890',
  [SEED_CONFIRM_KEY]: STAGING_REF,
};

const FAKE_UUID = '99999999-9999-4999-8999-999999999999';

function syntheticUsers() {
  return Object.fromEntries(
    ['admin', 'coach', 'activeClient', 'inactiveClient', 'unassignedClient'].map(
      (key, index) => [key, { id: `0000000${index}-0000-4000-8000-000000000000` }]
    )
  );
}

// Records which captured ids a case reads, so ordering can be checked by
// execution rather than by where the text sits in the file.
function contextRecordingCaptureReads(available, reads) {
  return {
    users: syntheticUsers(),
    captured: new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== 'string') return undefined;
          reads.push(property);
          return available.has(property) ? FAKE_UUID : undefined;
        },
      }
    ),
  };
}

test('every case targets a real actor session and a real RPC', () => {
  const knownActors = new Set([...ACTOR_FIXTURE_KEYS, 'anonymous']);
  for (const testCase of SUBSCRIPTION_WRITE_CASES) {
    assert.ok(
      knownActors.has(testCase.actor),
      `case "${testCase.name}" uses an actor with no session: ${testCase.actor}`
    );
    assert.ok(
      RPC_BY_OPERATION[testCase.operation],
      `case "${testCase.name}" uses an unknown operation: ${testCase.operation}`
    );
  }
});

test('case names are unique so a failure identifies one case', () => {
  const names = SUBSCRIPTION_WRITE_CASES.map(({ name }) => name);
  assert.equal(new Set(names).size, names.length);
});

test('every denial asserts a specific server message, never a generic error', () => {
  const generic = 'something went wrong';
  for (const testCase of SUBSCRIPTION_WRITE_CASES) {
    if (testCase.expect !== 'denied') continue;
    assert.ok(
      testCase.reason instanceof RegExp,
      `case "${testCase.name}" must assert a specific denial reason`
    );
    assert.doesNotMatch(
      generic,
      testCase.reason,
      `case "${testCase.name}" would pass on an unrelated failure`
    );
  }
});

test('allowed cases never carry a denial reason', () => {
  for (const testCase of SUBSCRIPTION_WRITE_CASES) {
    if (testCase.expect === 'denied') continue;
    assert.equal(testCase.expect, 'allowed', `case "${testCase.name}" has an unknown expectation`);
    assert.equal(testCase.reason, undefined);
  }
});

test('no case reads a subscription id before the case that captures it', () => {
  const available = new Set();
  for (const testCase of SUBSCRIPTION_WRITE_CASES) {
    const reads = [];
    testCase.args(contextRecordingCaptureReads(available, reads));
    for (const key of reads) {
      assert.ok(
        available.has(key),
        `case "${testCase.name}" reads captured id "${key}" before any case captures it`
      );
    }
    if (testCase.captureAs) available.add(testCase.captureAs);
  }
});

test('captured ids are each produced by exactly one allowed case', () => {
  const captures = SUBSCRIPTION_WRITE_CASES.filter(({ captureAs }) => captureAs);
  for (const testCase of captures) {
    assert.equal(
      testCase.expect,
      'allowed',
      `case "${testCase.name}" captures an id but is expected to be denied`
    );
  }
  const keys = captures.map(({ captureAs }) => captureAs);
  assert.equal(new Set(keys).size, keys.length, 'captured ids must not be overwritten');
});

test('create cases send a client id and update cases send a subscription id', () => {
  const available = new Set(
    SUBSCRIPTION_WRITE_CASES.filter((c) => c.captureAs).map((c) => c.captureAs)
  );
  for (const testCase of SUBSCRIPTION_WRITE_CASES) {
    const args = testCase.args(contextRecordingCaptureReads(available, []));
    if (testCase.operation === 'create') {
      assert.ok(args.p_client_id, `case "${testCase.name}" is missing p_client_id`);
      assert.equal(args.p_subscription_id, undefined);
    } else {
      assert.ok(args.p_subscription_id, `case "${testCase.name}" is missing p_subscription_id`);
      assert.equal(args.p_client_id, undefined);
    }
  }
});

// Cross-artifact contract: the messages the suite asserts must be the messages
// the migration actually raises. Rewording an error in SQL without updating the
// suite would otherwise only surface on staging.
test('every denial reason matches a message the migration actually raises', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260710000000_client_subscription_management.sql', import.meta.url),
    'utf8'
  );
  const raised = [...migration.matchAll(/RAISE EXCEPTION '([^']+)'/g)].map((m) => m[1]);
  assert.ok(raised.length >= 10, 'expected the subscription RPCs to raise explicit errors');

  for (const [key, pattern] of Object.entries(DENIAL_REASONS)) {
    if (key === 'anonBlocked') continue; // Postgres privilege error, not raised in SQL
    assert.ok(
      raised.some((message) => pattern.test(message)),
      `DENIAL_REASONS.${key} matches no RAISE EXCEPTION in the migration`
    );
  }
});

test('both RPC names exist in the migration that defines them', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260710000000_client_subscription_management.sql', import.meta.url),
    'utf8'
  );
  for (const rpc of Object.values(RPC_BY_OPERATION)) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}\\b`));
  }
});

test('forward hardening denies anon RPC execution and preserves trusted grants', () => {
  const migration = readFileSync(
    new URL(
      '../../supabase/migrations/20260728000000_subscription_rpc_anon_execute_hardening.sql',
      import.meta.url
    ),
    'utf8'
  ).replace(/\s+/g, ' ');

  const signatures = [
    'create_client_subscription\\( uuid, text, integer, date, date, text, text \\)',
    'update_client_subscription\\( uuid, text, integer, date, date, text, text, integer \\)',
  ];

  for (const signature of signatures) {
    assert.match(
      migration,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature} FROM PUBLIC, anon;`, 'i')
    );
    assert.match(
      migration,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${signature} TO authenticated, service_role;`,
        'i'
      )
    );
  }
});

test('signed-out coverage exercises both subscription RPC execution boundaries', () => {
  const anonymousOperations = SUBSCRIPTION_WRITE_CASES
    .filter(({ actor }) => actor === 'anonymous')
    .map(({ operation }) => operation)
    .sort();

  assert.deepEqual(anonymousOperations, ['create', 'update']);
});

test('the coach-versus-unassigned denial is covered, since the fixture exists for it', () => {
  const covered = SUBSCRIPTION_WRITE_CASES.some(
    (testCase) =>
      testCase.actor === 'coach'
      && testCase.expect === 'denied'
      && testCase.reason === DENIAL_REASONS.notAuthorized
  );
  assert.ok(covered, 'the unassigned-client fixture must be exercised by a coach denial');
});

test('fixture sign-in is blocked from the production project before any request', async () => {
  const contract = createFixtureContract(safeEnv);
  const productionContract = {
    ...contract,
    config: {
      ...contract.config,
      projectRef: PRODUCTION_SUPABASE_REF,
      url: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
    },
  };
  await assert.rejects(
    () => signInFixture(productionContract, 'admin', mutationEnv),
    /blocked from using the production/
  );
});

test('fixture sign-in rejects an unknown fixture key', async () => {
  const contract = createFixtureContract(mutationEnv, 'authz-subscriptions');
  await assert.rejects(
    () => signInFixture(contract, 'notARealFixture', mutationEnv),
    /Unknown staging fixture key/
  );
});

test('authenticated fixture clients never use the service-role key', () => {
  const source = readFileSync(new URL('../staging/user-client.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getValidatedServiceRoleKey|SERVICE_ROLE_KEY/);
  assert.match(source, /contract\.config\.anonKey/);
});
