import { expect, test } from '@playwright/test';
import { gotoBooking, live, table } from './helpers';

/**
 * Fixture-mode booking picker: Halloween Fest, two days. Fixtures mark B2 (Sat) and C4 (both)
 * as this vendor's paid tables, D4/E5 as taken on Saturday, A3/C5/F1 as taken on Sunday.
 */
test.describe('booking picker', () => {
  test.skip(live, 'fixture-only data; live coverage lives in live.spec.ts');
  // The side panel (cart lines, per-table days, "Already yours") is desktop-only; phones get a
  // bottom sheet with the count, total and rate, covered by the mobile spec below.
  test.skip(({ isMobile }) => !!isMobile, 'desktop panel only');

  test('map shows open, taken, partial and already-booked tables', async ({ page }) => {
    await gotoBooking(page);
    await expect(table(page, 'A4')).toHaveAccessibleName('Table A4, open all days');
    await expect(table(page, 'A1')).toHaveAccessibleName('Table A1, taken');
    await expect(table(page, 'A1')).toBeDisabled();
    await expect(table(page, 'D4')).toHaveAccessibleName('Table D4, open Sun only');
    await expect(table(page, 'A3')).toHaveAccessibleName('Table A3, open Sat only');
    await expect(table(page, 'B2')).toHaveAccessibleName(/^Table B2, yours Sat · open Sun/);
    await expect(table(page, 'C4')).toHaveAccessibleName('Table C4, yours All days');
    await expect(page.getByText('Already yours')).toBeVisible();
    await expect(page.getByText('B2 · Sat, C4 · All days')).toBeVisible();
  });

  test('cart holds several tables; days per table only on request', async ({ page }) => {
    await gotoBooking(page);
    await expect(page.getByText('Nothing picked yet').first()).toBeVisible();

    await table(page, 'A4').click();
    await expect(table(page, 'A4')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Row A · $200/day · All days')).toBeVisible();
    await expect(page.getByText('1 table · 2 table-days')).toBeVisible();

    // D4 is Sunday-only, so it comes in with Sunday alone and no toggles are needed.
    await table(page, 'D4').click();
    await expect(page.getByText('Row D · $200/day · Sun')).toBeVisible();
    await expect(page.getByText('2 tables · 3 table-days')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Days for A4' })).toHaveCount(0);

    // The exception path: per-table toggles appear behind the link.
    await page.getByRole('button', { name: 'Need different days for one table?' }).click();
    const a4Days = page.getByRole('group', { name: 'Days for A4' });
    await expect(a4Days.getByRole('button', { name: 'Sat' })).toHaveAttribute('aria-pressed', 'true');
    const d4Days = page.getByRole('group', { name: 'Days for D4' });
    await expect(d4Days.getByRole('button', { name: 'Sat' })).toBeDisabled();
    await a4Days.getByRole('button', { name: 'Sun' }).click();
    await expect(page.getByText('2 tables · 2 table-days')).toBeVisible();

    // Back to one choice for everything restores all open days.
    await page.getByRole('button', { name: 'Use the same days for every table' }).click();
    await expect(page.getByText('2 tables · 3 table-days')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Days for A4' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Remove D4' }).click();
    await expect(page.getByText('1 table · 2 table-days')).toBeVisible();
    await expect(table(page, 'D4')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the Days chips pick the day for every table and dim the rest of the map', async ({
    page,
  }) => {
    await gotoBooking(page);
    const days = page.getByRole('group', { name: 'Days' });
    await table(page, 'A4').click();
    await days.getByRole('button', { name: 'Sat Oct 24' }).click();
    await expect(table(page, 'D4')).toBeDisabled(); // Sunday-only
    await expect(table(page, 'A3')).toBeEnabled(); // Saturday-only
    await expect(page.getByText('Row A · $200/day · Sat')).toBeVisible();
    await expect(page.getByText('1 table · 1 table-day')).toBeVisible();
    await expect(page.getByText(/open Sat$/)).toBeVisible();

    await days.getByRole('button', { name: 'Sun Oct 25' }).click();
    await expect(table(page, 'D4')).toBeEnabled();
    await expect(table(page, 'A3')).toBeDisabled();
    await table(page, 'D4').click();
    await expect(page.getByText('2 tables · 2 table-days')).toBeVisible();

    await days.getByRole('button', { name: 'Both days' }).click();
    await expect(page.getByText('2 tables · 3 table-days')).toBeVisible();
    await expect(page.getByText('33 tables open')).toBeVisible();
  });

  test('PokéBucks switch halves the subtotal', async ({ page }) => {
    await gotoBooking(page);
    await table(page, 'A4').click();
    const panel = page.getByRole('complementary', { name: 'Your tables' });
    const total = panel.getByText('Total', { exact: true }).locator('..').locator('span').last();
    await expect(total).toHaveText('$400');
    const sw = page.getByRole('switch', { name: /PokéBucks partner rate/ });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(total).toHaveText('$200');
    await expect(page.getByText('Row A · $100/day · All days')).toBeVisible();
  });
});

test.describe('booking picker on a phone', () => {
  test.skip(live, 'fixture-only data; live coverage lives in live.spec.ts');
  test.skip(({ isMobile }) => !isMobile, 'mobile sheet only');

  test('the sheet summarises the cart and expands to the full cart', async ({ page }) => {
    await gotoBooking(page);
    const sheet = page.getByRole('dialog', { name: 'Your tables' });
    await expect(sheet.getByText('Nothing picked yet')).toBeVisible();
    await table(page, 'A4').click();
    await table(page, 'D4').click();
    const handle = sheet.getByRole('button', { name: /2 tables · A4, D4/ });
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    await expect(sheet.getByText(/\$600 total · Standard rate/)).toBeVisible();

    await handle.click();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    await expect(sheet.getByText('Already yours')).toBeVisible();
    await expect(sheet.getByText('Row D · $200/day · Sun')).toBeVisible();
    await sheet.getByRole('switch', { name: /PokéBucks partner rate/ }).click();
    await expect(sheet.getByText(/\$300 total · PokéBucks rate/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Remove D4' }).click();
    await expect(sheet.getByRole('button', { name: /1 table · A4/ })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Continue · \$200/ })).toBeEnabled();
  });
});
