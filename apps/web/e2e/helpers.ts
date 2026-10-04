import type { Page } from '@playwright/test';

export const live = !!process.env.E2E_BASE_URL;

/** Fixture mode bypasses the auth gates with `?preview=1`; live mode has a real session. */
export function url(path: string, query: Record<string, string> = {}): string {
  const q = new URLSearchParams(query);
  if (!live) q.set('preview', '1');
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** Fixture events: Halloween Fest is the two-day event with partially booked tables. */
export const EVENT_SLUG = 'halloween-fest-2026';

export async function gotoBooking(page: Page) {
  await page.goto(url('/vendor/book/', { event: EVENT_SLUG }));
  await page.getByRole('group', { name: 'Tables', exact: true }).waitFor();
}

export const table = (page: Page, id: string) =>
  page.getByRole('button', { name: new RegExp(`^Table ${id},`) });
