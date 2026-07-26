import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTION_SUPABASE_REF,
  assertLocalAuthenticatedFrontend,
  assertSyntheticIdentity,
  isProductionSupabaseEndpoint,
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
    /Missing staging keys/
  );
});

test('requires the complete synthetic role fixture matrix', () => {
  assert.throws(
    () => readStagingConfig(safeEnv),
    /AST9_E2E_ADMIN_EMAIL/
  );
});

test('rejects the production Supabase project', () => {
  assert.throws(
    () => readStagingConfig({
      ...safeEnv,
      AST9_E2E_ADMIN_EMAIL: 'admin+ast9-e2e@example.test',
      AST9_E2E_ADMIN_PASSWORD: 'admin-password',
      AST9_E2E_COACH_EMAIL: 'coach+ast9-e2e@example.test',
      AST9_E2E_COACH_PASSWORD: 'coach-password',
      AST9_E2E_CLIENT_EMAIL: 'client+ast9-e2e@example.test',
      AST9_E2E_CLIENT_PASSWORD: 'client-password',
      AST9_E2E_INACTIVE_CLIENT_EMAIL: 'inactive+ast9-e2e@example.test',
      AST9_E2E_INACTIVE_CLIENT_PASSWORD: 'inactive-password',
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

test('detects production Supabase HTTP and WebSocket endpoints', () => {
  assert.equal(
    isProductionSupabaseEndpoint(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`),
    true
  );
  assert.equal(
    isProductionSupabaseEndpoint(
      `wss://${PRODUCTION_SUPABASE_REF}.supabase.co/realtime/v1/websocket`
    ),
    true
  );
  assert.equal(
    isProductionSupabaseEndpoint(
      `https://${PRODUCTION_SUPABASE_REF}.functions.supabase.co/function`
    ),
    true
  );
  assert.equal(
    isProductionSupabaseEndpoint('https://stagingproject123.supabase.co'),
    false
  );
});

test('authenticated staging rejects an external frontend target', () => {
  assert.doesNotThrow(() => assertLocalAuthenticatedFrontend(undefined));
  assert.doesNotThrow(() =>
    assertLocalAuthenticatedFrontend('http://127.0.0.1:4173/AST9_HUB/')
  );
  assert.throws(
    () => assertLocalAuthenticatedFrontend('https://example.github.io/AST9_HUB/'),
    /locally built frontend/
  );
});

test('rewrites the legacy client without retaining the production reference', () => {
  const config = {
    url: safeEnv.AST9_E2E_STAGING_SUPABASE_URL,
    anonKey: safeEnv.AST9_E2E_STAGING_SUPABASE_ANON_KEY,
    projectRef: 'stagingproject123',
    identityMarker: safeEnv.AST9_E2E_IDENTITY_MARKER,
  };
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

  const visitorSource = `
const SUPABASE_URL = 'https://${PRODUCTION_SUPABASE_REF}.supabase.co';
const SUPABASE_ANON = 'production-anon-placeholder';
const FN_URL = \`\${SUPABASE_URL}/functions/v1/visitor-survey\`;
`;
  const rewrittenVisitor = rewriteLegacySupabaseClient(visitorSource, config);
  assert.match(rewrittenVisitor, /https:\/\/stagingproject123\.supabase\.co/);
  assert.match(rewrittenVisitor, /test-anon-key-with-safe-length/);
  assert.doesNotMatch(rewrittenVisitor, new RegExp(PRODUCTION_SUPABASE_REF));
});
