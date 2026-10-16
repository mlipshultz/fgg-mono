import { expect, test } from '@playwright/test';
import { live, url } from './helpers';

/** A tiny PNG to upload. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('admin gallery', () => {
  test.skip(live, 'fixture-only: would change the real gallery on dev');

  test('adds a photo, a stat and a quote, edits, features, reorders and deletes', async ({
    page,
  }) => {
    await page.goto(url('/admin/gallery/'));
    await expect(page.getByRole('heading', { level: 1, name: 'Gallery' })).toBeVisible();
    await page.getByLabel('Show').selectOption({ label: 'Harbor Fest 2026' });
    const grid = page.getByRole('list', { name: 'Gallery items' });
    await expect(grid.getByRole('listitem')).toHaveCount(3);

    await page.getByLabel('Upload photos').setInputFiles({
      name: 'crowd.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByText(/^Added 1 photo\./)).toBeVisible();
    await expect(grid.getByRole('listitem')).toHaveCount(4);

    await page.getByLabel('Stat number').fill('300+');
    await page.getByLabel('Stat label').fill('vendors');
    await page.getByRole('button', { name: 'Add stat' }).click();
    await page.getByLabel('Quote text').fill('Best show yet!');
    await page.getByRole('button', { name: 'Add quote' }).click();
    await expect(grid.getByRole('listitem')).toHaveCount(6);

    const statTile = grid.getByRole('listitem', { name: 'Stat 300+' });
    await statTile.getByLabel('Label').fill('vendors and artists');
    await statTile.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/^Saved\./)).toBeVisible();
    await statTile.getByLabel('Featured on the home page').check();
    await expect(page.getByText(/^Featured on the home page\./)).toBeVisible();

    // Move the stat earlier: it trades places with the photo before it.
    await statTile.getByRole('button', { name: 'Move Stat 300+ earlier' }).click();
    await expect(grid.getByRole('listitem').nth(3)).toHaveAccessibleName('Stat 300+');

    page.once('dialog', (d) => void d.accept());
    await statTile.getByRole('button', { name: 'Delete Stat 300+' }).click();
    await expect(page.getByText(/^Deleted the stat\./)).toBeVisible();
    await expect(grid.getByRole('listitem')).toHaveCount(5);
  });
});
