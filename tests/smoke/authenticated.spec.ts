import { test, expect } from '@playwright/test';
import { attachConsoleGuard, assertNoErrors, stubSentry, missingEnv, login } from './helpers';

// ── Authenticated smoke: credential-gated ────────────────────────
// Runs ONLY when the matching env vars are set (locally or via CI secrets).
// When absent it skips cleanly — never fails — so the public suite stays green
// where no test accounts exist (see NOT_A_BUG.md #4). Credentials are never
// printed and storageState is never persisted. The project runs with
// trace/screenshot/video OFF (see playwright.config.ts) so the password (auth
// POST body) and post-login client data never reach disk.
//
// Serial + no retries: never race parallel logins to the same account and never
// double prod-auth traffic on a real login failure (which is signal, not flake).
//
// Deeper, fixture-dependent checks (opening a client's program, the video-modal
// close regression, the inactive-client subscription gate) are intentionally
// NOT here: they couple to mutable/real prod data and would make CI cry wolf.
// They stay manual until a staging-backed seeded account exists (see RUNBOOK).
test.describe.configure({ mode: 'serial', retries: 0 });

const COACH = ['AST9_E2E_COACH_EMAIL', 'AST9_E2E_COACH_PASSWORD'];
const CLIENT = ['AST9_E2E_CLIENT_EMAIL', 'AST9_E2E_CLIENT_PASSWORD'];

test.describe('authenticated: coach', () => {
  test('logs in and reaches the app (no landing bounce, no crash)', async ({ page }) => {
    const miss = missingEnv(COACH);
    test.skip(miss.length > 0, `coach E2E creds not configured: ${miss.join(', ')}`);
    const guard = attachConsoleGuard(page);
    await stubSentry(page);
    await login(page, process.env.AST9_E2E_COACH_EMAIL!, process.env.AST9_E2E_COACH_PASSWORD!);
    // Auth resolved: the sign-in form is replaced by the app shell or the
    // legal-acceptance gate — either way the login form is gone.
    await expect(page.locator('#login-form-signin')).toBeHidden({ timeout: 20_000 });
    await expect(page.locator('#login-error')).toBeHidden();
    await expect(page).toHaveURL(/app\.html/);            // must NOT bounce to index.html
    assertNoErrors(guard);
  });
});

test.describe('authenticated: client', () => {
  test('logs in and stays in the app shell (no landing bounce)', async ({ page }) => {
    const miss = missingEnv(CLIENT);
    test.skip(miss.length > 0, `client E2E creds not configured: ${miss.join(', ')}`);
    const guard = attachConsoleGuard(page);
    await stubSentry(page);
    await login(page, process.env.AST9_E2E_CLIENT_EMAIL!, process.env.AST9_E2E_CLIENT_PASSWORD!);
    await expect(page.locator('#login-form-signin')).toBeHidden({ timeout: 20_000 });
    await expect(page).toHaveURL(/app\.html/);            // client must not be bounced to landing
    assertNoErrors(guard);
  });
});
