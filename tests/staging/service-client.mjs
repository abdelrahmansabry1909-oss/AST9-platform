import { createClient } from '@supabase/supabase-js';
import {
  buildScopedIdFilter,
  getValidatedServiceRoleKey,
  redactFixtureError,
} from './fixture-contract.mjs';

const SCHEMA_PROBES = Object.freeze([
  ['profiles', 'id'],
  ['legal_documents', 'id'],
  ['legal_acceptances', 'id'],
  ['subscriptions', 'id'],
  ['coach_subscriptions', 'id'],
  ['v_client_subscription_state', 'client_id'],
]);

export const RESET_SCHEMA_PROBES = Object.freeze([
  ['workout_sessions', 'client_id'],
  ['workout_exercise_logs', 'session_id'],
  ['exercise_alternative_requests', 'client_id'],
  ['client_routines', 'client_id'],
  ['client_program_versions', 'client_id'],
  ['client_program_revisions', 'client_id'],
  ['client_programs', 'client_id'],
  ['rpm_graphs', 'client_id'],
  ['rpm_phases', 'graph_id'],
  ['rpm_phase_exercises', 'phase_id'],
  ['progress_snapshots', 'client_id'],
  ['assessments', 'client_id'],
  ['rehab_objective_assessments', 'assessment_id'],
  ['body_map_states', 'client_id'],
  ['gait_assessments', 'client_id'],
  ['subjective_assessments', 'client_id'],
  ['sessions', 'client_id'],
  ['notifications', 'recipient_id'],
]);

export function createStagingServiceClient(contract, env = process.env) {
  const serviceRoleKey = getValidatedServiceRoleKey(contract, env);
  return createClient(contract.config.url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-ast9-purpose': 'staging-fixture-tooling' },
    },
  });
}

export function requireResult(result, contract, step, env = process.env) {
  if (result?.error) {
    throw redactFixtureError(result.error, contract, env, step);
  }
  return result?.data;
}

export async function probeStagingSchema(client, contract, env = process.env) {
  for (const [table, column] of SCHEMA_PROBES) {
    const result = await client.from(table).select(column).limit(1);
    requireResult(result, contract, `schema probe (${table})`, env);
  }
}

export async function probeResetSchema(client, contract, env = process.env) {
  for (const [table, column] of RESET_SCHEMA_PROBES) {
    const result = await client.from(table).select(column).limit(1);
    requireResult(result, contract, `reset schema probe (${table})`, env);
  }
}

export async function listAllAuthUsers(client, contract, env = process.env) {
  const users = [];
  const perPage = 1000;
  const maxPages = 1000;
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await client.auth.admin.listUsers({ page, perPage });
    if (result.error) {
      throw redactFixtureError(result.error, contract, env, 'auth user listing');
    }
    const batch = result.data?.users || [];
    users.push(...batch);
    const lastPage = Number(result.data?.lastPage);
    if (batch.length === 0 || (Number.isInteger(lastPage) && page >= lastPage)) {
      return users;
    }
  }
  throw new Error('Auth user listing exceeded the staging pagination safety limit.');
}

export async function resolveFixtureUsers(client, contract, env = process.env) {
  const users = await listAllAuthUsers(client, contract, env);
  return Object.fromEntries(contract.fixtures.map((fixture) => {
    const matches = users.filter(
      (user) => user.email?.trim().toLowerCase() === fixture.email
    );
    if (matches.length !== 1) {
      throw new Error(
        `${fixture.label} fixture must resolve to exactly one staging auth user.`
      );
    }
    return [fixture.key, { id: matches[0].id, fixture }];
  }));
}

export async function ensureFixtureUsers(client, contract, env = process.env) {
  const existingUsers = await listAllAuthUsers(client, contract, env);
  const resolved = {};

  for (const fixture of contract.fixtures) {
    const matches = existingUsers.filter(
      (user) => user.email?.trim().toLowerCase() === fixture.email
    );
    if (matches.length > 1) {
      throw new Error(`${fixture.label} fixture resolves to duplicate auth users.`);
    }

    let user;
    if (matches.length === 1) {
      const result = await client.auth.admin.updateUserById(matches[0].id, {
        password: fixture.password,
        email_confirm: true,
        user_metadata: {
          full_name: fixture.fullName,
          fixture_role: fixture.role,
        },
      });
      if (result.error) {
        throw redactFixtureError(result.error, contract, env, `${fixture.label} auth reconcile`);
      }
      user = result.data.user;
    } else {
      const result = await client.auth.admin.createUser({
        email: fixture.email,
        password: fixture.password,
        email_confirm: true,
        user_metadata: {
          full_name: fixture.fullName,
          fixture_role: fixture.role,
        },
      });
      if (result.error) {
        throw redactFixtureError(result.error, contract, env, `${fixture.label} auth creation`);
      }
      user = result.data.user;
    }

    resolved[fixture.key] = { id: user.id, fixture };
  }

  return resolved;
}

export async function selectScopedIds(
  client,
  contract,
  table,
  column,
  ids,
  env = process.env
) {
  const filter = buildScopedIdFilter(ids);
  const result = await client.from(table).select('id').in(column, filter.values);
  const rows = requireResult(result, contract, `select scoped ${table}`, env) || [];
  return rows.map((row) => row.id);
}

export async function deleteScoped(
  client,
  contract,
  table,
  column,
  ids,
  env = process.env
) {
  const filter = buildScopedIdFilter(ids);
  const result = await client.from(table).delete().in(column, filter.values);
  requireResult(result, contract, `delete scoped ${table}`, env);
}
