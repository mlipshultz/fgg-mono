import { expect, test } from '@playwright/test';
import { live, url } from './helpers';

test.describe('vendor dashboard', () => {
  test.skip(live, 'fixture-only data; live coverage lives in live.spec.ts');

  test('shows Your Brand and upcoming shows with days per table', async ({ page }) => {
    await page.goto(url('/vendor/'));
    await expect(page.getByRole('navigation', { name: 'Vendor' })).toBeVisible();
    await expect(page.getByText('Your Brand').first()).toBeVisible();
    // Fixture paid order: B2 on Saturday, C4 both days.
    await expect(page.getByText(/B2 · Sat/).first()).toBeVisible();
    await expect(page.getByText(/C4 · Sat \+ Sun/).first()).toBeVisible();
  });

  test('booking without an event goes back to the dashboard', async ({ page }) => {
    await page.goto(url('/vendor/book/'));
    // The redirect drops the query, so in fixture mode the gate then bounces to /login; the
    // URL hop to /vendor is what we're checking here.
    await page.waitForURL(/\/vendor\/?(\?.*)?$/);
  });
});
