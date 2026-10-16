import { expect, test } from '@playwright/test';
import { live, url } from './helpers';

test.describe('admin events', () => {
  test.skip(live, 'fixture-only: would create real events on dev');

  test('lists events, creates a draft that books by number, and edits an existing one', async ({
    page,
  }) => {
    await page.goto(url('/admin/events/'));
    await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
    const row = (name: string) => page.getByRole('row').filter({ hasText: name });
    await expect(row('Halloween Fest')).toContainText('Floor plan');
    await expect(row('Winter Fest')).toContainText('40 tables per day');

    await page.getByRole('button', { name: 'New event' }).click();
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.getByText('Give the event a name.')).toBeVisible();

    await page.getByLabel('Name').fill('Autumn Fest');
    await page.getByLabel('Date').fill('2027-09-18');
    // The link follows the name and year until it is edited by hand.
    await expect(page.getByLabel('Link')).toHaveValue('autumn-fest-2027');
    await page.getByLabel('Venue').selectOption({ label: 'Frederick Fairgrounds · Frederick' });
    await expect(page.getByText('Frederick Fairgrounds has no floor plan yet')).toBeVisible();
    await page.getByLabel('How vendors book').selectOption('quantity');
    await page.getByLabel('Tables for sale per day').fill('30');
    await page.getByRole('button', { name: '+ Add a day' }).click();
    await page.getByLabel('Date').nth(1).fill('2027-09-19');
    await page.getByRole('button', { name: 'Create event' }).click();

    await expect(page.getByText(/^Saved Autumn Fest\./)).toBeVisible();
    await expect(row('Autumn Fest')).toContainText('Draft');
    await expect(row('Autumn Fest')).toContainText('30 tables per day');
    await expect(row('Autumn Fest')).toContainText('Sep 18–19');

    await page.getByRole('button', { name: 'Edit Autumn Fest' }).click();
    await expect(page.getByLabel('Tables for sale per day')).toHaveValue('30');
    await page.getByLabel('Published (listed on the site)').check();
    await page.getByRole('button', { name: 'Save event' }).click();
    await expect(row('Autumn Fest')).toContainText('Published');

    await page.getByRole('button', { name: 'Rebuild site' }).click();
    await expect(page.getByText(/^Rebuild started\./)).toBeVisible();
  });

  test('lists venues with whether they have a floor plan, and edits one', async ({ page }) => {
    await page.goto(url('/admin/events/'));
    await page.getByRole('button', { name: 'Venues' }).click();
    const row = (name: string) => page.getByRole('row').filter({ hasText: name });
    await expect(row('Maryland State Fairgrounds')).toContainText('Yes');
    await expect(row('Frederick Fairgrounds')).toContainText('Not yet');

    await page.getByRole('button', { name: 'Edit Frederick Fairgrounds' }).click();
    await page.getByLabel('Address').fill('797 East Patrick Street');
    await page.getByRole('button', { name: 'Save venue' }).click();
    await expect(page.getByText('Saved Frederick Fairgrounds.')).toBeVisible();
    await expect(row('Frederick Fairgrounds')).toContainText('797 East Patrick Street');
  });
});
