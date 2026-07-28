import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SYSTEM_RPC_BOUNDARY_CASES,
  SYSTEM_RPC_DENIED,
} from '../staging/system-rpc-boundaries.mjs';

test('system RPC boundary matrix covers anon and authenticated callers', () => {
  const combinations = SYSTEM_RPC_BOUNDARY_CASES
    .map(({ actor, rpc }) => `${actor}:${rpc}`)
    .sort();

  assert.deepEqual(combinations, [
    'admin:apply_paid_coach_package_period_system',
    'admin:expire_stale_workout_sessions_all',
    'anonymous:apply_paid_coach_package_period_system',
    'anonymous:expire_stale_workout_sessions_all',
  ]);
});

test('system RPC cases require function-level permission denial', () => {
  assert.match('permission denied for function example()', SYSTEM_RPC_DENIED);
  assert.doesNotMatch('invalid provider: invalid_acl_probe', SYSTEM_RPC_DENIED);
  assert.doesNotMatch('permission denied: not the assigned coach or admin', SYSTEM_RPC_DENIED);
});

test('paid-package probes use an invalid provider before any write path', () => {
  const paymentCases = SYSTEM_RPC_BOUNDARY_CASES.filter(
    ({ rpc }) => rpc === 'apply_paid_coach_package_period_system'
  );
  assert.equal(paymentCases.length, 2);
  for (const testCase of paymentCases) {
    assert.equal(testCase.args.p_provider, 'invalid_acl_probe');
  }
});

test('system RPC suite always resets fixtures after execution', () => {
  const source = readFileSync(
    new URL('../staging/system-rpc-boundaries.mjs', import.meta.url),
    'utf8'
  );
  assert.match(source, /await resetFixtures\(contract, serviceClient, env\)/);
  assert.match(source, /if \(caseFailure\) throw caseFailure/);
});
