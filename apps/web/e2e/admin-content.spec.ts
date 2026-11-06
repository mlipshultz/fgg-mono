import { expect, test } from '@playwright/test';
import { live, url } from './helpers';

/** A tiny PNG to upload. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });

test.describe('admin partners & activities', () => {
  test.skip(live, 'fixture-only: would change the real home page lists on dev');
  test.skip(({ isMobile }) => !!isMobile, 'one browser is enough');

  test('adds, edits, reorders and removes partners', async ({ page }) => {
    await page.goto(url('/admin/content/'));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Partners & activities' }),
    ).toBeVisible();
    const section = page.getByRole('region', { name: 'Partners', exact: true });
    const list = section.getByRole('list', { name: 'Partners' });
    await expect(list.getByRole('listitem')).toHaveCount(3);

    const form = section.locator('form');
    await form.getByLabel('Name').fill('Card Corner');
    await form.getByLabel('Link (optional)').fill('not a link');
    await form.getByLabel(/^Logo/).setInputFiles(png('logo.png'));
    await form.getByRole('button', { name: 'Add partner' }).click();
    await expect(page.getByText('The link should start with https://')).toBeVisible();
    await form.getByLabel('Link (optional)').fill('https://cardcorner.example');
    await form.getByRole('button', { name: 'Add partner' }).click();
    await expect(page.getByText(/^Added Card Corner\./)).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(4);

    const two = list.getByRole('listitem', { name: 'Partner Two' });
    await two.getByLabel('Link').fill('https://two.example');
    await two.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/^Saved\./)).toBeVisible();
    await expect(two.getByRole('button', { name: 'Save' })).toHaveCount(0);

    await list
      .getByRole('listitem', { name: 'Card Corner' })
      .getByRole('button', { name: 'Move Card Corner earlier' })
      .click();
    await expect(list.getByRole('listitem').nth(2)).toHaveAccessibleName('Card Corner');

    page.once('dialog', (d) => void d.accept());
    await list.getByRole('button', { name: 'Delete Partner One' }).click();
    await expect(page.getByText(/^Removed Partner One\./)).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(3);
  });

  test('adds, edits, reorders, re-icons and removes activities', async ({ page }) => {
    await page.goto(url('/admin/content/'));
    const section = page.getByRole('region', { name: 'Activities', exact: true });
    const list = section.getByRole('list', { name: 'Activities' });
    await expect(list.getByRole('listitem')).toHaveCount(6);

    const form = section.locator('form');
    await form.getByLabel('Name').fill('Pokédex Bingo');
    await form.getByLabel('One-line description').fill('Fill a bingo card as you explore.');
    await form.getByLabel('XP').fill('40');
    await form.getByLabel(/^Icon/).setInputFiles(png('icon.png'));
    await form.getByRole('button', { name: 'Add activity' }).click();
    await expect(page.getByText(/^Added Pokédex Bingo\./)).toBeVisible();
    const bingo = list.getByRole('listitem', { name: 'Pokédex Bingo' });
    await expect(bingo.locator('img')).toHaveCount(1);

    const trading = list.getByRole('listitem', { name: 'Trading' });
    await trading.getByLabel('XP').fill('30');
    await trading.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/^Saved\./)).toBeVisible();
    await expect(trading.getByLabel('XP')).toHaveValue('30');

    await bingo.getByRole('button', { name: 'Move Pokédex Bingo earlier' }).click();
    await expect(list.getByRole('listitem').nth(5)).toHaveAccessibleName('Pokédex Bingo');

    await bingo.getByRole('button', { name: 'Remove icon' }).click();
    await expect(page.getByText(/^Removed the icon from Pokédex Bingo\./)).toBeVisible();
    await expect(bingo.locator('img')).toHaveCount(0);
    await expect(bingo.getByText('Add icon')).toBeVisible();

    page.once('dialog', (d) => void d.accept());
    await list.getByRole('button', { name: 'Delete Gaming & Tournaments' }).click();
    await expect(page.getByText(/^Removed Gaming & Tournaments\./)).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(6);
  });
});
