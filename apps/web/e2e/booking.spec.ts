import { type Page, expect, test } from '@playwright/test';
import { gotoBooking, live, table } from './helpers';

/**
 * Fixture-mode booking picker: Halloween Fest, two days. Fixtures mark B2 (Sat) and C4 (both)
 * as this vendor's paid tables, D4/E5 as taken on Saturday, A3/C5/F1 as taken on Sunday.
 */
/** Tap a table, confirm its days in the popover, add it. */
async function addTable(page: Page, id: string, days?: string[]) {
  await table(page, id).click();
  const dlg = page.getByRole('dialog', { name: `Table ${id}` });
  if (days) {
    for (const d of ['Sat Oct 24', 'Sun Oct 25']) {
      const box = dlg.getByRole('checkbox', { name: d });
      if ((await box.isChecked()) !== days.includes(d)) await box.click();
    }
  }
  await dlg.getByRole('button', { name: 'Add to cart' }).click();
  await expect(dlg).toHaveCount(0);
}

test.describe('booking picker', () => {
  test.skip(live, 'fixture-only data; live coverage lives in live.spec.ts');
  test.skip(({ isMobile }) => !!isMobile, 'desktop panel and popover only');

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

  test('tapping a table asks for its days before it joins the cart', async ({ page }) => {
    await gotoBooking(page);
    await expect(page.getByText('Nothing picked yet').first()).toBeVisible();

    await table(page, 'A4').click();
    const dlg = page.getByRole('dialog', { name: 'Table A4' });
    await expect(dlg.getByText('Row A · $200/day')).toBeVisible();
    const sat = dlg.getByRole('checkbox', { name: 'Sat Oct 24' });
    const sun = dlg.getByRole('checkbox', { name: 'Sun Oct 25' });
    await expect(sat).toBeChecked();
    await expect(sun).toBeChecked();
    await expect(dlg.getByText('2 days · $400')).toBeVisible();
    await expect(table(page, 'A4')).toHaveAttribute('aria-pressed', 'false'); // not yet

    await sun.click();
    await expect(dlg.getByText('1 day · $200')).toBeVisible();
    await sat.click();
    await expect(dlg.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    await sat.click();
    await dlg.getByRole('button', { name: 'Add to cart' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(table(page, 'A4')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('1 table · 1 table-day')).toBeVisible();

    // D4 is Sunday-only: Saturday is disabled and marked taken.
    await table(page, 'D4').click();
    const d4 = page.getByRole('dialog', { name: 'Table D4' });
    await expect(d4.getByRole('checkbox', { name: /Sat Oct 24/ })).toBeDisabled();
    await expect(d4.getByText('taken')).toBeVisible();
    await expect(d4.getByRole('checkbox', { name: 'Sun Oct 25' })).toBeChecked();
    await d4.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByText('2 tables · 2 table-days')).toBeVisible();

    // Days stay editable on the cart line; tapping a picked table reopens it with Update/Remove.
    const a4Days = page.getByRole('group', { name: 'Days for A4' }).last();
    await a4Days.getByRole('button', { name: 'Sun' }).click();
    await expect(page.getByText('2 tables · 3 table-days')).toBeVisible();
    await table(page, 'A4').click();
    const again = page.getByRole('dialog', { name: 'Table A4' });
    await expect(again.getByRole('checkbox', { name: 'Sun Oct 25' })).toBeChecked();
    await expect(again.getByRole('button', { name: 'Update' })).toBeVisible();
    await again.getByRole('button', { name: 'Remove' }).click();
    await expect(table(page, 'A4')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('1 table · 1 table-day')).toBeVisible();

    // Escape closes the popover without adding.
    await table(page, 'C3').click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Table C3' })).toHaveCount(0);
    await expect(page.getByText('1 table · 1 table-day')).toBeVisible();
  });

  test('Available checkboxes filter the map and seed the day picker', async ({ page }) => {
    await gotoBooking(page);
    const show = page.getByRole('group', { name: 'Available days' });
    const sat = show.getByRole('checkbox', { name: 'Sat Oct 24' });
    const sun = show.getByRole('checkbox', { name: 'Sun Oct 25' });
    await expect(sat).toBeChecked();
    await expect(sun).toBeChecked();

    await sun.click();
    await expect(table(page, 'D4')).toBeDisabled(); // Sunday-only
    await expect(table(page, 'A3')).toBeEnabled(); // Saturday-only
    await expect(page.getByText(/open Sat$/)).toBeVisible();
    await table(page, 'A4').click();
    const dlg = page.getByRole('dialog', { name: 'Table A4' });
    await expect(dlg.getByRole('checkbox', { name: 'Sat Oct 24' })).toBeChecked();
    await expect(dlg.getByRole('checkbox', { name: 'Sun Oct 25' })).not.toBeChecked();
    await dlg.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByText('1 table · 1 table-day')).toBeVisible();

    // The last checked day can't be turned off.
    await sat.click();
    await expect(sat).toBeChecked();

    await sun.click();
    await sat.click();
    await expect(table(page, 'D4')).toBeEnabled();
    await expect(table(page, 'A3')).toBeDisabled();
    await sat.click();
    await expect(page.getByText('33 tables open')).toBeVisible();
  });

  test('PokéBucks switch halves the subtotal', async ({ page }) => {
    await gotoBooking(page);
    await addTable(page, 'A4');
    const panel = page.getByRole('complementary', { name: 'Your tables' });
    const total = panel.getByText('Total', { exact: true }).locator('..').locator('span').last();
    await expect(total).toHaveText('$400');
    const sw = page.getByRole('switch', { name: /PokéBucks partner rate/ });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(total).toHaveText('$200');
    await expect(page.getByText('Row A · $100/day')).toBeVisible();
  });
});

test.describe('booking picker on a phone', () => {
  test.skip(live, 'fixture-only data; live coverage lives in live.spec.ts');
  test.skip(({ isMobile }) => !isMobile, 'mobile sheet only');

  test('the sheet asks for days, then summarises the cart and expands to it', async ({ page }) => {
    await gotoBooking(page);
    await expect(page.getByText('Already yours')).toBeVisible(); // strip above the map
    const sheet = page.getByRole('dialog', { name: 'Your tables' });
    await expect(sheet.getByText('Nothing picked yet')).toBeVisible();

    await table(page, 'A4').click();
    const dlg = sheet.getByRole('dialog', { name: 'Table A4' });
    await expect(dlg.getByRole('checkbox', { name: 'Sun Oct 25' })).toBeChecked();
    await dlg.getByRole('button', { name: 'Add to cart' }).click();
    await addTable(page, 'D4');

    const handle = sheet.getByRole('button', { name: /2 tables · A4, D4/ });
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    await expect(sheet.getByText(/\$600 total · Standard rate/)).toBeVisible();

    await handle.click();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    await expect(sheet.getByRole('group', { name: 'Days for D4' })).toBeVisible();
    await sheet.getByRole('switch', { name: /PokéBucks partner rate/ }).click();
    await expect(sheet.getByText(/\$300 total · PokéBucks rate/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Remove D4' }).click();
    await expect(sheet.getByRole('button', { name: /1 table · A4/ })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Continue · \$200/ })).toBeEnabled();
  });
});

test.describe('payment step', () => {
  test.skip(live, 'fixture-only data; holds would be real on dev');
  test.skip(({ isMobile }) => !!isMobile, 'desktop panel only');

  test('continue holds the tables and lands on Pay with info prefilled', async ({ page }) => {
    await gotoBooking(page);
    await addTable(page, 'A4');
    await page
      .getByRole('complementary', { name: 'Your tables' })
      .getByRole('button', { name: /^Continue · \$400/ })
      .click();

    const steps = page.getByRole('list', { name: 'Booking progress' });
    await expect(steps.getByRole('listitem')).toHaveText(['✓', '2 PAY', '3 DONE']);
    await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible();
    await expect(page.getByText('Total due today')).toBeVisible();

    // Info comes from the profile as a card, not a form.
    const info = page.getByRole('region', { name: 'Your info' });
    await expect(info.getByText('Table sign')).toBeVisible();
    await expect(info.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'vendor code of conduct' })).toBeVisible();

    // Edit opens the fields in place; Save closes them with the new value.
    await info.getByRole('button', { name: 'Edit' }).click();
    const name = info.getByPlaceholder("Maya's Card Corner");
    await name.fill('');
    await info.getByRole('button', { name: 'Save' }).click();
    await expect(info.getByText('What should we print on your table sign?')).toBeVisible();
    await name.fill('Pocket Monsters MD');
    await info.getByRole('button', { name: 'Save' }).click();
    await expect(info.getByText('Pocket Monsters MD')).toBeVisible();
    await expect(info.getByRole('textbox')).toHaveCount(0);

    // Back lands on an editable map: the held table stays in the cart, more can be added.
    await page.getByRole('button', { name: '← Back to tables' }).click();
    await expect(page.getByRole('heading', { name: 'Pick your tables' })).toBeVisible();
    await expect(table(page, 'A4')).toHaveAttribute('aria-pressed', 'true');
    await expect(table(page, 'A4')).toBeEnabled();
    await expect(page.getByText('Still held for you').filter({ visible: true })).toBeVisible();
    await addTable(page, 'C3');
    await expect(page.getByText('2 tables · 4 table-days')).toBeVisible();
    await page
      .getByRole('complementary', { name: 'Your tables' })
      .getByRole('button', { name: /^Continue · \$800/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible();
    await expect(page.getByText('Tables A4, C3', { exact: false })).toBeVisible();
    // The edited table sign survived the re-hold.
    await expect(
      page.getByRole('region', { name: 'Your info' }).getByText('Pocket Monsters MD'),
    ).toBeVisible();
  });
});
