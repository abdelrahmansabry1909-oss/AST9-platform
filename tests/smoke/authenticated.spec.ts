import { test, expect, Page } from '@playwright/test';
import { attachConsoleGuard, assertNoErrors, stubSentry, login } from './helpers';
import {
  assertNoProductionRequests,
  getRoleCredentials,
  getStagingConfig,
  installStagingBackend,
} from './staging';

// Authenticated smoke runs only against a separately configured staging
// Supabase project. The harness rewrites the local built client in memory,
// blocks production Supabase HTTP and WebSocket endpoints, and never persists
// browser state.
// Missing staging configuration skips this project cleanly. Partial or
// production-targeted configuration fails before any login request is sent.
test.describe.configure({ mode: 'serial', retries: 0 });

const STAGING = getStagingConfig();

async function prepare(page: Page) {
  test.skip(!STAGING, 'isolated staging Supabase project is not configured');
  const productionGuard = await installStagingBackend(page, STAGING!);
  const consoleGuard = attachConsoleGuard(page);
  await stubSentry(page);
  return { productionGuard, consoleGuard };
}

function credentials(emailKey: string, passwordKey: string, role: string) {
  test.skip(!STAGING, 'isolated staging Supabase project is not configured');
  return getRoleCredentials(emailKey, passwordKey, role, STAGING!);
}

async function expectRole(page: Page, role: 'admin' | 'coach' | 'client') {
  await expect.poll(
    () => page.evaluate(() => (window as any).Auth?.getProfile?.()?.role || null),
    { timeout: 20_000, message: `expected authenticated staging role ${role}` }
  ).toBe(role);
  await expect(page.locator('body')).toHaveClass(new RegExp(`nc-${role}`));
}

async function expectActiveApp(page: Page, section = '#section-dashboard') {
  await expect(page.locator('#login-form-signin')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#screen-app')).toBeVisible();
  await expect(page.locator(section)).toBeVisible();
  await expect(page).toHaveURL(/app\.html/);
}

test.describe('authenticated staging: admin', () => {
  test('routes the synthetic admin to the authenticated shell', async ({ page }) => {
    const { productionGuard, consoleGuard } = await prepare(page);
    const account = credentials(
      'AST9_E2E_ADMIN_EMAIL',
      'AST9_E2E_ADMIN_PASSWORD',
      'admin'
    );

    await login(page, account.email, account.password);
    await expectActiveApp(page);
    await expectRole(page, 'admin');
    await expect(page.locator('#nav-subscriptions')).toBeVisible();

    assertNoProductionRequests(productionGuard);
    assertNoErrors(consoleGuard);
  });
});

test.describe('authenticated staging: coach', () => {
  test('routes the synthetic coach and preserves real logout behavior', async ({ page }) => {
    const { productionGuard, consoleGuard } = await prepare(page);
    const account = credentials(
      'AST9_E2E_COACH_EMAIL',
      'AST9_E2E_COACH_PASSWORD',
      'coach'
    );

    await login(page, account.email, account.password);
    await expectActiveApp(page);
    await expectRole(page, 'coach');
    await expect(page.locator('#nav-programs')).toBeVisible();

    await page.locator('.logout-icon[title="Sign out"]').click();
    await expect(page).toHaveURL(/index\.html/);

    assertNoProductionRequests(productionGuard);
    assertNoErrors(consoleGuard);
  });
});

test.describe('authenticated staging: active client', () => {
  test('routes the synthetic active client without a landing bounce', async ({ page }) => {
    const { productionGuard, consoleGuard } = await prepare(page);
    const account = credentials(
      'AST9_E2E_CLIENT_EMAIL',
      'AST9_E2E_CLIENT_PASSWORD',
      'client'
    );

    await login(page, account.email, account.password);
    await expectActiveApp(page, '#section-client-dashboard');
    await expectRole(page, 'client');
    await expect(page.locator('#client-mobile-tabs')).toBeAttached();

    assertNoProductionRequests(productionGuard);
    assertNoErrors(consoleGuard);
  });
});

test.describe('authenticated staging: inactive client', () => {
  test('shows the inactive takeover and never redirects to landing', async ({ page }) => {
    const { productionGuard, consoleGuard } = await prepare(page);
    const account = credentials(
      'AST9_E2E_INACTIVE_CLIENT_EMAIL',
      'AST9_E2E_INACTIVE_CLIENT_PASSWORD',
      'inactive client'
    );

    await login(page, account.email, account.password);
    await expect(page.locator('#screen-subscription-inactive')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('#screen-app')).toBeHidden();
    await expect(page).toHaveURL(/app\.html/);

    assertNoProductionRequests(productionGuard);
    assertNoErrors(consoleGuard);
  });
});
