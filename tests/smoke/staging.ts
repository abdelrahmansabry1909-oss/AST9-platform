import { expect, Page } from '@playwright/test';
import {
  PRODUCTION_SUPABASE_REF,
  assertSyntheticIdentity,
  readStagingConfig,
  rewriteLegacySupabaseClient,
} from './staging-target.mjs';

export interface StagingConfig {
  url: string;
  anonKey: string;
  projectRef: string;
  identityMarker: string;
}

export interface ProductionRequestGuard {
  requests: string[];
}

const PRODUCTION_REQUEST =
  new RegExp(`^https://${PRODUCTION_SUPABASE_REF}(?:\\.functions)?\\.supabase\\.co/`, 'i');

export function getStagingConfig(): StagingConfig | null {
  return readStagingConfig(process.env);
}

export function getRoleCredentials(
  emailKey: string,
  passwordKey: string,
  role: string,
  config: StagingConfig
) {
  const email = process.env[emailKey]?.trim() || '';
  const password = process.env[passwordKey]?.trim() || '';
  if (!email && !password) return null;
  if (!email || !password) {
    throw new Error(`${role} staging credentials are incomplete.`);
  }

  assertSyntheticIdentity(email, config.identityMarker, role);
  return { email, password };
}

export async function installStagingBackend(
  page: Page,
  config: StagingConfig
): Promise<ProductionRequestGuard> {
  const guard: ProductionRequestGuard = { requests: [] };

  page.on('request', (request) => {
    if (PRODUCTION_REQUEST.test(request.url())) guard.requests.push(request.url());
  });

  await page.route(PRODUCTION_REQUEST, (route) => route.abort('blockedbyclient'));

  await page.route(/\/js\/supabaseClient\.js(?:\?.*)?$/i, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const body = rewriteLegacySupabaseClient(source, config);
    await route.fulfill({ response, body });
  });

  return guard;
}

export function assertNoProductionRequests(guard: ProductionRequestGuard) {
  expect(
    guard.requests,
    'Authenticated staging smoke attempted to contact production Supabase.'
  ).toEqual([]);
}
