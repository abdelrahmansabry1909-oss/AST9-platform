import { Page, expect } from '@playwright/test';

// ── Console / page-error guard ───────────────────────────────────
// Hard-fail on any uncaught page error (a real JS crash) and on any
// console.error EXCEPT a tight, justified benign allow-list. Keep the
// allow-list narrow — broad allow-listing defeats the smoke.
export const BENIGN_CONSOLE: RegExp[] = [
  /favicon/i,                       // optional favicon 404 ("Failed to load resource … favicon")
  /ingest\.[a-z]+\.sentry\.io/i,    // Sentry ingest rejected on non-prod origin (belt; normally stubbed)
];

export interface Collected { errors: string[]; }

export function attachConsoleGuard(page: Page): Collected {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!BENIGN_CONSOLE.some((re) => re.test(text))) errors.push(`console.error: ${text}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err?.message || String(err)}`);
  });
  return { errors };
}

export function assertNoErrors(c: Collected) {
  expect(c.errors, `unexpected page/console errors:\n${c.errors.join('\n')}`).toEqual([]);
}

// Sentry ingest is rejected on non-prod origins (project Allowed-Domains = the
// Pages origin). Fulfill it locally so the SDK's boot session/report envelopes
// don't produce console noise or failed-request errors. We never read the DSN.
export async function stubSentry(page: Page) {
  await page.route(/ingest\.[a-z]+\.sentry\.io/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
}

// ── Login helper (authenticated specs only) ──────────────────────
// Uses ?login=1 so the no-session router shows the login screen instead of
// redirecting to the landing page. Never logs the credentials.
export async function login(page: Page, email: string, password: string) {
  await page.goto('app.html?login=1');
  await expect(page.locator('#login-form-signin')).toBeVisible();
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#login-btn');
}
