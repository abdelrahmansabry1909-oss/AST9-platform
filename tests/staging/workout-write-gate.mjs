import { redactFixtureError } from './fixture-contract.mjs';
import { resolveFixtureUsers } from './service-client.mjs';
import { signInFixture, signOutFixture } from './user-client.mjs';
import { resetFixtures } from './reset.mjs';

// PostgREST surfaces an RLS refusal as a 42501 row-level-security error. The
// suite asserts that exact wording so a case cannot pass on a constraint
// violation, a bad payload, or a missing column.
export const RLS_DENIED = /violates row-level security policy/i;

export const WORKOUT_GATE_ACTOR_KEYS = Object.freeze([
  'admin',
  'coach',
  'activeClient',
  'inactiveClient',
]);

function sessionRow(clientId, overrides = {}) {
  return {
    client_id: clientId,
    workout_key: 'ast9-e2e-gate-probe',
    workout_label: 'AST9 E2E Gate Probe',
    status: 'active',
    ...overrides,
  };
}

function logRow(sessionId) {
  return {
    session_id: sessionId,
    exercise_index: 0,
    exercise_name: 'AST9 E2E Gate Probe',
    sets: [],
  };
}

// Ordered: cases that capture a session id must precede the cases using it.
export const WORKOUT_GATE_CASES = Object.freeze([
  {
    name: 'active client can start their own workout session',
    actor: 'activeClient',
    table: 'workout_sessions',
    expect: 'allowed',
    captureAs: 'activeSessionId',
    row: (ctx) => sessionRow(ctx.users.activeClient.id),
  },
  {
    name: 'active client can log an exercise in their own session',
    actor: 'activeClient',
    table: 'workout_exercise_logs',
    expect: 'allowed',
    row: (ctx) => logRow(ctx.captured.activeSessionId),
  },
  {
    name: 'coach can still log a session for a lapsed client',
    actor: 'coach',
    table: 'workout_sessions',
    expect: 'allowed',
    captureAs: 'lapsedSessionId',
    row: (ctx) =>
      sessionRow(ctx.users.inactiveClient.id, { coach_id: ctx.users.coach.id }),
  },
  {
    name: 'admin can still log a session for a lapsed client',
    actor: 'admin',
    table: 'workout_sessions',
    expect: 'allowed',
    // The coach case already creates the fixture client's one permitted active
    // session. Use a completed row here so this authorization probe does not
    // fail on workout_sessions_one_active_uidx before it proves admin access.
    row: (ctx) => sessionRow(ctx.users.inactiveClient.id, { status: 'completed' }),
  },
  {
    name: 'lapsed client cannot start a workout session',
    actor: 'inactiveClient',
    table: 'workout_sessions',
    expect: 'denied',
    row: (ctx) => sessionRow(ctx.users.inactiveClient.id),
  },
  {
    name: 'lapsed client cannot log into a session created for them',
    actor: 'inactiveClient',
    table: 'workout_exercise_logs',
    expect: 'denied',
    row: (ctx) => logRow(ctx.captured.lapsedSessionId),
  },
]);

// Read access must survive the gate: the locked rule is view-only, not
// no-access, for a lapsed client.
async function assertLapsedClientCanStillRead(sessions, contract, env) {
  const { data, error } = await sessions.inactiveClient.client
    .from('workout_sessions')
    .select('id')
    .limit(1);
  if (error) {
    throw redactFixtureError(
      error,
      contract,
      env,
      'lapsed client lost read access to their own workout history'
    );
  }
  if (!Array.isArray(data)) {
    throw new Error('lapsed client read returned no result set.');
  }
  return { name: 'lapsed client keeps read access to their own history', outcome: 'allowed' };
}

function assertAllowed(testCase, data, error, contract, env) {
  if (error) {
    throw redactFixtureError(error, contract, env, `${testCase.name} (expected success)`);
  }
  if (!data?.id) {
    throw new Error(`${testCase.name}: insert returned no row id.`);
  }
}

function assertDenied(testCase, error, contract, env) {
  if (!error) {
    throw new Error(`${testCase.name}: expected a denial but the write succeeded.`);
  }
  if (!RLS_DENIED.test(error.message || '')) {
    throw redactFixtureError(
      new Error(`expected /${RLS_DENIED.source}/ but the server said: ${error.message}`),
      contract,
      env,
      testCase.name
    );
  }
}

async function executeCase(testCase, context, sessions, contract, env) {
  const session = sessions[testCase.actor];
  if (!session) {
    throw new Error(`${testCase.name}: no session for actor ${testCase.actor}.`);
  }

  const { data, error } = await session.client
    .from(testCase.table)
    .insert(testCase.row(context))
    .select('id')
    .maybeSingle();

  if (testCase.expect === 'allowed') {
    assertAllowed(testCase, data, error, contract, env);
    if (testCase.captureAs) context.captured[testCase.captureAs] = data.id;
  } else {
    assertDenied(testCase, error, contract, env);
  }

  return { name: testCase.name, outcome: testCase.expect };
}

export async function runWorkoutGateCases(contract, serviceClient, env = process.env) {
  const users = await resolveFixtureUsers(serviceClient, contract, env);
  const context = { users, captured: {} };
  const sessions = {};
  for (const key of WORKOUT_GATE_ACTOR_KEYS) {
    sessions[key] = await signInFixture(contract, key, env);
  }

  try {
    const results = [];
    for (const testCase of WORKOUT_GATE_CASES) {
      results.push(await executeCase(testCase, context, sessions, contract, env));
    }
    results.push(await assertLapsedClientCanStillRead(sessions, contract, env));
    return results;
  } finally {
    for (const session of Object.values(sessions)) await signOutFixture(session);
  }
}

// Every case writes real rows. Reset before the matrix so an interrupted prior
// run cannot poison this run, then reset again afterwards. A trailing reset
// failure must never replace the case failure that caused it.
export async function runWorkoutGateSuite(
  contract,
  serviceClient,
  env = process.env,
  dependencies = {}
) {
  const runCases = dependencies.runCases ?? runWorkoutGateCases;
  const reset = dependencies.reset ?? resetFixtures;
  let caseFailure = null;
  let results = null;

  await reset(contract, serviceClient, env);

  try {
    results = await runCases(contract, serviceClient, env);
  } catch (error) {
    caseFailure = error;
  }

  try {
    await reset(contract, serviceClient, env);
  } catch (resetFailure) {
    if (!caseFailure) throw resetFailure;
    throw new Error(
      `${caseFailure.message}\n  the staging reset that followed also failed: ${resetFailure.message}`
    );
  }

  if (caseFailure) throw caseFailure;
  return results;
}
