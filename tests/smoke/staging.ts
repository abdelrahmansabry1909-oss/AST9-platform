import { expect, Page } from '@playwright/test';
import {
  assertLocalAuthenticatedFrontend,
  assertSyntheticIdentity,
  isProductionSupabaseEndpoint,
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

export function getStagingConfig(): StagingConfig | null {
  const config = readStagingConfig(process.env);
  if (config) assertLocalAuthenticatedFrontend(process.env.AST9_E2E_BASE_URL);
  return config;
}

export function getRoleCredentials(
  emailKey: string,
  passwordKey: string,
  role: string,
  config: StagingConfig
) {
  const email = process.env[emailKey]?.trim() || '';
  const password = process.env[passwordKey]?.trim() || '';
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
  const recordProductionEndpoint = (url: string) => {
    if (isProductionSupabaseEndpoint(url)) guard.requests.push(url);
  };

  page.on('request', (request) => {
    recordProductionEndpoint(request.url());
  });
  page.on('websocket', (websocket) => recordProductionEndpoint(websocket.url()));

  await page.route(
    (url) => isProductionSupabaseEndpoint(url.href),
    (route) => route.abort('blockedbyclient')
  );
  await page.routeWebSocket(
    (url) => isProductionSupabaseEndpoint(url.href),
    async (websocket) => {
      recordProductionEndpoint(websocket.url());
      await websocket.close({
        code: 1008,
        reason: 'Production Supabase is blocked in authenticated staging smoke.',
      });
    }
  );

  await page.route(/\/js\/(?:supabaseClient|visitor)\.js(?:\?.*)?$/i, async (route) => {
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
