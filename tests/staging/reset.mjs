import { seedFixtures } from './seed.mjs';
import {
  deleteScoped,
  probeResetSchema,
  probeStagingSchema,
  resolveFixtureUsers,
  selectScopedIds,
} from './service-client.mjs';

async function deleteIfPresent(client, contract, table, column, ids, env) {
  if (ids.length === 0) return;
  await deleteScoped(client, contract, table, column, ids, env);
}

async function resetWorkoutData(client, contract, clientIds, env) {
  const sessionIds = await selectScopedIds(
    client,
    contract,
    'workout_sessions',
    'client_id',
    clientIds,
    env
  );
  await deleteIfPresent(
    client,
    contract,
    'workout_exercise_logs',
    'session_id',
    sessionIds,
    env
  );
  await deleteScoped(client, contract, 'workout_sessions', 'client_id', clientIds, env);
}

async function resetProgramData(client, contract, clientIds, env) {
  await deleteScoped(
    client,
    contract,
    'client_program_versions',
    'client_id',
    clientIds,
    env
  );
  await deleteScoped(
    client,
    contract,
    'client_program_revisions',
    'client_id',
    clientIds,
    env
  );
  await deleteScoped(client, contract, 'client_programs', 'client_id', clientIds, env);
}

async function resetRpmData(client, contract, clientIds, env) {
  const graphIds = await selectScopedIds(
    client,
    contract,
    'rpm_graphs',
    'client_id',
    clientIds,
    env
  );
  const phaseIds = graphIds.length > 0
    ? await selectScopedIds(client, contract, 'rpm_phases', 'graph_id', graphIds, env)
    : [];

  await deleteIfPresent(
    client,
    contract,
    'rpm_phase_exercises',
    'phase_id',
    phaseIds,
    env
  );
  await deleteIfPresent(client, contract, 'rpm_phases', 'graph_id', graphIds, env);
  await deleteScoped(client, contract, 'rpm_graphs', 'client_id', clientIds, env);
}

async function resetAssessmentData(client, contract, clientIds, env) {
  const assessmentIds = await selectScopedIds(
    client,
    contract,
    'assessments',
    'client_id',
    clientIds,
    env
  );

  await deleteIfPresent(
    client,
    contract,
    'rehab_objective_assessments',
    'assessment_id',
    assessmentIds,
    env
  );
  await deleteIfPresent(
    client,
    contract,
    'body_map_states',
    'client_id',
    clientIds,
    env
  );
  await deleteScoped(client, contract, 'gait_assessments', 'client_id', clientIds, env);
  await deleteScoped(
    client,
    contract,
    'subjective_assessments',
    'client_id',
    clientIds,
    env
  );
  await deleteScoped(client, contract, 'assessments', 'client_id', clientIds, env);
}

export async function resetFixtures(contract, client, env = process.env) {
  await probeStagingSchema(client, contract, env);
  await probeResetSchema(client, contract, env);
  const users = await resolveFixtureUsers(client, contract, env);
  const clientIds = [users.activeClient.id, users.inactiveClient.id];

  await resetWorkoutData(client, contract, clientIds, env);
  await resetProgramData(client, contract, clientIds, env);
  await resetRpmData(client, contract, clientIds, env);
  await resetAssessmentData(client, contract, clientIds, env);

  return seedFixtures(contract, client, env);
}
