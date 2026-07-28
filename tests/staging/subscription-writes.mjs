import { redactFixtureError } from './fixture-contract.mjs';
import { resolveFixtureUsers } from './service-client.mjs';
import { createAnonymousClient, signInFixture, signOutFixture } from './user-client.mjs';
import { resetFixtures } from './reset.mjs';

// Fixed dates keep every run byte-identical; the suite resets the baseline
// afterwards, so the chosen window never has to match "now".
const BASE_START = '2026-02-01';
const BASE_END = '2026-05-01';
const MISSING_SUBSCRIPTION_ID = '00000000-0000-4000-8000-000000000000';

export const RPC_BY_OPERATION = Object.freeze({
  create: 'create_client_subscription',
  update: 'update_client_subscription',
});

// Every denial asserts the specific server message. A bare "some error
// occurred" check would pass even when the RPC rejects for an unrelated
// reason -- including a typo in the arguments -- and would prove nothing.
export const DENIAL_REASONS = Object.freeze({
  notAuthorized: /not the assigned coach or admin/i,
  notAClient: /target is not a client account/i,
  notFound: /subscription not found/i,
  months: /months must be between 1 and 60/i,
  createStatus: /new subscription status must be active or pending/i,
  updateStatus: /status must be active, pending, or expired/i,
  expireAdminOnly: /only an admin may expire a subscription/i,
  endAfterStart: /end date must be after the start date/i,
  planName: /plan name must be 80 characters or fewer/i,
  notes: /notes must be 2000 characters or fewer/i,
  graceDays: /grace days must be between 0 and 60/i,
  anonBlocked: /permission denied for function/i,
});

export const ACTOR_FIXTURE_KEYS = Object.freeze([
  'admin',
  'coach',
  'activeClient',
  'unassignedClient',
]);

function createArgs(clientId, overrides = {}) {
  return {
    p_client_id: clientId,
    p_plan_name: 'AST9 E2E Access',
    p_months: 3,
    p_start: BASE_START,
    p_end: BASE_END,
    p_status: 'active',
    p_notes: null,
    ...overrides,
  };
}

function updateArgs(subscriptionId, overrides = {}) {
  return {
    p_subscription_id: subscriptionId,
    p_plan_name: 'AST9 E2E Access',
    p_months: 3,
    p_start: BASE_START,
    p_end: BASE_END,
    p_status: 'active',
    p_notes: null,
    p_grace_days: 7,
    ...overrides,
  };
}

// Ordered on purpose: cases that capture a subscription id must run before the
// cases that act on it. Order is data here, not prose, so a reordering that
// breaks a dependency fails the offline contract test rather than staging.
export const SUBSCRIPTION_WRITE_CASES = Object.freeze([
  {
    name: 'admin creates a subscription for an assigned client',
    actor: 'admin',
    operation: 'create',
    expect: 'allowed',
    captureAs: 'adminSubId',
    args: (ctx) => createArgs(ctx.users.activeClient.id),
  },
  {
    name: 'admin creates a subscription for an unassigned client',
    actor: 'admin',
    operation: 'create',
    expect: 'allowed',
    captureAs: 'unassignedSubId',
    args: (ctx) => createArgs(ctx.users.unassignedClient.id),
  },
  {
    name: 'assigned coach creates a subscription for their own client',
    actor: 'coach',
    operation: 'create',
    expect: 'allowed',
    captureAs: 'coachSubId',
    args: (ctx) => createArgs(ctx.users.activeClient.id),
  },
  {
    name: 'coach cannot create a subscription for an unassigned client',
    actor: 'coach',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.notAuthorized,
    args: (ctx) => createArgs(ctx.users.unassignedClient.id),
  },
  {
    name: 'client cannot create their own subscription',
    actor: 'activeClient',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.notAuthorized,
    args: (ctx) => createArgs(ctx.users.activeClient.id),
  },
  {
    name: 'unassigned client cannot self-provision access',
    actor: 'unassignedClient',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.notAuthorized,
    args: (ctx) => createArgs(ctx.users.unassignedClient.id),
  },
  {
    name: 'a coach profile is not a valid subscription target',
    actor: 'admin',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.notAClient,
    args: (ctx) => createArgs(ctx.users.coach.id),
  },
  {
    name: 'create rejects an expired status',
    actor: 'admin',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.createStatus,
    args: (ctx) => createArgs(ctx.users.activeClient.id, { p_status: 'expired' }),
  },
  {
    name: 'create rejects a cancelled status',
    actor: 'admin',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.createStatus,
    args: (ctx) => createArgs(ctx.users.activeClient.id, { p_status: 'cancelled' }),
  },
  {
    name: 'create rejects zero months',
    actor: 'admin',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.months,
    args: (ctx) => createArgs(ctx.users.activeClient.id, { p_months: 0 }),
  },
  {
    name: 'create rejects more than sixty months',
    actor: 'admin',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.months,
    args: (ctx) => createArgs(ctx.users.activeClient.id, { p_months: 61 }),
  },
  {
    name: 'create rejects an end date on or before the start date',
    actor: 'admin',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.endAfterStart,
    args: (ctx) =>
      createArgs(ctx.users.activeClient.id, {
        p_start: BASE_END,
        p_end: BASE_START,
      }),
  },
  {
    name: 'create rejects an over-long plan name',
    actor: 'admin',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.planName,
    args: (ctx) =>
      createArgs(ctx.users.activeClient.id, { p_plan_name: 'x'.repeat(81) }),
  },
  {
    name: 'create rejects over-long notes',
    actor: 'admin',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.notes,
    args: (ctx) =>
      createArgs(ctx.users.activeClient.id, { p_notes: 'x'.repeat(2001) }),
  },
  {
    name: 'assigned coach edits their own client subscription',
    actor: 'coach',
    operation: 'update',
    expect: 'allowed',
    args: (ctx) => updateArgs(ctx.captured.coachSubId, { p_months: 6 }),
  },
  {
    name: 'coach cannot edit an unassigned client subscription',
    actor: 'coach',
    operation: 'update',
    expect: 'denied',
    reason: DENIAL_REASONS.notAuthorized,
    args: (ctx) => updateArgs(ctx.captured.unassignedSubId),
  },
  {
    name: 'client cannot edit their own subscription',
    actor: 'activeClient',
    operation: 'update',
    expect: 'denied',
    reason: DENIAL_REASONS.notAuthorized,
    args: (ctx) => updateArgs(ctx.captured.adminSubId),
  },
  {
    name: 'coach cannot expire a subscription',
    actor: 'coach',
    operation: 'update',
    expect: 'denied',
    reason: DENIAL_REASONS.expireAdminOnly,
    args: (ctx) => updateArgs(ctx.captured.coachSubId, { p_status: 'expired' }),
  },
  {
    name: 'update rejects a cancelled status for every actor',
    actor: 'admin',
    operation: 'update',
    expect: 'denied',
    reason: DENIAL_REASONS.updateStatus,
    args: (ctx) => updateArgs(ctx.captured.adminSubId, { p_status: 'cancelled' }),
  },
  {
    name: 'update rejects out-of-range grace days',
    actor: 'admin',
    operation: 'update',
    expect: 'denied',
    reason: DENIAL_REASONS.graceDays,
    args: (ctx) => updateArgs(ctx.captured.adminSubId, { p_grace_days: 61 }),
  },
  {
    name: 'update rejects an unknown subscription id',
    actor: 'admin',
    operation: 'update',
    expect: 'denied',
    reason: DENIAL_REASONS.notFound,
    args: () => updateArgs(MISSING_SUBSCRIPTION_ID),
  },
  {
    name: 'admin may expire a subscription',
    actor: 'admin',
    operation: 'update',
    expect: 'allowed',
    args: (ctx) => updateArgs(ctx.captured.adminSubId, { p_status: 'expired' }),
  },
  {
    name: 'signed-out callers cannot reach the update RPC',
    actor: 'anonymous',
    operation: 'update',
    expect: 'denied',
    reason: DENIAL_REASONS.anonBlocked,
    args: (ctx) => updateArgs(ctx.captured.adminSubId),
  },
  {
    name: 'signed-out callers cannot reach the create RPC',
    actor: 'anonymous',
    operation: 'create',
    expect: 'denied',
    reason: DENIAL_REASONS.anonBlocked,
    args: (ctx) => createArgs(ctx.users.activeClient.id),
  },
]);

async function openSessions(contract, env) {
  const sessions = { anonymous: { client: createAnonymousClient(contract, env) } };
  for (const key of ACTOR_FIXTURE_KEYS) {
    sessions[key] = await signInFixture(contract, key, env);
  }
  return sessions;
}

async function closeSessions(sessions) {
  for (const [key, session] of Object.entries(sessions)) {
    if (key !== 'anonymous') await signOutFixture(session);
  }
}

function assertAllowed(testCase, data, error, contract, env) {
  if (error) {
    throw redactFixtureError(error, contract, env, `${testCase.name} (expected success)`);
  }
  if (!data) {
    throw new Error(`${testCase.name}: RPC returned no subscription id.`);
  }
}

function assertDenied(testCase, error, contract, env) {
  if (!error) {
    throw new Error(`${testCase.name}: expected a denial but the write succeeded.`);
  }
  if (!testCase.reason.test(error.message || '')) {
    throw redactFixtureError(
      new Error(
        `expected /${testCase.reason.source}/ but the server said: ${error.message}`
      ),
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

  const { data, error } = await session.client.rpc(
    RPC_BY_OPERATION[testCase.operation],
    testCase.args(context)
  );

  if (testCase.expect === 'allowed') {
    assertAllowed(testCase, data, error, contract, env);
    if (testCase.captureAs) context.captured[testCase.captureAs] = data;
  } else {
    assertDenied(testCase, error, contract, env);
  }

  return { name: testCase.name, outcome: testCase.expect };
}

export async function runSubscriptionWriteCases(contract, serviceClient, env = process.env) {
  const users = await resolveFixtureUsers(serviceClient, contract, env);
  const context = { users, captured: {} };
  const sessions = await openSessions(contract, env);

  try {
    const results = [];
    for (const testCase of SUBSCRIPTION_WRITE_CASES) {
      results.push(await executeCase(testCase, context, sessions, contract, env));
    }
    return results;
  } finally {
    await closeSessions(sessions);
  }
}

// The suite intentionally leaves extra subscription rows behind, so the baseline
// is always restored -- including after a failure -- or the next
// `staging:verify` would fail against state this suite created.
//
// A plain try/finally would let a reset failure replace the case failure that
// caused it, hiding the real defect behind a cleanup error. Both are reported.
export async function runSubscriptionWriteSuite(contract, serviceClient, env = process.env) {
  let caseFailure = null;
  let results = null;

  try {
    results = await runSubscriptionWriteCases(contract, serviceClient, env);
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
