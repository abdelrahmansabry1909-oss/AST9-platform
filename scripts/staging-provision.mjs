import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRODUCTION_SUPABASE_REF } from '../tests/smoke/staging-target.mjs';

export const BASELINE_SHA256 =
  'a057aee18df15bdb05cb6e0bbc2fcb03e6dad99c6cdbee4d717111ffa5fd220f';
export const BASELINE_PATH = 'supabase/baseline/production_public_schema.sql';
export const REPAIR_VERSIONS_PATH = 'supabase/baseline/repair-versions.txt';
export const PROVISION_CONFIRM_KEY = 'AST9_STAGING_SEED_CONFIRM';
export const HISTORICAL_MIGRATION_CUTOFF = '20260710000000';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF_PATTERN = /^[a-z0-9]{8,40}$/;
const VERSION_PATTERN = /^\d{14}$/;

export const EMPTY_PUBLIC_SCHEMA_SQL = [
  'DO $$',
  'BEGIN',
  '  IF EXISTS (',
  '    SELECT 1',
  '    FROM pg_catalog.pg_class c',
  '    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace',
  '    WHERE n.nspname = $q$public$q$',
  '      AND c.relkind IN ($q$r$q$, $q$p$q$, $q$v$q$, $q$m$q$, $q$S$q$, $q$f$q$)',
  '  ) THEN',
  '    RAISE EXCEPTION $q$AST9 staging baseline requires an empty public schema$q$;',
  '  END IF;',
  'END',
  '$$;',
].join(' ');

function requiredValue(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function compareArrays(actual, expected, label) {
  if (
    actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${label} does not match the retained historical migrations.`);
  }
}

function projectRefFromUrl(value) {
  if (!value?.trim()) return '';
  try {
    const url = new URL(value.trim());
    return url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1] || '';
  } catch {
    return '';
  }
}

export function parseProvisionArgs(argv) {
  const result = { check: false, ref: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      result.check = true;
    } else if (argument === '--ref') {
      result.ref = requiredValue(argv[index + 1], '--ref');
      index += 1;
    } else {
      throw new Error(`Unknown staging provision argument: ${argument}`);
    }
  }
  if (!result.check) {
    throw new Error('Use --check to validate and print staging provisioning commands.');
  }
  return result;
}

export function resolveProvisionProjectRef(args, env = process.env) {
  return (
    args.ref
    || env.AST9_E2E_STAGING_PROJECT_REF?.trim()
    || projectRefFromUrl(env.AST9_E2E_STAGING_SUPABASE_URL)
  );
}

export function assertProvisionTarget(projectRef, confirmation) {
  const normalizedRef = requiredValue(projectRef, 'Staging project ref').toLowerCase();
  if (!PROJECT_REF_PATTERN.test(normalizedRef)) {
    throw new Error('Staging project ref must contain only 8-40 lowercase letters or digits.');
  }
  if (normalizedRef === PRODUCTION_SUPABASE_REF) {
    throw new Error('Staging baseline provisioning is blocked from production.');
  }

  const normalizedConfirmation = requiredValue(
    confirmation,
    PROVISION_CONFIRM_KEY
  );
  if (normalizedConfirmation !== normalizedRef) {
    throw new Error(`${PROVISION_CONFIRM_KEY} must exactly match the staging project ref.`);
  }
  return normalizedRef;
}

export function assertEmptyPublicSchemaCount(tableCount) {
  if (!Number.isInteger(tableCount) || tableCount < 0) {
    throw new Error('Public schema object count must be a non-negative integer.');
  }
  if (tableCount !== 0) {
    throw new Error('AST9 staging baseline requires an empty public schema.');
  }
}

export function verifyBaselineIntegrity(root = REPO_ROOT) {
  const baseline = readFileSync(resolve(root, BASELINE_PATH));
  const actualHash = createHash('sha256').update(baseline).digest('hex');
  if (actualHash !== BASELINE_SHA256) {
    throw new Error('Staging baseline SHA-256 does not match the reviewed artifact.');
  }
  return actualHash;
}

export function readAndValidateRepairVersions(root = REPO_ROOT) {
  const versions = readFileSync(resolve(root, REPAIR_VERSIONS_PATH), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (versions.length !== 60) {
    throw new Error('Repair manifest must contain exactly 60 historical versions.');
  }
  if (versions.some((version) => !VERSION_PATTERN.test(version))) {
    throw new Error('Repair manifest contains an invalid migration version.');
  }
  if (new Set(versions).size !== versions.length) {
    throw new Error('Repair manifest contains duplicate migration versions.');
  }

  const sortedVersions = [...versions].sort();
  compareArrays(versions, sortedVersions, 'Repair manifest ordering');

  const historicalVersions = readdirSync(resolve(root, 'supabase/migrations'))
    .map((name) => name.match(/^(\d{14})_.*\.sql$/)?.[1])
    .filter((version) => version && version <= HISTORICAL_MIGRATION_CUTOFF)
    .sort();
  compareArrays(versions, historicalVersions, 'Repair manifest');

  return Object.freeze(versions);
}

export function buildProvisionCommands(versions, projectRef) {
  const stagingDbUrl =
    `postgresql://postgres@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`;
  const commands = [
    `psql "${stagingDbUrl}" --set=ON_ERROR_STOP=1 --single-transaction `
      + `--command='${EMPTY_PUBLIC_SCHEMA_SQL}' --file='${BASELINE_PATH}'`,
    ...versions.map(
      (version) =>
        `npx supabase migration repair ${version} --status applied --linked`
    ),
    'npx supabase db push --linked',
  ];
  return Object.freeze(commands);
}

export function createProvisionPlan({
  args,
  env = process.env,
  root = REPO_ROOT,
}) {
  const projectRef = assertProvisionTarget(
    resolveProvisionProjectRef(args, env),
    env[PROVISION_CONFIRM_KEY]
  );
  const baselineHash = verifyBaselineIntegrity(root);
  const versions = readAndValidateRepairVersions(root);
  return Object.freeze({
    projectRef,
    baselineHash,
    versions,
    commands: buildProvisionCommands(versions, projectRef),
  });
}

function run() {
  const args = parseProvisionArgs(process.argv.slice(2));
  const plan = createProvisionPlan({ args });

  console.log(`Staging provision checks passed for project ${plan.projectRef}.`);
  console.log(`Baseline SHA-256: ${plan.baselineHash}`);
  console.log(`Historical versions to repair: ${plan.versions.length}`);
  console.log('');
  console.log('psql will request the staging database password without printing it.');
  console.log('Review and run these commands one at a time; this script executes nothing:');
  console.log('');
  for (const command of plan.commands) console.log(command);
}

const isMain =
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    run();
  } catch (error) {
    console.error(`Staging provision check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
