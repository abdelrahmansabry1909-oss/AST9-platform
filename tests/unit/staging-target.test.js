import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTION_SUPABASE_REF,
  assertSyntheticIdentity,
  readStagingConfig,
  rewriteLegacySupabaseClient,
} from '../smoke/staging-target.mjs';

const safeEnv = {
  AST9_E2E_STAGING_SUPABASE_URL: 'https://stagingproject123.supabase.co',
  AST9_E2E_STAGING_SUPABASE_ANON_KEY: 'test-anon-key-with-safe-length',
  AST9_E2E_IDENTITY_MARKER: 'ast9-e2e',
};

test('returns null when authenticated staging is not configured', () => {
  assert.equal(readStagingConfig({}), null);
});

test('rejects partial authenticated configuration', () => {
  assert.throws(
    () => readStagingConfig({ AST9_E2E_COACH_EMAIL: 'ast9-e2e-coach@example.test' }),
    /Missing staging safety keys/
  );
});

test('rejects the production Supabase project', () => {
  assert.throws(
    () => readStagingConfig({
      ...safeEnv,
      AST9_E2E_STAGING_SUPABASE_URL:
        `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
    }),
    /blocked from using the production Supabase project/
  );
});

test('requires synthetic identities to carry the configured marker', () => {
  assert.doesNotThrow(() =>
    assertSyntheticIdentity('coach+ast9-e2e@example.test', 'ast9-e2e', 'coach')
  );
  assert.throws(
    () => assertSyntheticIdentity('real-coach@example.com', 'ast9-e2e', 'coach'),
    /must contain/
  );
});

test('rewrites the legacy client without retaining the production reference', () => {
  const config = readStagingConfig(safeEnv);
  const source = `
// Project URL: https://${PRODUCTION_SUPABASE_REF}.supabase.co
const SUPABASE_URL  = 'https://${PRODUCTION_SUPABASE_REF}.supabase.co';
const SUPABASE_ANON = 'production-anon-placeholder';
const storageKey = 'sb-${PRODUCTION_SUPABASE_REF}-auth-isolated';
`;
  const rewritten = rewriteLegacySupabaseClient(source, config);

  assert.match(rewritten, /https:\/\/stagingproject123\.supabase\.co/);
  assert.match(rewritten, /test-anon-key-with-safe-length/);
  assert.doesNotMatch(rewritten, new RegExp(PRODUCTION_SUPABASE_REF));
});
