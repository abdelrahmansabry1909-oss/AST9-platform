export const PRODUCTION_SUPABASE_REF = 'byquokhcbagofshsclfy';

export const STAGING_CONFIG_KEYS = [
  'AST9_E2E_STAGING_SUPABASE_URL',
  'AST9_E2E_STAGING_SUPABASE_ANON_KEY',
  'AST9_E2E_IDENTITY_MARKER',
];

export const AUTH_CREDENTIAL_KEYS = [
  'AST9_E2E_ADMIN_EMAIL',
  'AST9_E2E_ADMIN_PASSWORD',
  'AST9_E2E_COACH_EMAIL',
  'AST9_E2E_COACH_PASSWORD',
  'AST9_E2E_CLIENT_EMAIL',
  'AST9_E2E_CLIENT_PASSWORD',
  'AST9_E2E_INACTIVE_CLIENT_EMAIL',
  'AST9_E2E_INACTIVE_CLIENT_PASSWORD',
];

function hasValue(env, key) {
  return typeof env[key] === 'string' && env[key].trim().length > 0;
}

export function readStagingConfig(env = process.env) {
  const relevantKeys = [...STAGING_CONFIG_KEYS, ...AUTH_CREDENTIAL_KEYS];
  if (!relevantKeys.some((key) => hasValue(env, key))) return null;

  const missing = relevantKeys.filter((key) => !hasValue(env, key));
  if (missing.length) {
    throw new Error(
      `Authenticated E2E configuration is incomplete. Missing staging keys: ${missing.join(', ')}`
    );
  }

  let url;
  try {
    url = new URL(env.AST9_E2E_STAGING_SUPABASE_URL.trim());
  } catch {
    throw new Error('AST9_E2E_STAGING_SUPABASE_URL must be a valid HTTPS Supabase project URL.');
  }

  const match = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
  if (url.protocol !== 'https:' || !match) {
    throw new Error('AST9_E2E_STAGING_SUPABASE_URL must use https://<project-ref>.supabase.co.');
  }

  const projectRef = match[1];
  if (projectRef === PRODUCTION_SUPABASE_REF) {
    throw new Error('Authenticated E2E is blocked from using the production Supabase project.');
  }

  const anonKey = env.AST9_E2E_STAGING_SUPABASE_ANON_KEY.trim();
  if (anonKey.length < 20 || /\s/.test(anonKey)) {
    throw new Error('AST9_E2E_STAGING_SUPABASE_ANON_KEY is not a valid non-empty anon key.');
  }

  const identityMarker = env.AST9_E2E_IDENTITY_MARKER.trim().toLowerCase();
  if (identityMarker.length < 6) {
    throw new Error('AST9_E2E_IDENTITY_MARKER must contain at least six characters.');
  }

  return {
    url: url.origin,
    anonKey,
    projectRef,
    identityMarker,
  };
}

export function assertSyntheticIdentity(email, marker, role) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes(marker.toLowerCase())) {
    throw new Error(
      `${role} E2E email must contain the configured AST9_E2E_IDENTITY_MARKER.`
    );
  }
}

export function isProductionSupabaseEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return false;
  const hostname = url.hostname.toLowerCase();
  return hostname === `${PRODUCTION_SUPABASE_REF}.supabase.co`
    || hostname === `${PRODUCTION_SUPABASE_REF}.functions.supabase.co`;
}

export function assertLocalAuthenticatedFrontend(baseUrl) {
  if (!baseUrl?.trim()) return;

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('AST9_E2E_BASE_URL must be a valid URL.');
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (!localHosts.has(url.hostname.toLowerCase())) {
    throw new Error(
      'Authenticated staging smoke must use the locally built frontend, not an external site.'
    );
  }
}

export function rewriteLegacySupabaseClient(source, config) {
  const urlPattern = /const SUPABASE_URL\s*=\s*'[^']+';/;
  const anonPattern = /const SUPABASE_ANON\s*=\s*'[^']+';/;

  if (!urlPattern.test(source) || !anonPattern.test(source)) {
    throw new Error('Unable to locate Supabase constants in the built legacy client.');
  }

  const rewritten = source
    .replace(urlPattern, `const SUPABASE_URL  = '${config.url}';`)
    .replace(anonPattern, `const SUPABASE_ANON = '${config.anonKey}';`)
    .replaceAll(PRODUCTION_SUPABASE_REF, config.projectRef);

  if (rewritten.includes(PRODUCTION_SUPABASE_REF)) {
    throw new Error('Production Supabase reference remained in the rewritten E2E client.');
  }

  return rewritten;
}
