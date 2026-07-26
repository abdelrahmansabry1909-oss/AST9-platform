import { defineConfig, devices } from '@playwright/test';

// ── AST9 smoke-test config (P1F-1) ───────────────────────────────
// Minimal browser smoke net. Chromium only. Runs against the BUILT bundle
// served under the production base `/AST9_HUB/` by a tiny static server
// (vite preview can't serve the base — see tests/smoke/serve-dist.mjs), or
// Public smoke can run against an external URL via AST9_E2E_BASE_URL. When
// authenticated staging is configured, the safety harness requires this local
// built frontend instead of an external site.
//
// PRIVACY: the authenticated project runs only against an isolated staging
// backend and keeps trace/screenshot/video fully OFF. CI does not upload
// Playwright reports or test-results, so authenticated failure context remains
// ephemeral on the runner. The staging harness blocks production Supabase HTTP
// and WebSocket endpoints. Public pages carry no user data.

const PORT = 4173;
const BASE_URL = process.env.AST9_E2E_BASE_URL || `http://localhost:${PORT}/AST9_HUB/`;
const useExternalServer = !!process.env.AST9_E2E_BASE_URL;
const chrome = devices['Desktop Chrome'];

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'public',
      testMatch: /public\.spec\.ts/,
      use: { ...chrome, trace: 'on-first-retry', screenshot: 'only-on-failure', video: 'off' },
    },
    {
      // Authenticated staging specs: NO trace/screenshot/video. The auth POST
      // body carries the password and even synthetic account pages should not
      // be persisted as test artifacts.
      name: 'authenticated',
      testMatch: /authenticated\.spec\.ts/,
      use: { ...chrome, trace: 'off', screenshot: 'off', video: 'off' },
    },
  ],
  webServer: useExternalServer ? undefined : {
    command: `npm run build && node tests/smoke/serve-dist.mjs ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
