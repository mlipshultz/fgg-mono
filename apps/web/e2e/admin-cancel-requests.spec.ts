import { expect, test } from '@playwright/test';
import { live, url } from './helpers';

test.describe('admin cancellation requests', () => {
  test.skip(live, 'fixture-only: would refund real orders on dev');

  test('lists requests with reasons, approves a partial refund and declines with a note', async ({
    page,
  }) => {
    await page.goto(url('/admin/orders/'));
    const queue = page.getByRole('region', { name: /^Cancellation requests/ });
    await expect(queue.getByText('Cancellation requests · 2')).toBeVisible();
    const pocket = queue.getByRole('article', { name: /Pocket Monsters MD/ });
    const plush = queue.getByRole('article', { name: /Plush Pals/ });
    await expect(pocket.getByText('“Our van is in the shop that weekend.”')).toBeVisible();
    await expect(plush.getByText('No reason given.')).toBeVisible();
    await expect(pocket.getByText(/^Show (in \d+ days|has passed)/)).toBeVisible();

    // Partial refund: the button follows the amount.
    await pocket.getByLabel('Refund $').fill('300');
    await pocket.getByRole('button', { name: 'Approve and refund $300' }).click();
    await expect(page.getByText('Refunded $300 for HF26-021 and freed its tables.')).toBeVisible();
    await expect(queue.getByText('Cancellation requests · 1')).toBeVisible();

    await plush.getByLabel('Note (optional)').fill('We can move you to Holiday Fest.');
    await plush.getByRole('button', { name: 'Decline' }).click();
    await expect(page.getByText(/^Declined the cancellation for HF26-030/)).toBeVisible();
    await expect(queue.getByText('Nothing waiting.')).toBeVisible();
  });
});
