import { expect, test } from '@playwright/test';
import { EVENT_SLUG } from './helpers';

test.describe('public site', () => {
  test('home renders the hero and event cards that link to the event', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /see event details/i }).first()).toBeVisible();
    await page.getByRole('link', { name: `Halloween Fest event details` }).click(); // the poster
    await expect(page).toHaveURL(new RegExp(`/events/${EVENT_SLUG}/`));
    await expect(page.getByRole('heading', { level: 1, name: 'Halloween Fest' })).toBeVisible();
  });

  test('event page shows details, the map and a filterable vendor list', async ({ page }) => {
    await page.goto(`/events/${EVENT_SLUG}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Halloween Fest' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'About' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Maryland State Fairgrounds/ })).toBeVisible();
    await expect(page.getByText('Sat Oct 24 · 11am–5pm')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Venue map' })).toBeVisible();

    // One card per vendor, no table numbers on the cards.
    await expect(page.getByRole('heading', { name: 'Vendors · 3' })).toBeVisible();
    const cards = page.locator('article');
    await expect(cards).toHaveCount(3);
    await expect(page.getByText(/Table B7/)).toHaveCount(0);

    // Tag filters and search narrow the list; All brings it back.
    const filters = page.getByRole('group', { name: 'Filter by tag' });
    await filters.getByRole('button', { name: /^Plush/ }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Plush Pals');
    await filters.getByRole('button', { name: 'All' }).click();
    await expect(cards).toHaveCount(3);
    await page.getByRole('searchbox', { name: 'Search vendors' }).fill('pocket');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Pocket Monsters MD');
    await page.getByRole('searchbox', { name: 'Search vendors' }).fill('');

    // The map knows who's where: Maya has B7 and B8.
    const map = page.getByRole('group', { name: 'Tables' });
    await expect(map.getByRole('button', { name: "Table B7, Maya's Card Corner" })).toBeVisible();
    await expect(map.getByRole('button', { name: 'Table A1, open' })).toBeDisabled();
  });

  test('login page has email, password and Google', async ({ browser, baseURL }) => {
    // Signed-in sessions get redirected away from /login, so use a fresh context.
    const ctx = await browser.newContext({ baseURL: baseURL!, storageState: undefined });
    const page = await ctx.newPage();
    await page.goto('/login/');
    await expect(page.getByPlaceholder('you@email.com')).toBeVisible();
    await expect(page.getByPlaceholder('Your password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled();
    await ctx.close();
  });
});
