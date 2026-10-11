import { expect, test } from '@playwright/test';
import { live, url } from './helpers';

/**
 * Fixture-mode booking for an event with no floor plan: Winter Fest books by number of tables,
 * with 12 left on Saturday and 3 on Sunday.
 */
const SLUG = 'winter-fest-2027';

test.describe('booking by number of tables', () => {
  test.skip(live, 'fixture-only data');

  test('each day has its own number of tables, then both go to payment as separate lines', async ({
    page,
  }) => {
    await page.goto(url('/vendor/book/', { event: SLUG }));
    await expect(page.getByRole('heading', { name: 'How many tables?' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Tables', exact: true })).toHaveCount(0);

    const sat = page.getByRole('group', { name: 'Tables for Sat Jan 23' });
    const sun = page.getByRole('group', { name: 'Tables for Sun Jan 24' });
    await expect(sat.getByText('12 left · $200 each')).toBeVisible();
    await expect(sun.getByText('3 left · $200 each')).toBeVisible();
    // One table each day to start.
    await expect(sat.getByRole('status')).toHaveText('1');
    await expect(sun.getByRole('status')).toHaveText('1');
    await expect(page.getByRole('button', { name: 'Continue · $400 →' })).toBeVisible();

    // Saturday goes up on its own; Sunday stops at its 3.
    await sat.getByRole('button', { name: 'More tables for Sat Jan 23' }).click();
    await expect(sat.getByRole('status')).toHaveText('2');
    await expect(sat.getByText('$400', { exact: true })).toBeVisible();
    await expect(sun.getByRole('status')).toHaveText('1');
    const moreSun = sun.getByRole('button', { name: 'More tables for Sun Jan 24' });
    await moreSun.click();
    await moreSun.click();
    await expect(moreSun).toBeDisabled();

    // A day at zero isn't booked; with nothing on either day there's nothing to continue with.
    const fewerSun = sun.getByRole('button', { name: 'Fewer tables for Sun Jan 24' });
    for (let i = 0; i < 3; i++) await fewerSun.click();
    await expect(fewerSun).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Continue · $400 →' })).toBeVisible();
    await moreSun.click();

    await page.getByRole('button', { name: 'Continue · $600 →' }).click();
    await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible();
    await expect(page.getByText('Sat Jan 23 · 2 tables × $200')).toBeVisible();
    await expect(page.getByText('Sun Jan 24 · 1 table × $200')).toBeVisible();
    await expect(page.getByText('Total due today')).toBeVisible();
  });

  test('the event page has no venue map or Find on map', async ({ page }) => {
    await page.goto(`/events/${SLUG}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Winter Fest' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vendors' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Venue map' })).toHaveCount(0);
  });
});
