import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRODUCTION_SUPABASE_REF,
} from '../smoke/staging-target.mjs';
import {
  SERVICE_ROLE_KEY,
  SEED_CONFIRM_KEY,
  assertMutationBoundary,
  buildScopedIdFilter,
  createFixtureContract,
  redactFixtureError,
} from '../staging/fixture-contract.mjs';

const safeEnv = {
  AST9_E2E_STAGING_SUPABASE_URL: 'https://stagingproject123.supabase.co',
  AST9_E2E_STAGING_SUPABASE_ANON_KEY: 'test-anon-key-with-safe-length',
  AST9_E2E_IDENTITY_MARKER: 'ast9e2e',
  AST9_E2E_ADMIN_EMAIL: 'admin+ast9e2e@example.test',
  AST9_E2E_ADMIN_PASSWORD: 'admin-password',
  AST9_E2E_COACH_EMAIL: 'coach+ast9e2e@example.test',
  AST9_E2E_COACH_PASSWORD: 'coach-password',
  AST9_E2E_CLIENT_EMAIL: 'client+ast9e2e@example.test',
  AST9_E2E_CLIENT_PASSWORD: 'client-password',
  AST9_E2E_INACTIVE_CLIENT_EMAIL: 'inactive+ast9e2e@example.test',
  AST9_E2E_INACTIVE_CLIENT_PASSWORD: 'inactive-password',
};

const mutationEnv = {
  ...safeEnv,
  [SERVICE_ROLE_KEY]: 'staging-service-role-key-safe-length',
  [SEED_CONFIRM_KEY]: 'stagingproject123',
};

test('validate builds the complete fixture contract without a service-role key', () => {
  const contract = createFixtureContract(safeEnv, 'validate');
  assert.deepEqual(
    contract.fixtures.map(({ key, role }) => ({ key, role })),
    [
      { key: 'admin', role: 'admin' },
      { key: 'coach', role: 'coach' },
      { key: 'activeClient', role: 'client' },
      { key: 'inactiveClient', role: 'client' },
    ]
  );
});

test('fixture validation rejects the production project', () => {
  assert.throws(
    () => createFixtureContract({
      ...safeEnv,
      AST9_E2E_STAGING_SUPABASE_URL:
        `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
    }),
    /production Supabase project/
  );
});

test('fixture marker must be at least six characters and in the local part', () => {
  assert.throws(
    () => createFixtureContract({
      ...safeEnv,
      AST9_E2E_IDENTITY_MARKER: 'test',
    }),
    /at least six/
  );
  assert.throws(
    () => createFixtureContract({
      ...safeEnv,
      AST9_E2E_ADMIN_EMAIL: 'admin@example-ast9e2e.test',
    }),
    /local part/
  );
});

test('fixture emails must be distinct', () => {
  assert.throws(
    () => createFixtureContract({
      ...safeEnv,
      AST9_E2E_COACH_EMAIL: safeEnv.AST9_E2E_ADMIN_EMAIL,
    }),
    /distinct synthetic email/
  );
});

test('service commands require a key and typed project confirmation', () => {
  assert.throws(
    () => createFixtureContract(safeEnv, 'seed'),
    new RegExp(SERVICE_ROLE_KEY)
  );
  assert.throws(
    () => createFixtureContract({
      ...safeEnv,
      [SERVICE_ROLE_KEY]: mutationEnv[SERVICE_ROLE_KEY],
    }, 'verify'),
    new RegExp(SEED_CONFIRM_KEY)
  );
  assert.doesNotThrow(() => createFixtureContract(mutationEnv, 'reset'));
});

test('mutation boundary independently rejects a production ref', () => {
  const contract = createFixtureContract(safeEnv);
  assert.throws(
    () => assertMutationBoundary({
      ...contract,
      config: {
        ...contract.config,
        projectRef: PRODUCTION_SUPABASE_REF,
        url: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
      },
    }, mutationEnv),
    /blocked from using the production/
  );
});

test('scoped fixture filters reject empty and invalid identifiers', () => {
  assert.throws(() => buildScopedIdFilter([]), /at least one UUID/);
  assert.throws(() => buildScopedIdFilter(['*']), /invalid UUID/);
  assert.throws(() => buildScopedIdFilter(['not-a-uuid']), /invalid UUID/);
});

test('scoped fixture filters contain only supplied UUIDs', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const filter = buildScopedIdFilter([first, second, first]);
  assert.deepEqual(filter, {
    operator: 'in',
    values: [first, second],
  });
});

test('redaction removes emails, passwords, anon keys, URLs, and service keys', () => {
  const contract = createFixtureContract(safeEnv);
  const raw = [
    safeEnv.AST9_E2E_ADMIN_EMAIL,
    safeEnv.AST9_E2E_ADMIN_PASSWORD,
    safeEnv.AST9_E2E_STAGING_SUPABASE_ANON_KEY,
    safeEnv.AST9_E2E_STAGING_SUPABASE_URL,
    mutationEnv[SERVICE_ROLE_KEY],
  ].join(' ');
  const redacted = redactFixtureError(new Error(raw), contract, mutationEnv, 'seed');

  for (const value of raw.split(' ')) {
    assert.doesNotMatch(redacted.message, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(redacted.message, /^seed failed:/);
});

test('seed and reset modules cannot bypass the scoped deletion helper', () => {
  for (const moduleName of ['seed.mjs', 'reset.mjs']) {
    const source = readFileSync(
      new URL(`../staging/${moduleName}`, import.meta.url),
      'utf8'
    );
    assert.doesNotMatch(source, /\.delete\s*\(/);
  }
});
