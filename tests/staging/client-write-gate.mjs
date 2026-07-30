import { redactFixtureError } from './fixture-contract.mjs';
import { requireResult, resolveFixtureUsers } from './service-client.mjs';
import { signInFixture, signOutFixture } from './user-client.mjs';
import { resetFixtures } from './reset.mjs';

// PostgREST surfaces an INSERT blocked by RLS as this specific 42501 message.
// UPDATE and DELETE may instead be silently filtered to zero rows by USING.
export const RLS_DENIED = /violates row-level security policy/i;

export const CLIENT_WRITE_ACTOR_KEYS = Object.freeze([
  'admin',
  'coach',
  'activeClient',
  'inactiveClient',
]);

const PROBE = 'AST9 E2E Client Write Gate Probe';

const rows = Object.freeze({
  daily_routine_logs: (ctx, suffix) => ({
    client_id: ctx.clientId,
    log_date: suffix,
    completed: false,
    battery_pct: 51,
  }),
  phase_submissions: (ctx, suffix) => ({
    client_id: ctx.clientId,
    graph_id: ctx.inactive
      ? ctx.captured.inactiveGraphId
      : ctx.captured.activeGraphId,
    phase_id: ctx.inactive
      ? ctx.captured.inactivePhaseId
      : ctx.captured.activePhaseId,
    client_note: `${PROBE} ${suffix}`,
    status: 'pending',
  }),
  subjective_assessments: (ctx, suffix) => ({
    client_id: ctx.clientId,
    coach_id: ctx.users.coach.id,
    mode: 'free_form',
    status: 'draft',
    free_form_notes: `${PROBE} ${suffix}`,
  }),
  exercise_alternative_requests: (ctx, suffix) => ({
    client_id: ctx.clientId,
    coach_id: ctx.users.coach.id,
    workout_key: 'ast9-e2e-client-write-gate',
    exercise_index: 0,
    exercise_name: PROBE,
    reason: `${PROBE} ${suffix}`,
    status: 'pending',
  }),
  progress_logs: (ctx, suffix) => ({
    client_id: ctx.clientId,
    overall_pain_scale: 3,
    rpe: 4,
    client_feedback: `${PROBE} ${suffix}`,
    battery_contribution: 1,
  }),
  client_questions: (ctx, suffix) => ({
    client_id: ctx.clientId,
    title: `${PROBE} ${suffix}`,
    content: `${PROBE} content`,
    category: 'exercise',
    is_public: false,
    status: 'open',
  }),
  workout_logs: (ctx, suffix) => ({
    client_id: ctx.clientId,
    weight_used: 1,
    reps_completed: '1',
    sets_completed: 1,
    completed: false,
    feedback: `${PROBE} ${suffix}`,
  }),
});

function rowContext(ctx, actorKey) {
  return {
    ...ctx,
    clientId: ctx.users[actorKey].id,
    inactive: actorKey === 'inactiveClient',
  };
}

function insertCase(name, actor, table, expect, suffix) {
  const owner = actor === 'activeClient' ? 'activeClient' : 'inactiveClient';
  return {
    name,
    actor,
    owner,
    table,
    verb: 'INSERT',
    expect,
    row: (ctx) => rows[table](rowContext(ctx, owner), suffix),
  };
}

function targetCase(name, actor, table, verb, expect, captureKey, changes) {
  return {
    name,
    actor,
    owner: 'inactiveClient',
    table,
    verb,
    expect,
    targetId: (ctx) => ctx.captured[captureKey],
    ...(changes ? { changes } : {}),
  };
}

// DELETE is deliberately omitted for exercise_alternative_requests and
// client_questions. Their current client policies do not authorize DELETE, so a
// denial would remain green even if the subscription gate were absent.
export const CLIENT_WRITE_CASES = Object.freeze([
  insertCase(
    'active client can insert their own daily routine log',
    'activeClient', 'daily_routine_logs', 'allowed', '2099-01-01'
  ),
  insertCase(
    'coach can insert a daily routine log for a lapsed client',
    'coach', 'daily_routine_logs', 'allowed', '2099-01-02'
  ),
  insertCase(
    'lapsed client cannot insert their own daily routine log',
    'inactiveClient', 'daily_routine_logs', 'denied', '2099-01-03'
  ),
  targetCase(
    'lapsed client cannot update their own daily routine log',
    'inactiveClient', 'daily_routine_logs', 'UPDATE', 'denied',
    'dailyUpdateId', { battery_pct: 52 }
  ),
  targetCase(
    'lapsed client cannot delete their own daily routine log',
    'inactiveClient', 'daily_routine_logs', 'DELETE', 'denied', 'dailyDeleteId'
  ),
  targetCase(
    'lapsed client can read their own daily routine log',
    'inactiveClient', 'daily_routine_logs', 'SELECT', 'allowed', 'dailyReadId'
  ),

  insertCase(
    'active client can insert their own phase submission',
    'activeClient', 'phase_submissions', 'allowed', 'active insert'
  ),
  insertCase(
    'coach can insert a phase submission for a lapsed client',
    'coach', 'phase_submissions', 'allowed', 'coach insert'
  ),
  insertCase(
    'lapsed client cannot insert their own phase submission',
    'inactiveClient', 'phase_submissions', 'denied', 'lapsed insert'
  ),
  targetCase(
    'lapsed client cannot update their own phase submission',
    'inactiveClient', 'phase_submissions', 'UPDATE', 'denied',
    'phaseSubmissionUpdateId', { client_note: `${PROBE} blocked update` }
  ),
  targetCase(
    'lapsed client cannot delete their own phase submission',
    'inactiveClient', 'phase_submissions', 'DELETE', 'denied',
    'phaseSubmissionDeleteId'
  ),
  targetCase(
    'lapsed client can read their own phase submission',
    'inactiveClient', 'phase_submissions', 'SELECT', 'allowed',
    'phaseSubmissionReadId'
  ),

  insertCase(
    'active client can insert their own subjective assessment',
    'activeClient', 'subjective_assessments', 'allowed', 'active insert'
  ),
  insertCase(
    'coach can insert a subjective assessment for a lapsed client',
    'coach', 'subjective_assessments', 'allowed', 'coach insert'
  ),
  insertCase(
    'lapsed client cannot insert their own subjective assessment',
    'inactiveClient', 'subjective_assessments', 'denied', 'lapsed insert'
  ),
  targetCase(
    'lapsed client cannot update their own subjective assessment',
    'inactiveClient', 'subjective_assessments', 'UPDATE', 'denied',
    'subjectiveUpdateId', { free_form_notes: `${PROBE} blocked update` }
  ),
  targetCase(
    'lapsed client cannot delete their own subjective assessment',
    'inactiveClient', 'subjective_assessments', 'DELETE', 'denied',
    'subjectiveDeleteId'
  ),
  targetCase(
    'lapsed client can read their own subjective assessment',
    'inactiveClient', 'subjective_assessments', 'SELECT', 'allowed',
    'subjectiveReadId'
  ),

  insertCase(
    'active client can insert their own exercise alternative request',
    'activeClient', 'exercise_alternative_requests', 'allowed', 'active insert'
  ),
  targetCase(
    'coach can update an exercise alternative request for a lapsed client',
    'coach', 'exercise_alternative_requests', 'UPDATE', 'allowed',
    'alternativeStaffUpdateId',
    { status: 'addressed', coach_response: `${PROBE} coach response` }
  ),
  insertCase(
    'lapsed client cannot insert their own exercise alternative request',
    'inactiveClient', 'exercise_alternative_requests', 'denied', 'lapsed insert'
  ),
  targetCase(
    'lapsed client cannot update their own exercise alternative request',
    'inactiveClient', 'exercise_alternative_requests', 'UPDATE', 'denied',
    'alternativeClientUpdateId', { reason: `${PROBE} blocked update` }
  ),
  targetCase(
    'lapsed client can read their own exercise alternative request',
    'inactiveClient', 'exercise_alternative_requests', 'SELECT', 'allowed',
    'alternativeReadId'
  ),

  insertCase(
    'active client can insert their own progress log',
    'activeClient', 'progress_logs', 'allowed', 'active insert'
  ),
  insertCase(
    'admin can insert a progress log for a lapsed client',
    'admin', 'progress_logs', 'allowed', 'admin insert'
  ),
  insertCase(
    'lapsed client cannot insert their own progress log',
    'inactiveClient', 'progress_logs', 'denied', 'lapsed insert'
  ),
  targetCase(
    'lapsed client cannot update their own progress log',
    'inactiveClient', 'progress_logs', 'UPDATE', 'denied',
    'progressUpdateId', { client_feedback: `${PROBE} blocked update` }
  ),
  targetCase(
    'lapsed client cannot delete their own progress log',
    'inactiveClient', 'progress_logs', 'DELETE', 'denied', 'progressDeleteId'
  ),
  targetCase(
    'lapsed client can read their own progress log',
    'inactiveClient', 'progress_logs', 'SELECT', 'allowed', 'progressReadId'
  ),

  insertCase(
    'active client can insert their own question',
    'activeClient', 'client_questions', 'allowed', 'active insert'
  ),
  targetCase(
    'coach can update a question for a lapsed client',
    'coach', 'client_questions', 'UPDATE', 'allowed', 'questionStaffUpdateId',
    (ctx) => ({
      status: 'answered',
      answer: `${PROBE} coach answer`,
      answered_by: ctx.users.coach.id,
    })
  ),
  insertCase(
    'lapsed client cannot insert their own question',
    'inactiveClient', 'client_questions', 'denied', 'lapsed insert'
  ),
  targetCase(
    'lapsed client cannot update their own question',
    'inactiveClient', 'client_questions', 'UPDATE', 'denied',
    'questionClientUpdateId', { content: `${PROBE} blocked update` }
  ),
  targetCase(
    'lapsed client can read their own question',
    'inactiveClient', 'client_questions', 'SELECT', 'allowed', 'questionReadId'
  ),

  insertCase(
    'active client can insert their own legacy workout log',
    'activeClient', 'workout_logs', 'allowed', 'active insert'
  ),
  insertCase(
    'admin can insert a legacy workout log for a lapsed client',
    'admin', 'workout_logs', 'allowed', 'admin insert'
  ),
  insertCase(
    'lapsed client cannot insert their own legacy workout log',
    'inactiveClient', 'workout_logs', 'denied', 'lapsed insert'
  ),
  targetCase(
    'lapsed client cannot update their own legacy workout log',
    'inactiveClient', 'workout_logs', 'UPDATE', 'denied',
    'workoutLogUpdateId', { feedback: `${PROBE} blocked update` }
  ),
  targetCase(
    'lapsed client cannot delete their own legacy workout log',
    'inactiveClient', 'workout_logs', 'DELETE', 'denied', 'workoutLogDeleteId'
  ),
  targetCase(
    'lapsed client can read their own legacy workout log',
    'inactiveClient', 'workout_logs', 'SELECT', 'allowed', 'workoutLogReadId'
  ),
]);

async function insertServiceRow(serviceClient, contract, env, table, row, step) {
  const result = await serviceClient.from(table).insert(row).select('id').maybeSingle();
  const data = requireResult(result, contract, step, env);
  if (!data?.id) throw new Error(`${step}: service insert returned no row id.`);
  return data.id;
}

async function prepareRpmParents(context, serviceClient, contract, env, actorKey) {
  const stem = actorKey === 'activeClient' ? 'active' : 'inactive';
  const graphId = await insertServiceRow(
    serviceClient, contract, env, 'rpm_graphs',
    {
      client_id: context.users[actorKey].id,
      coach_id: context.users.coach.id,
      point_a_summary: PROBE,
      point_b_dream: PROBE,
      status: 'published',
    },
    `${stem} phase-submission graph setup`
  );
  const phaseId = await insertServiceRow(
    serviceClient, contract, env, 'rpm_phases',
    {
      graph_id: graphId,
      phase_index: 1,
      stage_name: PROBE,
      status: 'active',
    },
    `${stem} phase-submission phase setup`
  );
  context.captured[`${stem}GraphId`] = graphId;
  context.captured[`${stem}PhaseId`] = phaseId;
}

async function prepareOwnedProbeRows(context, serviceClient, contract, env) {
  const inactive = rowContext(context, 'inactiveClient');
  const add = async (key, table, suffix) => {
    context.captured[key] = await insertServiceRow(
      serviceClient, contract, env, table, rows[table](inactive, suffix),
      `${table} ${key} setup`
    );
  };

  await add('dailyUpdateId', 'daily_routine_logs', '2099-01-04');
  await add('dailyDeleteId', 'daily_routine_logs', '2099-01-05');
  await add('dailyReadId', 'daily_routine_logs', '2099-01-06');

  for (const [table, probes] of Object.entries({
    phase_submissions: [
      ['phaseSubmissionUpdateId', 'update setup'],
      ['phaseSubmissionDeleteId', 'delete setup'],
      ['phaseSubmissionReadId', 'read setup'],
    ],
    subjective_assessments: [
      ['subjectiveUpdateId', 'update setup'],
      ['subjectiveDeleteId', 'delete setup'],
      ['subjectiveReadId', 'read setup'],
    ],
    exercise_alternative_requests: [
      ['alternativeStaffUpdateId', 'staff update setup'],
      ['alternativeClientUpdateId', 'client update setup'],
      ['alternativeReadId', 'read setup'],
    ],
    progress_logs: [
      ['progressUpdateId', 'update setup'],
      ['progressDeleteId', 'delete setup'],
      ['progressReadId', 'read setup'],
    ],
    client_questions: [
      ['questionStaffUpdateId', 'staff update setup'],
      ['questionClientUpdateId', 'client update setup'],
      ['questionReadId', 'read setup'],
    ],
    workout_logs: [
      ['workoutLogUpdateId', 'update setup'],
      ['workoutLogDeleteId', 'delete setup'],
      ['workoutLogReadId', 'read setup'],
    ],
  })) {
    for (const [key, suffix] of probes) await add(key, table, suffix);
  }
}

function assertAllowed(testCase, data, error, contract, env) {
  if (error) {
    throw redactFixtureError(error, contract, env, `${testCase.name} (expected success)`);
  }
  if (!data?.id) {
    throw new Error(`${testCase.name}: ${testCase.verb.toLowerCase()} returned no row id.`);
  }
}

function assertDenied(testCase, data, error, contract, env) {
  if (error) {
    if (!RLS_DENIED.test(error.message || '')) {
      throw redactFixtureError(
        new Error(`expected /${RLS_DENIED.source}/ but the server said: ${error.message}`),
        contract, env, testCase.name
      );
    }
    return;
  }
  // RLS USING predicates silently hide rows from UPDATE and DELETE. A missing
  // gate returns the mutated row id, which is the unexpected-success signal.
  if (['UPDATE', 'DELETE'].includes(testCase.verb) && !data) return;
  throw new Error(`${testCase.name}: expected a denial but the write succeeded.`);
}

async function executeCase(testCase, context, sessions, contract, env) {
  const session = sessions[testCase.actor];
  if (!session) throw new Error(`${testCase.name}: no session for actor ${testCase.actor}.`);

  let query;
  if (testCase.verb === 'INSERT') {
    query = session.client.from(testCase.table).insert(testCase.row(context));
  } else if (testCase.verb === 'UPDATE') {
    const changes =
      typeof testCase.changes === 'function' ? testCase.changes(context) : testCase.changes;
    query = session.client
      .from(testCase.table)
      .update(changes)
      .eq('id', testCase.targetId(context));
  } else if (testCase.verb === 'DELETE') {
    query = session.client
      .from(testCase.table)
      .delete()
      .eq('id', testCase.targetId(context));
  } else if (testCase.verb === 'SELECT') {
    query = session.client
      .from(testCase.table)
      .select('id')
      .eq('id', testCase.targetId(context));
  } else {
    throw new Error(`${testCase.name}: unsupported verb ${testCase.verb}.`);
  }

  const { data, error } =
    testCase.verb === 'SELECT'
      ? await query.maybeSingle()
      : await query.select('id').maybeSingle();
  if (testCase.expect === 'allowed') {
    assertAllowed(testCase, data, error, contract, env);
  } else {
    assertDenied(testCase, data, error, contract, env);
  }
  return { name: testCase.name, outcome: testCase.expect };
}

export async function runClientWriteCases(
  contract,
  serviceClient,
  env = process.env
) {
  const users = await resolveFixtureUsers(serviceClient, contract, env);
  const context = { users, captured: {} };
  await prepareRpmParents(context, serviceClient, contract, env, 'activeClient');
  await prepareRpmParents(context, serviceClient, contract, env, 'inactiveClient');
  await prepareOwnedProbeRows(context, serviceClient, contract, env);

  const sessions = {};
  for (const key of CLIENT_WRITE_ACTOR_KEYS) {
    sessions[key] = await signInFixture(contract, key, env);
  }
  try {
    const results = [];
    for (const testCase of CLIENT_WRITE_CASES) {
      results.push(await executeCase(testCase, context, sessions, contract, env));
    }
    return results;
  } finally {
    for (const session of Object.values(sessions)) await signOutFixture(session);
  }
}

// Reset before and after. A trailing reset failure never replaces the case
// failure that caused it.
export async function runClientWriteSuite(
  contract,
  serviceClient,
  env = process.env,
  dependencies = {}
) {
  const runCases = dependencies.runCases ?? runClientWriteCases;
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
