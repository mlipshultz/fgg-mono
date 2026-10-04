import { expect, test } from '@playwright/test';
import { EVENT_SLUG } from './helpers';

test.describe('public site', () => {
  test('home renders the hero and event cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /see who.s vending/i }).first()).toBeVisible();
  });

  test('event page lists who is vending', async ({ page }) => {
    await page.goto(`/events/${EVENT_SLUG}/`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const vendors = page.getByRole('heading', { level: 2 });
    await expect(vendors.first()).toBeVisible();
    expect(await vendors.count()).toBeGreaterThan(0);
  });

  test('login page has email, password and Google', async ({ page }) => {
    await page.goto('/login/');
    await expect(page.getByPlaceholder('you@email.com')).toBeVisible();
    await expect(page.getByPlaceholder('Your password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled();
  });
});
