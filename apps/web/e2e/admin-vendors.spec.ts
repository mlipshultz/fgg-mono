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
    await page.getByLabel('Email', { exact: true }).fill('not-an-email');
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

  test("manages a vendor's members and links to its orders", async ({ page }) => {
    await page.goto(url('/admin/vendors/'));
    await page.getByRole('button', { name: "Edit Maya's Card Corner" }).click();
    const members = page.getByRole('list', { name: 'Members' });
    await expect(members.getByRole('listitem')).toHaveCount(1);
    await expect(members).toContainText('maya@cardcorner.com · Owner');

    // The only member can't be removed.
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Remove maya@cardcorner.com' }).click();
    await expect(page.getByText(/^This is the only member/)).toBeVisible();

    const add = page.getByLabel('Add someone by their account email');
    await add.fill('nobody@nowhere.test');
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.getByText(/^No account uses nobody@nowhere\.test/)).toBeVisible();
    await add.fill('helper@example.com');
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.getByText(/^Added helper@example\.com\./)).toBeVisible();
    await expect(members.getByRole('listitem')).toHaveCount(2);
    await expect(members).toContainText('helper@example.com · Member');

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Remove helper@example.com' }).click();
    await expect(page.getByText('Removed helper@example.com.')).toBeVisible();
    await expect(members.getByRole('listitem')).toHaveCount(1);

    const link = page.getByRole('link', { name: "See Maya's Card Corner's orders →" });
    const href = (await link.getAttribute('href'))!;
    const vendor = new URL(href, 'http://x').searchParams.get('vendor')!;
    expect(href).toBe(`/admin/orders/?vendor=${vendor}`);
    // Fixture mode needs ?preview=1 to get past sign-in, so open the same link with it.
    await page.goto(url('/admin/orders/', { vendor }));
    await expect(page.getByText(/^Showing one vendor's orders/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show all orders' })).toHaveAttribute(
      'href',
      '/admin/orders/',
    );
  });
});
