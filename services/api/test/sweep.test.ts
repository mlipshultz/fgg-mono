import { beforeEach, describe, expect, it } from 'vitest';
import type { Order } from '@fgg/types';
import { FakeDdb } from './fake-ddb.js';
import { EVENT_ID, event } from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';

const db = new FakeDdb();
const { keys } = await import('../src/lib/db.js');
const booking = await import('../src/lib/booking.js');
const { FakeShopifyClient, setShopifyClient } = await import('../src/lib/shopify.js');
const { handler } = await import('../src/handlers/sweep.js');

const VENDOR = '01HZX3V9K7Q2M4N8P6R5T1W0YD';
let shop: InstanceType<typeof FakeShopifyClient>;

async function unpaid(id: string, holdId: string | undefined, source: Order['source'] = 'shopify') {
  const o: Order = {
    id,
    eventId: EVENT_ID,
    kind: 'vendor_table',
    source,
    ownerId: VENDOR,
    placedBy: '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d',
    status: 'pending_payment',
    lines: [
      {
        type: 'table',
        tableId: 'A1',
        dates: ['2026-10-24'],
        rate: 'standard',
        unitCents: 20000,
        lineCents: 20000,
      },
    ],
    subtotalCents: 20000,
    feeCents: 0,
    taxCents: 0,
    totalCents: 20000,
    ...(holdId ? { holdId } : {}),
    ...(source === 'shopify' ? { shopifyDraftOrderId: `draft-${id}` } : {}),
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
  await booking.writeOrder(o, event.startsAt);
}
function hold(holdId: string, tableId: string, minutes: number) {
  db.put({
    ...keys.hold(EVENT_ID, '2026-10-24', tableId),
    GSI1PK: `VENDOR#${VENDOR}`,
    GSI1SK: `HOLD#${holdId}`,
    holdId,
    vendorId: VENDOR,
    tableId,
    date: '2026-10-24',
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
  });
}
const status = (id: string) => db.get(`ORDER#${id}`, 'META')?.status;

beforeEach(() => {
  db.reset();
  shop = new FakeShopifyClient();
  setShopifyClient(shop);
  db.put({ ...keys.eventIndex(event), ...event });
});

describe('abandoned checkout sweep', () => {
  it('cancels unpaid checkouts whose hold is gone or expired, and leaves live ones alone', async () => {
    hold('h-live', 'A1', 5);
    hold('h-old', 'A2', -5);
    await unpaid('01HZX3V9K7Q2M4N8P6R5T1W0Y1', 'h-live');
    await unpaid('01HZX3V9K7Q2M4N8P6R5T1W0Y2', 'h-old');
    await unpaid('01HZX3V9K7Q2M4N8P6R5T1W0Y3', 'h-missing');
    await unpaid('01HZX3V9K7Q2M4N8P6R5T1W0Y4', undefined, 'manual');

    const res = await handler();
    expect(res.checked).toBe(3); // the manual order is not a checkout
    expect(res.cancelled.sort()).toEqual([
      '01HZX3V9K7Q2M4N8P6R5T1W0Y2',
      '01HZX3V9K7Q2M4N8P6R5T1W0Y3',
    ]);
    expect(status('01HZX3V9K7Q2M4N8P6R5T1W0Y1')).toBe('pending_payment');
    expect(status('01HZX3V9K7Q2M4N8P6R5T1W0Y2')).toBe('cancelled');
    expect(status('01HZX3V9K7Q2M4N8P6R5T1W0Y4')).toBe('pending_payment');
    expect(shop.deletedDrafts.sort()).toEqual([
      'draft-01HZX3V9K7Q2M4N8P6R5T1W0Y2',
      'draft-01HZX3V9K7Q2M4N8P6R5T1W0Y3',
    ]);
    // Running again finds nothing new to do.
    expect((await handler()).cancelled).toEqual([]);
  });
});
