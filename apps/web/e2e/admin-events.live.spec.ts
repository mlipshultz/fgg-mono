import { type Page, expect, test } from '@playwright/test';

/**
 * Live dev only (pnpm e2e:dev, smoke account = superadmin + staff). Unlike live.spec.ts this
 * WRITES to dev: it creates an "E2E Test Fest" event (draft, then published, then unpublished),
 * uploads a poster, and edits Frederick Fairgrounds' address and puts it back. There is no delete
 * in admin yet, so remove the test event from the dev table afterwards.
 * Edits to Halloween Fest are only ever ones the API must refuse (it has bookings both days).
 */
const API = process.env.E2E_API_URL ?? '';
const stamp = Date.now().toString(36);
const NAME = `E2E Test Fest ${stamp}`;
// Different from the link the editor would generate from the name, so typing it locks it.
const SLUG = `e2e-${stamp}`;
/** A 1×1 PNG, enough for an upload. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => !!isMobile, 'one browser is enough for writes');

async function openEvents(page: Page) {
  await page.goto('/admin/events/');
  await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit / }).first()).toBeVisible();
}
const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
const floorplan = (page: Page, slug: string) =>
  page.request.get(`${API}/public/events/${slug}/floorplan`);

test.describe('admin events and venues on dev @live', () => {
  test('venues show whether they have a floor plan; an address edit saves', async ({ page }) => {
    await openEvents(page);
    await page.getByRole('button', { name: 'Venues' }).click();
    await expect(row(page, 'Frederick Fairgrounds')).toContainText('Not yet');
    await expect(row(page, 'Maryland State Fairgrounds')).toContainText('Yes');

    await page.getByRole('button', { name: 'Edit Frederick Fairgrounds' }).click();
    const address = page.getByLabel('Address');
    const original = await address.inputValue();
    await address.fill(`${original} (e2e)`);
    await page.getByRole('button', { name: 'Save venue' }).click();
    await expect(page.getByText('Saved Frederick Fairgrounds.')).toBeVisible();
    await expect(row(page, 'Frederick Fairgrounds')).toContainText(`${original} (e2e)`);
    // Put it back.
    await page.getByRole('button', { name: 'Edit Frederick Fairgrounds' }).click();
    await page.getByLabel('Address').fill(original);
    await page.getByRole('button', { name: 'Save venue' }).click();
    await expect(row(page, 'Frederick Fairgrounds')).toContainText(original);
    await expect(row(page, 'Frederick Fairgrounds')).not.toContainText('(e2e)');
  });

  test('the link follows the name until edited, and bad input is refused', async ({ page }) => {
    await openEvents(page);
    await page.getByRole('button', { name: 'New event' }).click();
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.getByText('Give the event a name.')).toBeVisible();

    await page.getByLabel('Name').fill('Spring Thing');
    await page.getByLabel('Date').first().fill('2027-05-01');
    await expect(page.getByLabel('Link')).toHaveValue('spring-thing-2027');
    await page.getByLabel('Link').fill('my-own-link');
    await page.getByLabel('Name').fill('Spring Thing Renamed');
    await expect(page.getByLabel('Link')).toHaveValue('my-own-link');

    // Server-side checks.
    await page.getByLabel('Link').fill('halloween-fest-2026');
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.getByText(/already uses the link "halloween-fest-2026"/)).toBeVisible();
    await page.getByLabel('Link').fill(SLUG);
    await page.getByLabel('Opens').first().fill('17:00');
    await page.getByLabel('Closes').first().fill('11:00');
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.getByText('2027-05-01 closes before it opens')).toBeVisible();
  });

  test('map booking cannot open at a venue without a floor plan', async ({ page }) => {
    await openEvents(page);
    await page.getByRole('button', { name: 'New event' }).click();
    await page.getByLabel('Name').fill(NAME);
    await page.getByLabel('Link').fill(SLUG);
    await page.getByLabel('Date').first().fill('2027-03-06');
    await page.getByLabel('Venue').selectOption({ label: 'Frederick Fairgrounds · Frederick' });
    await page.getByRole('combobox', { name: /^Booking/ }).selectOption('open');
    await expect(page.getByText(/Frederick Fairgrounds has no floor plan yet/)).toBeVisible();
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(
      page.getByText(
        /has no floor plan yet\. Book by number of tables, or keep vendor tables closed\./,
      ),
    ).toBeVisible();
    // Nothing was created.
    expect((await floorplan(page, SLUG)).status()).toBe(404);
  });

  test('a draft stays private, publishing makes it bookable, and a poster uploads', async ({
    page,
  }) => {
    await openEvents(page);
    await page.getByRole('button', { name: 'New event' }).click();
    await page.getByLabel('Name').fill(NAME);
    await page.getByLabel('Link').fill(SLUG);
    await page.getByLabel('Date').first().fill('2027-03-06');
    await page.getByRole('button', { name: '+ Add a day' }).click();
    await page.getByLabel('Date').nth(1).fill('2027-03-07');
    await page.getByLabel('Venue').selectOption({ label: 'Frederick Fairgrounds · Frederick' });
    await page.getByLabel('How vendors book').selectOption('quantity');
    await page.getByLabel('Tables for sale per day').fill('30');
    await page.getByRole('combobox', { name: /^Booking/ }).selectOption('open');
    await page.getByLabel('Upload poster').setInputFiles({
      name: 'poster.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByAltText('Poster preview')).toBeVisible();
    const posterSrc = await page.getByAltText('Poster preview').getAttribute('src');
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.getByText(`Saved ${NAME}.`, { exact: false })).toBeVisible();
    await expect(row(page, NAME)).toContainText('Draft');
    await expect(row(page, NAME)).toContainText('30 tables per day');

    // The uploaded poster is served from the media CDN.
    expect(posterSrc).toMatch(/^https:\/\/.+\/events\/poster-[0-9a-z]+\.png$/);
    expect((await page.request.get(posterSrc!)).status()).toBe(200);

    // Draft: the API doesn't serve it, so the booking page can't open.
    expect((await floorplan(page, SLUG)).status()).toBe(404);
    await page.goto(`/vendor/book/?event=${SLUG}`);
    await expect(page.getByText(/couldn.t open the floor plan/)).toBeVisible();

    // Published: bookable straight away, before any site rebuild.
    await openEvents(page);
    await page.getByRole('button', { name: `Edit ${NAME}` }).click();
    await page.getByLabel('Published (listed on the site)').check();
    await page.getByRole('button', { name: 'Save event' }).click();
    await expect(row(page, NAME)).toContainText('Published');
    const fp = await floorplan(page, SLUG);
    expect(fp.status()).toBe(200);
    expect((await fp.json()).event).toMatchObject({
      tableBooking: 'quantity',
      posterUrl: posterSrc,
    });
    await page.goto(`/vendor/book/?event=${SLUG}`);
    await expect(page.getByRole('heading', { name: 'How many tables?' })).toBeVisible();
    await expect(page.getByText('30 left · $200 each').first()).toBeVisible();

    // A harmless edit on an event saves; unpublish it again to keep it out of the way.
    await openEvents(page);
    await page.getByRole('button', { name: `Edit ${NAME}` }).click();
    await page.getByLabel('Table $/day').fill('225');
    await page.getByLabel('Published (listed on the site)').uncheck();
    await page.getByRole('button', { name: 'Save event' }).click();
    await expect(row(page, NAME)).toContainText('Draft');
    expect((await floorplan(page, SLUG)).status()).toBe(404);
  });

  test('Halloween Fest refuses edits that would undo bookings', async ({ page }) => {
    await openEvents(page);
    await page.getByRole('button', { name: 'Edit Halloween Fest' }).click();
    await page.getByRole('button', { name: 'Remove day 2' }).click();
    await page.getByRole('button', { name: 'Save event' }).click();
    await expect(page.getByText('2026-10-25 has tables booked or held')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Edit Halloween Fest' }).click();
    await page.getByLabel('How vendors book').selectOption('quantity');
    await page.getByLabel('Tables for sale per day').fill('40');
    await page.getByRole('button', { name: 'Save event' }).click();
    await expect(
      page.getByText(
        'Tables are already booked or held, so the way this event books cannot change',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Rebuild site explains it is not set up yet', async ({ page }) => {
    await openEvents(page);
    await page.getByRole('button', { name: 'Rebuild site' }).click();
    await expect(page.getByText(/Automatic rebuilds are not set up yet/)).toBeVisible();
  });
});
