import { test, expect } from '@playwright/test';
import { attachConsoleGuard, assertNoErrors, stubSentry } from './helpers';

// ── Public smoke: no credentials required ────────────────────────

test.describe('landing', () => {
  test('loads with brand + no page errors', async ({ page }) => {
    const guard = attachConsoleGuard(page);
    await page.goto('');                                   // baseURL = /AST9_HUB/
    await expect(page).toHaveTitle(/NeuCore/i);
    await expect(page.locator('body')).toContainText(/NeuCore/i);
    assertNoErrors(guard);
  });
});

test.describe('app boot router', () => {
  // The PR #53 landing-bounce regression class: a no-session visit to app.html
  // must redirect to the landing page, and ?login=1 must NOT redirect.
  test('bare app.html (no session) redirects to landing', async ({ page }) => {
    await stubSentry(page);
    await page.goto('app.html');
    await page.waitForURL(/index\.html(\?|#|$)/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/AST9_HUB\/index\.html/);
  });

  test('app.html?login=1 stays on the login screen (no bounce)', async ({ page }) => {
    await stubSentry(page);
    await page.goto('app.html?login=1');
    await expect(page.locator('#login-form-signin')).toBeVisible();
    await expect(page).toHaveURL(/app\.html/);
  });
});

test.describe('app login screen', () => {
  test('shows the sign-in form and stops loading', async ({ page }) => {
    const guard = attachConsoleGuard(page);
    await stubSentry(page);
    await page.goto('app.html?login=1');
    await expect(page.locator('#login-form-signin')).toBeVisible();
    await expect(page.locator('#nc-login-tab-signin')).toContainText(/sign in/i);
    await expect(page.locator('#login-email')).toBeVisible();
    // No infinite spinner: the boot resolves and removes the loading overlay.
    await expect(page.locator('#loading-overlay')).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(/isolated test window/i)).toBeVisible();
    assertNoErrors(guard);
  });
});

test.describe('legal pages', () => {
  const PAGES = [
    'terms', 'privacy', 'medical-disclaimer',
    'health-data-consent', 'refund-policy', 'cookie-policy',
  ];
  for (const slug of PAGES) {
    test(`loads: ${slug}`, async ({ page }) => {
      const resp = await page.goto(`legal/${slug}.html`);
      expect(resp?.status(), `${slug}.html HTTP status`).toBe(200);
      const body = (await page.locator('body').innerText()).trim();
      expect(body.length, `${slug}.html visible text`).toBeGreaterThan(50);
    });
  }
});

test.describe('sentry shell safety', () => {
  test('live Sentry shell initializes without breaking boot', async ({ page }) => {
    const guard = attachConsoleGuard(page);
    await stubSentry(page);
    await page.goto('app.html?login=1');
    // App booted to the login screen ⇒ Sentry init did not break boot.
    await expect(page.locator('#login-form-signin')).toBeVisible();
    // The pinned CDN bundle loaded AND init() actually ran (client exists).
    // We never read the DSN value.
    const clientReady = await page.evaluate(() => {
      const S = (window as unknown as { Sentry?: { getClient?: () => unknown } }).Sentry;
      return !!(S && typeof S.getClient === 'function' && S.getClient());
    });
    expect(clientReady, 'Sentry client should be initialized').toBe(true);
    assertNoErrors(guard);
  });
});
