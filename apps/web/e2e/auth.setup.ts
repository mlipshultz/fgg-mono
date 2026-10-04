import { test as setup, expect } from '@playwright/test';

const STATE = 'e2e/.auth/smoke.json';

/**
 * Live mode only: sign in once with the smoke account (superadmin + staff + vendor) through the
 * site's own login form, then save the Amplify session (localStorage) for every other test.
 */
setup('sign in as the smoke account', async ({ page }) => {
  const email = process.env.DEV_SMOKE_EMAIL;
  const password = process.env.DEV_SMOKE_PASSWORD;
  expect(
    email && password,
    'Set DEV_SMOKE_EMAIL and DEV_SMOKE_PASSWORD (repo-root .env.dev-smoke) for live runs',
  ).toBeTruthy();
  await page.goto('/login/');
  await page.getByPlaceholder('you@email.com').fill(email!);
  await page.getByPlaceholder('Your password').fill(password!);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/dashboard\/?$/);
  await expect(page.getByRole('navigation', { name: 'Dashboard' })).toBeVisible();
  await page.context().storageState({ path: STATE });
});
