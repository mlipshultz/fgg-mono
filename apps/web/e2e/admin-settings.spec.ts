import { expect, test } from '@playwright/test';
import { live, url } from './helpers';

test.describe('admin settings', () => {
  test.skip(live, 'fixture-only: would change real settings on dev');

  test('shows the current settings, validates, and saves changes', async ({ page }) => {
    await page.goto(url('/admin/settings/'));
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    const hold = page.getByLabel('Hold while booking (minutes)');
    await expect(hold).toHaveValue('10');
    await expect(page.getByLabel('Hold during checkout (minutes)')).toHaveValue('10');
    await expect(page.getByLabel('Refund cutoff (days before the show)')).toHaveValue('14');
    await expect(page.getByLabel('Calendly link')).toHaveValue(/^https:\/\/calendly\.com\//);
    const save = page.getByRole('button', { name: 'Save settings' });
    await expect(save).toBeDisabled(); // nothing changed yet

    await hold.fill('0');
    await save.click();
    await expect(
      page.getByText('Hold while booking (minutes): enter a whole number from 1 to 120.'),
    ).toBeVisible();

    await hold.fill('15');
    await page.getByLabel('Processing fee (%)').fill('2.5');
    await page.getByLabel('Calendly link').fill('');
    await save.click();
    await expect(page.getByText(/^Settings saved/)).toBeVisible();
    await expect(hold).toHaveValue('15');
    await expect(page.getByLabel('Processing fee (%)')).toHaveValue('2.5');
    await expect(save).toBeDisabled();
  });
});
