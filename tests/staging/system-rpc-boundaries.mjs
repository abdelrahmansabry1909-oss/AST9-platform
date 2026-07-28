import { redactFixtureError } from './fixture-contract.mjs';
import { resetFixtures } from './reset.mjs';
import {
  createAnonymousClient,
  signInFixture,
  signOutFixture,
} from './user-client.mjs';

export const SYSTEM_RPC_DENIED = /permission denied for function/i;

const INVALID_PAYMENT_ARGS = Object.freeze({
  p_provider: 'invalid_acl_probe',
  p_provider_event_id: 'acl-probe',
  p_coach_id: '00000000-0000-4000-8000-000000000000',
  p_package_key: 'free',
  p_client_limit: 1,
  p_period_start: '2000-01-01T00:00:00.000Z',
  p_period_end: '2000-01-02T00:00:00.000Z',
});

export const SYSTEM_RPC_BOUNDARY_CASES = Object.freeze([
  {
    name: 'signed-out callers cannot reach the paid-package system RPC',
    actor: 'anonymous',
    rpc: 'apply_paid_coach_package_period_system',
    args: INVALID_PAYMENT_ARGS,
  },
  {
    name: 'authenticated callers cannot reach the paid-package system RPC',
    actor: 'admin',
    rpc: 'apply_paid_coach_package_period_system',
    args: INVALID_PAYMENT_ARGS,
  },
  {
    name: 'signed-out callers cannot reach the global workout-expiry RPC',
    actor: 'anonymous',
    rpc: 'expire_stale_workout_sessions_all',
    args: {},
  },
  {
    name: 'authenticated callers cannot reach the global workout-expiry RPC',
    actor: 'admin',
    rpc: 'expire_stale_workout_sessions_all',
    args: {},
  },
]);

async function assertDenied(testCase, client, contract, env) {
  const { error } = await client.rpc(testCase.rpc, testCase.args);
  if (!error) {
    throw new Error(`${testCase.name}: expected a denial but the RPC executed.`);
  }
  if (!SYSTEM_RPC_DENIED.test(error.message || '')) {
    throw redactFixtureError(
      new Error(
        `expected /${SYSTEM_RPC_DENIED.source}/ but the server said: ${error.message}`
      ),
      contract,
      env,
      testCase.name
    );
  }
  return { name: testCase.name, outcome: 'denied' };
}

export async function runSystemRpcBoundaryCases(contract, env = process.env) {
  const sessions = {
    anonymous: { client: createAnonymousClient(contract, env) },
    admin: await signInFixture(contract, 'admin', env),
  };

  try {
    const results = [];
    for (const testCase of SYSTEM_RPC_BOUNDARY_CASES) {
      results.push(
        await assertDenied(testCase, sessions[testCase.actor].client, contract, env)
      );
    }
    return results;
  } finally {
    await signOutFixture(sessions.admin);
  }
}

export async function runSystemRpcBoundarySuite(
  contract,
  serviceClient,
  env = process.env
) {
  let caseFailure = null;
  let results = null;

  try {
    results = await runSystemRpcBoundaryCases(contract, env);
  } catch (error) {
    caseFailure = error;
  }

  try {
    await resetFixtures(contract, serviceClient, env);
  } catch (resetFailure) {
    if (!caseFailure) throw resetFailure;
    throw new Error(
      `${caseFailure.message}\n  the staging reset that followed also failed: ${resetFailure.message}`
    );
  }

  if (caseFailure) throw caseFailure;
  return results;
}
