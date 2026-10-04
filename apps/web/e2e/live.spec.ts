import { expect, test } from '@playwright/test';
import { EVENT_SLUG, gotoBooking, table } from './helpers';

/**
 * Runs only with E2E_BASE_URL (pnpm e2e:dev). Uses the smoke account, which is superadmin,
 * staff and vendor, and in dev holds order HF26-001 (B7, both days of Halloween Fest).
 * Read-only: nothing here holds, pays or edits.
 */
test.describe('live dev @live', () => {
  test('dashboard loads for the signed-in account', async ({ page }) => {
    await page.goto('/dashboard/');
    await expect(page.getByRole('navigation', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('vendor dashboard shows the brand card', async ({ page }) => {
    await page.goto('/vendor/');
    await expect(page.getByRole('navigation', { name: 'Vendor' })).toBeVisible();
    await expect(page.getByText('Your Brand').first()).toBeVisible();
  });

  test('booking map marks the account’s own tables', async ({ page }) => {
    await gotoBooking(page);
    await expect(table(page, 'B7')).toHaveAccessibleName(/^Table B7, yours/);
    await expect(page.getByText('Already yours')).toBeVisible(); // strip above the map
  });

  test('event page renders with its vendor list', async ({ page }) => {
    await page.goto(`/events/${EVENT_SLUG}/`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Vendors/ })).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('admin orders list opens for staff', async ({ page }) => {
    await page.goto('/admin/orders/');
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await expect(page.getByLabel('Filter by event')).toBeVisible();
  });
});
