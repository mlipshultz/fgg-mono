import { expect, test } from '@playwright/test';
import { live, url } from './helpers';

test.describe('admin vendors', () => {
  test.skip(live, 'fixture-only: would edit real vendors on dev');

  test('lists vendors, filters them, and edits one on its behalf', async ({ page }) => {
    await page.goto(url('/admin/vendors/'));
    await expect(page.getByRole('heading', { level: 1, name: 'Vendors' })).toBeVisible();
    const row = (name: string) => page.getByRole('row').filter({ hasText: name });
    await expect(row('Pocket Monsters MD')).toContainText('2 members · PokéBucks partner');
    await expect(row('Plush Pals')).toContainText('Suspended');

    await page.getByLabel('Filter by status').selectOption('suspended');
    await expect(row("Maya's Card Corner")).toHaveCount(0);
    await page.getByLabel('Filter by status').selectOption('');
    await page.getByLabel('Search vendors').fill('plush');
    await expect(page.getByRole('row')).toHaveCount(2); // header + Plush Pals
    await page.getByLabel('Search vendors').fill('');

    await page.getByRole('button', { name: "Edit Maya's Card Corner" }).click();
    await page.getByLabel('Phone').fill('4105550199');
    await page.getByRole('group', { name: 'Tags' }).getByLabel('Sealed', { exact: true }).check();
    await page.getByLabel(/^PokéBucks partner/).check();
    await page.getByLabel('Status').selectOption('suspended');
    await page.getByRole('button', { name: 'Save vendor' }).click();
    await expect(page.getByText("Saved Maya's Card Corner.")).toBeVisible();
    await expect(row("Maya's Card Corner")).toContainText('Suspended');
    await expect(row("Maya's Card Corner")).toContainText('PokéBucks partner');

    await page.getByRole('button', { name: "Edit Maya's Card Corner" }).click();
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Save vendor' }).click();
    await expect(page.getByText('Enter a valid email.')).toBeVisible();
  });

  test('saves other changes for a vendor with no store description', async ({ page }) => {
    await page.goto(url('/admin/vendors/'));
    await page.getByRole('button', { name: 'Edit Plush Pals' }).click();
    await page.getByLabel('About the store').fill('');
    await page.getByLabel('Phone').fill('4105550123');
    await page.getByRole('button', { name: 'Save vendor' }).click();
    await expect(page.getByText('Saved Plush Pals.')).toBeVisible();
  });
});
