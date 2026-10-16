/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import { CancelRequestList, VendorOrder, type Order } from '@fgg/types';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { FakeDdb } from './fake-ddb.js';
import { EVENT_ID, event, floorPlan, parse, req as baseReq, venue } from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';
process.env.WEB_ORIGINS = 'http://localhost:3000';
process.env.USER_POOL_ID = 'us-east-1_test';

const db = new FakeDdb();
const { keys } = await import('../src/lib/db.js');
const booking = await import('../src/lib/booking.js');
const { clearVenueCache } = await import('../src/lib/events.js');
const { FakeShopifyClient, setShopifyClient } = await import('../src/lib/shopify.js');
const { handler } = await import('../src/handlers/account.js');
const { handler: vendorHandler } = await import('../src/handlers/vendor.js');

const VENDOR = '01HZX3V9K7Q2M4N8P6R5T1W0YD';
const VENDOR_SUB = '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';
function as(sub: string, groups: string[]) {
  return (method: any, path: string, body?: unknown): APIGatewayProxyEventV2 => {
    const r = baseReq(method, path, { body }) as any;
    r.requestContext.authorizer = {
      jwt: { claims: { sub, email: 'x@example.com', 'cognito:groups': groups }, scopes: [] },
    };
    return r;
  };
}
const superadmin = as('9f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d', ['superadmin', 'staff']);
const staff = as('8f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d', ['staff']);
const vendor = as(VENDOR_SUB, ['vendor', 'attendee']);
let shop: InstanceType<typeof FakeShopifyClient>;

/** A paid Shopify order for table A1, both days. */
async function paidOrder(id: string, tableId = 'A1'): Promise<Order> {
  const o: Order = {
    id,
    eventId: EVENT_ID,
    kind: 'vendor_table',
    source: 'shopify',
    ownerId: VENDOR,
    placedBy: VENDOR_SUB,
    status: 'pending_payment',
    lines: [
      {
        type: 'table',
        tableId,
        dates: ['2026-10-24', '2026-10-25'],
        rate: 'standard',
        unitCents: 20000,
        lineCents: 40000,
      },
    ],
    subtotalCents: 40000,
    feeCents: 0,
    taxCents: 0,
    totalCents: 40000,
    vendorInfo: {
      tableName: "Maya's Card Corner",
      contactName: 'Maya',
      phone: '4105550100',
      email: 'maya@cardcorner.com',
      sellsDescription: 'Singles',
      codeOfConductAccepted: true,
    },
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
  await booking.writeOrder(o, event.startsAt);
  return booking.finalizePaidOrder({
    order: o,
    event,
    startsAt: event.startsAt,
    shopifyOrderId: `shop-${id}`,
    by: 'shopify',
  });
}
const requestCancel = (id: string, reason?: string) =>
  vendorHandler(vendor('POST', `/vendor/orders/${id}/cancel-request`, reason ? { reason } : {}));
const queue = async () =>
  CancelRequestList.parse(parse(await handler(staff('GET', '/admin/orders/cancel-requests'))).body);

beforeEach(() => {
  db.reset();
  clearVenueCache();
  shop = new FakeShopifyClient();
  setShopifyClient(shop);
  db.put({ ...keys.eventIndex(event), ...event });
  db.put({ ...keys.venue(venue.id), ...venue });
  db.put({ ...keys.floorPlan(venue.id), ...floorPlan });
  db.put({
    ...keys.vendorIndex({ id: VENDOR, status: 'active', businessName: 'Maya' }),
    id: VENDOR,
    businessName: "Maya's Card Corner",
    contactName: 'Maya Johnson',
    email: 'maya@cardcorner.com',
    phone: '4105550100',
    sells: [],
    socials: {},
    pokeBucksPartner: false,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  });
  db.put({
    ...keys.vendorMember(VENDOR, VENDOR_SUB),
    vendorId: VENDOR,
    userId: VENDOR_SUB,
    role: 'owner',
    addedBy: 'x',
    addedAt: '2026-09-01T00:00:00Z',
  });
});

describe('cancel-request queue', () => {
  it('lists requests with the reason, and approving refunds in full and frees the tables', async () => {
    await paidOrder('01HZX3V9K7Q2M4N8P6R5T1W0Y1');
    await paidOrder('01HZX3V9K7Q2M4N8P6R5T1W0Y2', 'B1');
    expect((await queue()).items).toEqual([]);

    const asked = parse(await requestCancel('01HZX3V9K7Q2M4N8P6R5T1W0Y1', 'Car broke down'));
    expect(asked.status).toBe(200);
    expect(asked.body).toMatchObject({ cancelReason: 'Car broke down' });
    const again = parse(await requestCancel('01HZX3V9K7Q2M4N8P6R5T1W0Y1'));
    expect(again.body.error.code).toBe('already_requested');

    const q = await queue();
    expect(q.refundCutoffDays).toBe(14);
    expect(q.items.map((o) => o.id)).toEqual(['01HZX3V9K7Q2M4N8P6R5T1W0Y1']);
    expect(q.items[0]).toMatchObject({
      cancelReason: 'Car broke down',
      event: { name: 'Halloween Fest' },
    });

    // Refunds are superadmin only.
    const forbidden = parse(
      await handler(
        staff('POST', '/admin/orders/01HZX3V9K7Q2M4N8P6R5T1W0Y1/cancel-request/approve', {}),
      ),
    );
    expect(forbidden.status).toBe(403);

    const approved = parse(
      await handler(
        superadmin('POST', '/admin/orders/01HZX3V9K7Q2M4N8P6R5T1W0Y1/cancel-request/approve', {}),
      ),
    );
    expect(approved.status).toBe(200);
    expect(VendorOrder.parse(approved.body)).toMatchObject({ status: 'refunded' });
    expect(approved.body.refundedCents).toBeUndefined();
    expect(shop.refunds).toEqual([
      expect.objectContaining({ orderId: 'shop-01HZX3V9K7Q2M4N8P6R5T1W0Y1', amountCents: 40000 }),
    ]);
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')).toBeUndefined();
    expect((await queue()).items).toEqual([]);
    // The other order is untouched.
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#B1')).toBeDefined();
  });

  it('approves a partial refund inside the window, and never more than was paid', async () => {
    await paidOrder('01HZX3V9K7Q2M4N8P6R5T1W0Y3');
    await requestCancel('01HZX3V9K7Q2M4N8P6R5T1W0Y3');
    const path = '/admin/orders/01HZX3V9K7Q2M4N8P6R5T1W0Y3/cancel-request/approve';
    const tooMuch = parse(await handler(superadmin('POST', path, { amountCents: 50000 })));
    expect(tooMuch.body.error.code).toBe('too_much');
    const half = parse(
      await handler(superadmin('POST', path, { amountCents: 20000, note: 'half, inside window' })),
    );
    expect(half.body).toMatchObject({ status: 'refunded', refundedCents: 20000 });
    expect(shop.refunds.at(-1)).toMatchObject({ amountCents: 20000, note: 'half, inside window' });
    const twice = parse(await handler(superadmin('POST', path, {})));
    expect(twice.body.error.code).toBe('no_request');
  });

  it('declines with a note: the booking stays and the vendor can ask again', async () => {
    await paidOrder('01HZX3V9K7Q2M4N8P6R5T1W0Y4');
    await requestCancel('01HZX3V9K7Q2M4N8P6R5T1W0Y4', 'Double booked');
    const declined = parse(
      await handler(
        staff('POST', '/admin/orders/01HZX3V9K7Q2M4N8P6R5T1W0Y4/cancel-request/decline', {
          note: 'Show is in 3 days; we can move you to Holiday Fest instead.',
        }),
      ),
    );
    expect(declined.status).toBe(200);
    expect(declined.body).toMatchObject({
      status: 'paid',
      cancelDeclineNote: 'Show is in 3 days; we can move you to Holiday Fest instead.',
    });
    expect(declined.body.cancelRequestedAt).toBeUndefined();
    expect(declined.body.cancelReason).toBeUndefined();
    expect(shop.refunds).toEqual([]);
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')).toBeDefined();
    expect((await queue()).items).toEqual([]);

    const askedAgain = parse(
      await requestCancel('01HZX3V9K7Q2M4N8P6R5T1W0Y4', 'Really cannot come'),
    );
    expect(askedAgain.status).toBe(200);
    expect(askedAgain.body.cancelDeclinedAt).toBeUndefined();
    expect((await queue()).items).toHaveLength(1);
    expect(parse(await handler(vendor('GET', '/admin/orders/cancel-requests'))).status).toBe(403);
  });
});
