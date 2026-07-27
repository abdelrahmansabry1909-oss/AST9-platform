import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BASELINE_PATH,
  BASELINE_SHA256,
  EMPTY_PUBLIC_SCHEMA_SQL,
  PROVISION_CONFIRM_KEY,
  assertEmptyPublicSchemaCount,
  assertProvisionTarget,
  createProvisionPlan,
  parseProvisionArgs,
  readAndValidateRepairVersions,
  verifyBaselineIntegrity,
} from '../../scripts/staging-provision.mjs';
import { PRODUCTION_SUPABASE_REF } from '../smoke/staging-target.mjs';

const stagingRef = 'stagingproject123';
const safeEnv = {
  [PROVISION_CONFIRM_KEY]: stagingRef,
};

test('provision guard requires explicit check mode', () => {
  assert.throws(() => parseProvisionArgs([]), /Use --check/);
  assert.deepEqual(parseProvisionArgs(['--check', '--ref', stagingRef]), {
    check: true,
    ref: stagingRef,
  });
});

test('provision guard rejects production and missing confirmation', () => {
  assert.throws(
    () => assertProvisionTarget(PRODUCTION_SUPABASE_REF, PRODUCTION_SUPABASE_REF),
    /blocked from production/
  );
  assert.throws(
    () => assertProvisionTarget(stagingRef, ''),
    new RegExp(PROVISION_CONFIRM_KEY)
  );
  assert.throws(
    () => assertProvisionTarget(stagingRef, 'differentproject'),
    /exactly match/
  );
});

test('provision guard accepts a confirmed non-production ref', () => {
  assert.equal(assertProvisionTarget(stagingRef, stagingRef), stagingRef);
});

test('empty-schema guard refuses any existing public object', () => {
  assert.doesNotThrow(() => assertEmptyPublicSchemaCount(0));
  assert.throws(() => assertEmptyPublicSchemaCount(1), /requires an empty public schema/);
});

test('baseline hash matches the independently reviewed artifact', () => {
  assert.equal(verifyBaselineIntegrity(), BASELINE_SHA256);
  const bytes = readFileSync(new URL(`../../${BASELINE_PATH}`, import.meta.url));
  assert.ok(bytes.length > 250_000);
});

test('repair manifest matches all 60 retained historical migrations', () => {
  const versions = readAndValidateRepairVersions();
  assert.equal(versions.length, 60);
  assert.equal(versions[0], '20260505124526');
  assert.equal(versions.at(-1), '20260710000000');
});

test('emitted plan is offline and starts with an atomic empty-schema check', () => {
  const plan = createProvisionPlan({
    args: { check: true, ref: stagingRef },
    env: safeEnv,
  });
  assert.equal(plan.commands.length, 62);
  assert.match(plan.commands[0], /psql/);
  assert.match(plan.commands[0], /--single-transaction/);
  assert.match(plan.commands[0], new RegExp(`db\\.${stagingRef}\\.supabase\\.co`));
  assert.match(plan.commands[0], /requires an empty public schema/);
  assert.match(plan.commands[0], new RegExp(BASELINE_PATH.replaceAll('/', '\\/')));
  assert.equal(plan.commands.at(-1), 'npx supabase db push --linked');
  assert.doesNotMatch(plan.commands.join('\n'), new RegExp(PRODUCTION_SUPABASE_REF));
  assert.match(EMPTY_PUBLIC_SCHEMA_SQL, /pg_catalog\.pg_class/);
  assert.match(EMPTY_PUBLIC_SCHEMA_SQL, /\$q\$public\$q\$/);
  assert.doesNotMatch(EMPTY_PUBLIC_SCHEMA_SQL, /'/);
  assert.doesNotMatch(plan.commands[0], /''/);
});

test('provision emitter cannot execute child processes or make network calls', () => {
  const source = readFileSync(
    new URL('../../scripts/staging-provision.mjs', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /node:child_process|spawnSync|execSync|fetch\s*\(/);
});

test('auth trigger migration is idempotent and requires an enabled row insert trigger', () => {
  const source = readFileSync(
    new URL(
      '../../supabase/migrations/20260727000000_auth_user_trigger.sql',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(source, /if not exists \(/i);
  assert.match(source, /after insert on auth\.users/i);
  assert.match(source, /for each row execute function public\.handle_new_user\(\)/i);
  assert.match(source, /\(t\.tgtype & 1\) = 1/);
  assert.match(source, /\(t\.tgtype & 4\) = 4/);
});

test('legal reference migration contains six metadata-only idempotent rows', () => {
  const source = readFileSync(
    new URL(
      '../../supabase/migrations/20260727000100_legal_documents_reference_data.sql',
      import.meta.url
    ),
    'utf8'
  );
  assert.equal((source.match(/\('(?:terms|privacy|medical_disclaimer|health_data_consent|refund|cookie)'/g) || []).length, 6);
  assert.match(source, /on conflict \(doc_type, version\) do nothing/i);
  assert.doesNotMatch(source, /legal_acceptances|accepted_at|user_id/i);
});
