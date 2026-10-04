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

  test('cart holds several tables with their own days and totals them', async ({ page }) => {
    await gotoBooking(page);
    await expect(page.getByText('Pick your tables').first()).toBeVisible();

    await table(page, 'A4').click();
    await expect(table(page, 'A4')).toHaveAttribute('aria-pressed', 'true');
    const a4Days = page.getByRole('group', { name: 'Days for A4' });
    await expect(a4Days.getByRole('button', { name: 'Sat' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(a4Days.getByRole('button', { name: 'Sun' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('1 table · 2 table-days')).toBeVisible();

    await table(page, 'D4').click();
    const d4Days = page.getByRole('group', { name: 'Days for D4' });
    await expect(d4Days.getByRole('button', { name: 'Sat' })).toBeDisabled();
    await expect(d4Days.getByRole('button', { name: 'Sun' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('2 tables · 3 table-days')).toBeVisible();

    // Drop Sunday from A4: one day each.
    await a4Days.getByRole('button', { name: 'Sun' }).click();
    await expect(page.getByText('2 tables · 2 table-days')).toBeVisible();

    await page.getByRole('button', { name: 'Remove D4' }).click();
    await expect(page.getByText('1 table · 1 table-day')).toBeVisible();
    await expect(table(page, 'D4')).toHaveAttribute('aria-pressed', 'false');
  });

  test('"Open on" filter dims tables not open that day', async ({ page }) => {
    await gotoBooking(page);
    const filter = page.getByRole('group', { name: 'Show tables open on' });
    await filter.getByRole('button', { name: 'Sat' }).click();
    await expect(table(page, 'D4')).toBeDisabled(); // Sunday-only
    await expect(table(page, 'A3')).toBeEnabled(); // Saturday-only
    await filter.getByRole('button', { name: 'Sun' }).click();
    await expect(table(page, 'D4')).toBeEnabled();
    await expect(table(page, 'A3')).toBeDisabled();
  });

  test('PokéBucks rate halves the subtotal', async ({ page }) => {
    await gotoBooking(page);
    await table(page, 'A4').click();
    const total = page.locator('text=Total').locator('..').locator('span').last();
    await expect(total).toHaveText('$400');
    await page.getByRole('button', { name: /PokéBucks partner/ }).click();
    await expect(total).toHaveText('$200');
  });
});

test.describe('booking picker on a phone', () => {
  test.skip(live, 'fixture-only data; live coverage lives in live.spec.ts');
  test.skip(({ isMobile }) => !isMobile, 'mobile sheet only');

  test('the sheet tracks the cart count, total and rate', async ({ page }) => {
    await gotoBooking(page);
    const sheet = page.getByRole('dialog', { name: 'Your tables' });
    await expect(sheet.getByText('Pick your tables')).toBeVisible();
    await table(page, 'A4').click();
    await expect(sheet.getByText(/^1 table · /)).toBeVisible();
    await expect(sheet.getByText('$400 total')).toBeVisible();
    await sheet.getByRole('button', { name: /PokéBucks/ }).click();
    await expect(sheet.getByText('$200 total')).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Hold 1 table · \$200/ })).toBeEnabled();
  });
});
