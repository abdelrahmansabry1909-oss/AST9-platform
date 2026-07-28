import {
  PRODUCTION_SUPABASE_REF,
  assertSyntheticIdentity,
  readStagingConfig,
} from '../smoke/staging-target.mjs';

export const STAGING_COMMANDS = Object.freeze([
  'validate',
  'seed',
  'verify',
  'reset',
  'authz-subscriptions',
  'authz-system-rpcs',
]);
export const SERVICE_ROLE_KEY = 'AST9_E2E_STAGING_SERVICE_ROLE_KEY';
export const SEED_CONFIRM_KEY = 'AST9_STAGING_SEED_CONFIRM';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FIXTURE_DEFINITIONS = Object.freeze([
  {
    key: 'admin',
    label: 'admin',
    role: 'admin',
    emailKey: 'AST9_E2E_ADMIN_EMAIL',
    passwordKey: 'AST9_E2E_ADMIN_PASSWORD',
    fullName: 'AST9 E2E Admin',
  },
  {
    key: 'coach',
    label: 'coach',
    role: 'coach',
    emailKey: 'AST9_E2E_COACH_EMAIL',
    passwordKey: 'AST9_E2E_COACH_PASSWORD',
    fullName: 'AST9 E2E Coach',
  },
  {
    key: 'activeClient',
    label: 'active client',
    role: 'client',
    emailKey: 'AST9_E2E_CLIENT_EMAIL',
    passwordKey: 'AST9_E2E_CLIENT_PASSWORD',
    fullName: 'AST9 E2E Active Client',
  },
  {
    key: 'inactiveClient',
    label: 'inactive client',
    role: 'client',
    emailKey: 'AST9_E2E_INACTIVE_CLIENT_EMAIL',
    passwordKey: 'AST9_E2E_INACTIVE_CLIENT_PASSWORD',
    fullName: 'AST9 E2E Inactive Client',
  },
  {
    key: 'unassignedClient',
    label: 'unassigned client',
    role: 'client',
    emailKey: 'AST9_E2E_UNASSIGNED_CLIENT_EMAIL',
    passwordKey: 'AST9_E2E_UNASSIGNED_CLIENT_PASSWORD',
    fullName: 'AST9 E2E Unassigned Client',
  },
]);

function requiredValue(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required staging fixture key: ${key}`);
  return value;
}

function assertFixtureMarker(email, marker, label) {
  if (marker.length < 6) {
    throw new Error('AST9_E2E_IDENTITY_MARKER must contain at least six characters.');
  }

  assertSyntheticIdentity(email, marker, label);
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) {
    throw new Error(`${label} E2E email must be a valid email address.`);
  }

  const localPart = email.slice(0, at).toLowerCase();
  if (!localPart.includes(marker)) {
    throw new Error(
      `${label} E2E email must contain AST9_E2E_IDENTITY_MARKER in its local part.`
    );
  }
}

export function createFixtureContract(env = process.env, command = 'validate') {
  if (!STAGING_COMMANDS.includes(command)) {
    throw new Error(`Unknown staging fixture command: ${command}`);
  }

  const config = readStagingConfig(env);
  if (!config) {
    throw new Error('Authenticated staging configuration is required for fixture tooling.');
  }

  const fixtures = FIXTURE_DEFINITIONS.map((definition) => {
    const email = requiredValue(env, definition.emailKey).toLowerCase();
    const password = requiredValue(env, definition.passwordKey);
    assertFixtureMarker(email, config.identityMarker, definition.label);
    return Object.freeze({ ...definition, email, password });
  });

  const emails = fixtures.map((fixture) => fixture.email);
  if (new Set(emails).size !== emails.length) {
    throw new Error('Every staging fixture role must use a distinct synthetic email.');
  }

  const contract = Object.freeze({
    command,
    config: Object.freeze({ ...config }),
    fixtures: Object.freeze(fixtures),
    fixtureByKey: Object.freeze(
      Object.fromEntries(fixtures.map((fixture) => [fixture.key, fixture]))
    ),
  });

  if (command !== 'validate') assertMutationBoundary(contract, env);
  return contract;
}

export function assertMutationBoundary(contract, env = process.env) {
  if (!contract?.config?.projectRef || !contract?.config?.url) {
    throw new Error('Validated staging fixture contract is required.');
  }
  if (contract.config.projectRef === PRODUCTION_SUPABASE_REF) {
    throw new Error('Fixture mutation is blocked from using the production Supabase project.');
  }

  const serviceRoleKey = requiredValue(env, SERVICE_ROLE_KEY);
  if (serviceRoleKey.length < 20 || /\s/.test(serviceRoleKey)) {
    throw new Error(`${SERVICE_ROLE_KEY} is not a valid service-role key.`);
  }
  if (serviceRoleKey === contract.config.anonKey) {
    throw new Error(`${SERVICE_ROLE_KEY} must not equal the staging anon key.`);
  }

  const confirmation = requiredValue(env, SEED_CONFIRM_KEY);
  if (confirmation !== contract.config.projectRef) {
    throw new Error(
      `${SEED_CONFIRM_KEY} must exactly match the validated staging project ref.`
    );
  }
}

export function getValidatedServiceRoleKey(contract, env = process.env) {
  assertMutationBoundary(contract, env);
  return env[SERVICE_ROLE_KEY].trim();
}

export function buildScopedIdFilter(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('Scoped fixture operation requires at least one UUID.');
  }

  const values = [...new Set(ids.map((id) => String(id).trim().toLowerCase()))];
  if (values.some((id) => !UUID_PATTERN.test(id))) {
    throw new Error('Scoped fixture operation received an invalid UUID.');
  }

  return Object.freeze({
    operator: 'in',
    values: Object.freeze(values),
  });
}

export function redactFixtureError(error, contract, env = process.env, step = 'fixture') {
  let message = error instanceof Error ? error.message : String(error);
  const sensitiveValues = [
    contract?.config?.url,
    contract?.config?.anonKey,
    env[SERVICE_ROLE_KEY],
    ...((contract?.fixtures || []).flatMap((fixture) => [
      fixture.email,
      fixture.password,
    ])),
  ].filter((value) => typeof value === 'string' && value.length > 0);

  for (const value of sensitiveValues) {
    message = message.split(value).join('[redacted]');
  }
  return new Error(`${step} failed: ${message}`);
}

export function fixtureLabels(contract) {
  return contract.fixtures.map((fixture) => fixture.label);
}
