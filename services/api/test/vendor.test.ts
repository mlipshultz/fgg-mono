/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type Order,
  EventFloorPlan,
  EventVendorList,
  HoldResponse,
  CheckoutResponse,
  LogoUploadResponse,
  VendorDashboard,
  VendorOrder,
  VendorProfile,
} from '@fgg/types';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { FakeDdb } from './fake-ddb.js';
import {
  COUNT_EVENT_ID,
  EVENT_ID,
  countEvent,
  countVenue,
  event,
  floorPlan,
  parse,
  req as baseReq,
  venue,
} from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';
process.env.WEB_ORIGINS = 'http://localhost:3000';
process.env.STAGE = 'test';

const db = new FakeDdb();
const { keys } = await import('../src/lib/db.js');
const { clearVenueCache } = await import('../src/lib/events.js');
const { FakeShopifyClient, setShopifyClient } = await import('../src/lib/shopify.js');
const { handler } = await import('../src/handlers/vendor.js');
const { handler: webhookHandler } = await import('../src/handlers/webhooks.js');
const { handler: publicHandler } = await import('../src/handlers/public.js');
const { refundOrCancel } = await import('../src/handlers/admin-cancel-requests.js');
const { cancelAbandonedCheckout } = await import('../src/lib/checkouts.js');
const { setPresigner } = await import('../src/lib/media.js');
const { _resetShopifyConfigCache } = await import('../src/lib/shopify-secret.js');
const { mockClient } = await import('aws-sdk-client-mock');
const { GetSecretValueCommand, SecretsManagerClient } =
  await import('@aws-sdk/client-secrets-manager');
const { createHmac } = await import('node:crypto');

const SUB = '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';
const VENDOR = '01HZX3V9K7Q2M4N8P6R5T1W0YD';
const SECRET = 'shpss_test';
const sm = mockClient(SecretsManagerClient);
let shop: InstanceType<typeof FakeShopifyClient>;

function authed(
  method: any,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): APIGatewayProxyEventV2 {
  const r = baseReq(method, path, { body, ...(query ? { query } : {}) }) as any;
  r.requestContext.authorizer = {
    jwt: {
      claims: { sub: SUB, email: 'maya@cardcorner.com', 'cognito:groups': ['vendor', 'attendee'] },
      scopes: [],
    },
  };
  return r;
}

function webhook(topic: string, payload: unknown, secret = SECRET): APIGatewayProxyEventV2 {
  const body = JSON.stringify(payload);
  const r = baseReq('POST', '/webhooks/shopify') as any;
  r.body = body;
  r.headers = {
    'content-type': 'application/json',
    'x-shopify-topic': topic,
    'x-shopify-hmac-sha256': createHmac('sha256', secret).update(body).digest('base64'),
  };
  return r;
}

/** What Shopify reports for an order: its total and everything refunded so far. */
function shopifyOrder(id: string, totalCents: number, totalRefundedCents = 0) {
  return {
    id,
    name: `#${id}`,
    financialStatus: totalRefundedCents ? 'REFUNDED' : 'PAID',
    totalCents,
    totalRefundedCents,
    noteAttributes: {},
  };
}

const vendorInfo = {
  tableName: "Maya's Card Corner",
  phone: '4105550100',
  sellsDescription: 'Singles and sealed',
  codeOfConductAccepted: true,
};

beforeEach(() => {
  db.reset();
  clearVenueCache();
  _resetShopifyConfigCache();
  process.env.SHOPIFY_SECRET_ID = 'fgg/test/shopify';
  sm.reset();
  sm.on(GetSecretValueCommand).resolves({
    SecretString: JSON.stringify({
      shop: 'fgg-dev.myshopify.com',
      clientId: 'cid',
      clientSecret: SECRET,
      adminAccessToken: 'shpat_x',
      apiVersion: '2026-07',
    }),
  });
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
    sells: ['pokemon_cards'],
    socials: {},
    pokeBucksPartner: false,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  });
  db.put({
    ...keys.vendorMember(VENDOR, SUB),
    vendorId: VENDOR,
    userId: SUB,
    role: 'owner',
    addedBy: 'x',
    addedAt: '2026-09-01T00:00:00Z',
  });
});

describe('vendor booking flow', () => {
  it('quotes, holds, adds info, checks out to a draft order, and a paid webhook books the table', async () => {
    const quote = parse(
      await handler(
        authed('POST', `/vendor/events/${EVENT_ID}/quote`, {
          lines: [{ tableId: 'B2', dates: ['2026-10-24', '2026-10-25'] }],
          rate: 'poke_bucks',
        }),
      ),
    );
    expect(quote.status).toBe(200);
    expect(quote.body.totalCents).toBe(20000);

    const held = parse(
      await handler(
        authed('POST', `/vendor/events/${EVENT_ID}/holds`, {
          lines: [{ tableId: 'B2', dates: ['2026-10-24', '2026-10-25'] }],
          rate: 'poke_bucks',
        }),
      ),
    );
    expect(held.status).toBe(201);
    const hr = HoldResponse.parse(held.body);
    expect(hr.quote.lines[0]).toMatchObject({ rowLabel: 'Row B · Main Hall' });
    expect(hr.hold.tables[0]!.dates).toHaveLength(2);
    // Nothing saved yet, so the info step is seeded from the vendor profile.
    expect(hr.vendorInfo).toBeUndefined();
    expect(hr.prefill).toMatchObject({ tableName: "Maya's Card Corner", phone: '4105550100' });

    const noInfo = parse(await handler(authed('POST', `/vendor/holds/${hr.hold.id}/checkout`)));
    expect(noInfo.status).toBe(400);

    const patched = parse(
      await handler(authed('PATCH', `/vendor/holds/${hr.hold.id}`, { vendorInfo })),
    );
    expect(patched.status).toBe(200);
    expect(HoldResponse.parse(patched.body).vendorInfo?.tableName).toBe("Maya's Card Corner");
    // Contact details come from the account, not the form.
    expect(HoldResponse.parse(patched.body).vendorInfo?.email).toBe('maya@cardcorner.com');
    expect(HoldResponse.parse(patched.body).prefill).toBeUndefined();

    const checkout = parse(await handler(authed('POST', `/vendor/holds/${hr.hold.id}/checkout`)));
    expect(checkout.status).toBe(201);
    const co = CheckoutResponse.parse(checkout.body);
    expect(co.invoiceUrl).toContain('invoices/1');
    expect(shop.drafts[0]).toMatchObject({
      email: 'maya@cardcorner.com',
      attributes: { orderId: co.orderId, tableId: 'B2' },
      lineItems: [{ title: 'Halloween Fest · Table B2 · Sat Oct 24 + Sun Oct 25', cents: 20000 }],
    });
    // Hold was extended for checkout.
    const holdItem = db.get(`EVENT#${EVENT_ID}`, 'HOLD#2026-10-24#B2')!;
    expect(new Date(holdItem.expiresAt).getTime()).toBeGreaterThan(
      new Date(hr.hold.expiresAt).getTime() - 1,
    );
    expect(new Date(holdItem.expiresAt).getTime()).toBeLessThan(Date.now() + 11 * 60_000);
    // Second checkout reuses the same draft, and doesn't stretch the hold again.
    const again = parse(await handler(authed('POST', `/vendor/holds/${hr.hold.id}/checkout`)));
    expect(again.status).toBe(200);
    expect(again.body.orderId).toBe(co.orderId);
    expect(again.body.holdExpiresAt).toBe(holdItem.expiresAt);
    expect(db.get(`EVENT#${EVENT_ID}`, 'HOLD#2026-10-24#B2')!.expiresAt).toBe(holdItem.expiresAt);
    expect(shop.drafts).toHaveLength(1);

    const paid = parse(
      await webhookHandler(
        webhook('orders/paid', {
          id: 777,
          name: '#1001',
          total_price: '200.00',
          note_attributes: [{ name: 'orderId', value: co.orderId }],
        }),
      ),
    );
    expect(paid.status).toBe(200);
    expect(paid.body.passNumber).toBe('HF26-001');
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-25#B2')?.orderId).toBe(co.orderId);
    expect(db.get(`EVENT#${EVENT_ID}`, 'HOLD#2026-10-25#B2')).toBeUndefined();
    expect(db.get(`VENDOR#${VENDOR}`, 'META')?.pokeBucksPartner).toBe(true);

    const view = parse(await handler(authed('GET', `/vendor/orders/${co.orderId}`)));
    const vo = VendorOrder.parse(view.body);
    expect(vo.status).toBe('paid');
    expect(vo.loadInLabel).toBe('Sat Oct 24 · 9am');
    expect(vo.event.name).toBe('Halloween Fest');

    const ics = (await handler(authed('GET', `/vendor/orders/${co.orderId}/pass.ics`))) as any;
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.body).toContain('BEGIN:VEVENT');
    const pdf = (await handler(authed('GET', `/vendor/orders/${co.orderId}/receipt.pdf`))) as any;
    expect(pdf.isBase64Encoded).toBe(true);
    expect(Buffer.from(pdf.body, 'base64').subarray(0, 4).toString()).toBe('%PDF');

    const dash = parse(await handler(authed('GET', '/vendor/dashboard')));
    const d = VendorDashboard.parse(dash.body);
    expect(d.upcoming).toHaveLength(1);
    expect(d.paidThisYearCents).toBe(20000);

    const cancel = parse(
      await handler(
        authed('POST', `/vendor/orders/${co.orderId}/cancel-request`, { reason: 'moving' }),
      ),
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelRequestedAt).toBeDefined();

    // The paid table shows up on the public "who's vending" list, without contact details.
    const who = parse(await publicHandler(baseReq('GET', `/public/events/${EVENT_ID}/vendors`)));
    expect(who.status).toBe(200);
    const list = EventVendorList.parse(who.body);
    expect(list.vendors).toEqual([
      expect.objectContaining({
        vendorId: VENDOR,
        name: "Maya's Card Corner",
        sellsDescription: 'Singles and sealed',
        tables: [{ tableId: 'B2', dates: ['2026-10-24', '2026-10-25'] }],
      }),
    ]);
    expect(JSON.stringify(who.body)).not.toContain('4105550100');
  });

  it('shows an empty vendor list before anyone has paid', async () => {
    const who = parse(await publicHandler(baseReq('GET', `/public/events/${EVENT_ID}/vendors`)));
    expect(who.status).toBe(200);
    expect(EventVendorList.parse(who.body).vendors).toEqual([]);
  });

  it('books two tables with different days in one order', async () => {
    const held = parse(
      await handler(
        authed('POST', `/vendor/events/${EVENT_ID}/holds`, {
          lines: [
            { tableId: 'B1', dates: ['2026-10-24', '2026-10-25'] },
            { tableId: 'B3', dates: ['2026-10-25'] },
          ],
          rate: 'standard',
        }),
      ),
    );
    expect(held.status).toBe(201);
    const hr = HoldResponse.parse(held.body);
    expect(hr.hold.tables.map((t) => 'tableId' in t && t.tableId)).toEqual(['B1', 'B3']);
    expect(hr.quote.totalCents).toBe(60000);
    await handler(authed('PATCH', `/vendor/holds/${hr.hold.id}`, { vendorInfo }));
    const co = parse(await handler(authed('POST', `/vendor/holds/${hr.hold.id}/checkout`)));
    expect(co.status).toBe(201);
    // One Shopify line per table, so the checkout shows which days each table covers.
    expect(shop.drafts[0]!.lineItems).toEqual([
      { title: 'Halloween Fest · Table B1 · Sat Oct 24 + Sun Oct 25', cents: 40000 },
      { title: 'Halloween Fest · Table B3 · Sun Oct 25', cents: 20000 },
    ]);
    expect(shop.drafts[0]!.attributes.tableId).toBe('B1,B3');
    const paid = parse(
      await webhookHandler(
        webhook('orders/paid', {
          id: 778,
          name: '#1002',
          total_price: '600.00',
          note_attributes: [{ name: 'orderId', value: co.body.orderId }],
        }),
      ),
    );
    expect(paid.status).toBe(200);
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#B1')?.orderId).toBe(co.body.orderId);
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-25#B3')?.orderId).toBe(co.body.orderId);
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#B3')).toBeUndefined();
    const vo = VendorOrder.parse(
      parse(await handler(authed('GET', `/vendor/orders/${co.body.orderId}`))).body,
    );
    expect(vo.lines).toHaveLength(2);
    expect(vo.loadInLabel).toBe('Sat Oct 24 · 9am');
    const who = parse(await publicHandler(baseReq('GET', `/public/events/${EVENT_ID}/vendors`)));
    const listed = EventVendorList.parse(who.body).vendors;
    expect(listed).toHaveLength(1); // one card per vendor, both tables on it
    expect(listed[0]!.tables.map((t) => t.tableId)).toEqual(['B1', 'B3']);
  });

  it('books a number of tables on an event with no floor plan', async () => {
    db.put({ ...keys.eventIndex(countEvent), ...countEvent });
    db.put({ ...keys.venue(countVenue.id), ...countVenue });
    // One line per day, each with its own number of tables.
    const cart = {
      lines: [
        { quantity: 3, dates: ['2026-10-24'] },
        { quantity: 2, dates: ['2026-10-25'] },
      ],
      rate: 'standard',
    };

    // The booking page gets the event and live counts, and no floor plan.
    const page = parse(
      await publicHandler(baseReq('GET', `/public/events/${COUNT_EVENT_ID}/floorplan`)),
    );
    const plan = EventFloorPlan.parse(page.body);
    expect(plan.floorPlan).toBeUndefined();
    expect(plan.event.tableBooking).toBe('quantity');
    expect(plan.availability.days.map((d) => d.left)).toEqual([4, 4]);
    expect(plan.terms).toEqual({ holdMinutes: 10, checkoutHoldMinutes: 10, refundCutoffDays: 14 });

    const bySpot = parse(
      await handler(
        authed('POST', `/vendor/events/${COUNT_EVENT_ID}/quote`, {
          lines: [{ tableId: 'A1', dates: ['2026-10-24'] }],
          rate: 'standard',
        }),
      ),
    );
    expect(bySpot.status).toBe(400);

    const held = parse(
      await handler(authed('POST', `/vendor/events/${COUNT_EVENT_ID}/holds`, cart)),
    );
    expect(held.status).toBe(201);
    const hr = HoldResponse.parse(held.body);
    expect(hr.hold.tables).toEqual([
      expect.objectContaining({ quantity: 3, dates: ['2026-10-24'], amountCents: 60000 }),
      expect.objectContaining({ quantity: 2, dates: ['2026-10-25'], amountCents: 40000 }),
    ]);
    expect(hr.quote.totalCents).toBe(100000);
    const left = parse(
      await publicHandler(baseReq('GET', `/public/events/${COUNT_EVENT_ID}/availability`)),
    );
    expect(left.body.days.map((d: any) => d.left)).toEqual([1, 2]);

    await handler(authed('PATCH', `/vendor/holds/${hr.hold.id}`, { vendorInfo }));
    const co = parse(await handler(authed('POST', `/vendor/holds/${hr.hold.id}/checkout`)));
    expect(co.status).toBe(201);
    expect(shop.drafts[0]!.lineItems).toEqual([
      { title: 'Winter Fest · 3 tables · Sat Oct 24', cents: 60000 },
      { title: 'Winter Fest · 2 tables · Sun Oct 25', cents: 40000 },
    ]);
    const paid = parse(
      await webhookHandler(
        webhook('orders/paid', {
          id: 778,
          total_price: '1000.00',
          note_attributes: [{ name: 'orderId', value: co.body.orderId }],
        }),
      ),
    );
    expect(paid.body.passNumber).toBe('WF26-001');
    const vo = VendorOrder.parse(
      parse(await handler(authed('GET', `/vendor/orders/${co.body.orderId}`))).body,
    );
    expect(vo.lines).toEqual([
      expect.objectContaining({ type: 'unassigned_tables', quantity: 3, lineCents: 60000 }),
      expect.objectContaining({ type: 'unassigned_tables', quantity: 2, lineCents: 40000 }),
    ]);
    expect(db.get(`EVENT#${COUNT_EVENT_ID}`, `TABLE#2026-10-25#QTY#${vo.id}`)?.quantity).toBe(2);

    // Listed as vending, with no table numbers to show.
    const who = EventVendorList.parse(
      parse(await publicHandler(baseReq('GET', `/public/events/${COUNT_EVENT_ID}/vendors`))).body,
    );
    expect(who.vendors).toEqual([expect.objectContaining({ vendorId: VENDOR, tables: [] })]);
  });

  it('cancels abandoned checkouts instead of leaving them awaiting payment', async () => {
    const startCheckout = async (tableId: string) => {
      const held = parse(
        await handler(
          authed('POST', `/vendor/events/${EVENT_ID}/holds`, {
            lines: [{ tableId, dates: ['2026-10-24'] }],
            rate: 'standard',
          }),
        ),
      );
      await handler(authed('PATCH', `/vendor/holds/${held.body.hold.id}`, { vendorInfo }));
      const co = parse(
        await handler(authed('POST', `/vendor/holds/${held.body.hold.id}/checkout`)),
      );
      return { holdId: held.body.hold.id as string, orderId: co.body.orderId as string };
    };
    const status = (id: string) => db.get(`ORDER#${id}`, 'META')?.status;
    const history = async () =>
      VendorDashboard.parse(parse(await handler(authed('GET', '/vendor/dashboard'))).body);

    // Back from Shopify, pick something else: the first checkout is replaced, not left behind.
    const first = await startCheckout('A1');
    const second = await startCheckout('A2');
    expect(status(first.orderId)).toBe('cancelled');
    expect(status(second.orderId)).toBe('pending_payment');
    expect(shop.deletedDrafts).toEqual(['draft-1']);

    // A checkout in progress is left alone, and unpaid orders stay out of the booking history.
    let dash = await history();
    expect(status(second.orderId)).toBe('pending_payment');
    expect(dash.history).toEqual([]);
    expect(dash.balanceDueCents).toBe(20000);

    // Once its hold lapses it is abandoned too.
    const item = db.get(`EVENT#${EVENT_ID}`, 'HOLD#2026-10-24#A2')!;
    db.put({ ...item, expiresAt: new Date(Date.now() - 1000).toISOString() });
    dash = await history();
    expect(status(second.orderId)).toBe('cancelled');
    expect(shop.deletedDrafts).toEqual(['draft-1', 'draft-2']);
    expect(dash.history).toEqual([]);
    expect(dash.balanceDueCents).toBe(0);

    // If an old invoice is paid anyway and its table is still free, the payment books it.
    const late = parse(
      await webhookHandler(
        webhook('orders/paid', {
          id: 4242,
          total_price: '200.00',
          note_attributes: [{ name: 'orderId', value: first.orderId }],
        }),
      ),
    );
    expect(late.body).toMatchObject({ orderId: first.orderId, late: true });
    expect(status(first.orderId)).toBe('paid');
    expect(shop.refunds).toEqual([]);
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')?.orderId).toBe(first.orderId);

    // If its table went to someone else meanwhile, the money goes straight back.
    db.put({
      ...keys.bookedTable(EVENT_ID, '2026-10-24', 'A2'),
      tableId: 'A2',
      date: '2026-10-24',
      orderId: 'other',
      vendorId: 'v2',
    });
    const lost = parse(
      await webhookHandler(
        webhook('orders/paid', {
          id: 4243,
          total_price: '200.00',
          note_attributes: [{ name: 'orderId', value: second.orderId }],
        }),
      ),
    );
    expect(lost.body).toMatchObject({ orderId: second.orderId, conflict: true });
    expect(status(second.orderId)).toBe('conflict');
    expect(shop.refunds).toEqual([
      expect.objectContaining({ orderId: '4243', amountCents: 20000 }),
    ]);
    expect(db.get('SHOPIFYORDER#4243', 'ORDER')?.orderId).toBe(second.orderId);
  });

  it('rejects anyone without a vendor and expired holds', async () => {
    db.items.delete(`VENDOR#${VENDOR}\u0000MEMBER#${SUB}`);
    const res = parse(
      await handler(
        authed('POST', `/vendor/events/${EVENT_ID}/holds`, {
          lines: [{ tableId: 'A1', dates: ['2026-10-24'] }],
          rate: 'standard',
        }),
      ),
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('no_vendor');
  });

  it('410s a hold that expired', async () => {
    const held = parse(
      await handler(
        authed('POST', `/vendor/events/${EVENT_ID}/holds`, {
          lines: [{ tableId: 'A1', dates: ['2026-10-24'] }],
          rate: 'standard',
        }),
      ),
    );
    const id = held.body.hold.id;
    const it = db.get(`EVENT#${EVENT_ID}`, 'HOLD#2026-10-24#A1')!;
    db.put({ ...it, expiresAt: new Date(Date.now() - 1000).toISOString() });
    const res = parse(await handler(authed('GET', `/vendor/holds/${id}`)));
    expect(res.status).toBe(410);
  });
});

describe('vendor profile', () => {
  it('reads and updates the profile, keeping the vendor list index in step', async () => {
    const got = parse(await handler(authed('GET', '/vendor/profile')));
    expect(got.status).toBe(200);
    expect(VendorProfile.parse(got.body).logoUrl).toBeUndefined();

    const patched = parse(
      await handler(
        authed('PATCH', '/vendor/profile', {
          businessName: 'Maya & Co',
          email: 'other@example.com',
          sellsDescription: 'Vintage singles and slabs',
          socials: { instagram: 'mayaco' },
        }),
      ),
    );
    expect(patched.status).toBe(200);
    const p = VendorProfile.parse(patched.body);
    expect(p.businessName).toBe('Maya & Co');
    expect(p.email).toBe('maya@cardcorner.com'); // not editable; unknown keys are dropped
    expect(p.sellsDescription).toBe('Vintage singles and slabs');
    expect(p.socials.instagram).toBe('mayaco');
    const k = keys.vendor(VENDOR);
    expect(db.get(k.PK, k.SK)?.GSI1SK).toBe('maya & co');

    // The next hold is seeded from the updated profile.
    const held = parse(
      await handler(
        authed('POST', `/vendor/events/${EVENT_ID}/holds`, {
          lines: [{ tableId: 'B3', dates: ['2026-10-24'] }],
          rate: 'standard',
        }),
      ),
    );
    expect(HoldResponse.parse(held.body).prefill).toMatchObject({
      tableName: 'Maya & Co',
      sellsDescription: 'Vintage singles and slabs',
    });
  });

  it('presigns a logo upload under the vendor prefix and rejects foreign keys', async () => {
    setPresigner(
      async (key, type) => `https://bucket.test/${key}?type=${encodeURIComponent(type)}`,
    );
    try {
      const up = parse(
        await handler(authed('POST', '/vendor/profile/logo-upload', { contentType: 'image/png' })),
      );
      expect(up.status).toBe(201);
      const u = LogoUploadResponse.parse(up.body);
      expect(u.key).toMatch(new RegExp(`^vendors/${VENDOR}/logo-[0-9a-z]{26}\\.png$`));
      expect(u.uploadUrl).toContain(u.key);
      expect(u.logoUrl).toBe(`https://media.test/vendors/${VENDOR}/${u.key.split('/').pop()}`);

      const saved = parse(await handler(authed('PATCH', '/vendor/profile', { logoKey: u.key })));
      expect(VendorProfile.parse(saved.body).logoUrl).toBe(u.logoUrl);

      const foreign = parse(
        await handler(authed('PATCH', '/vendor/profile', { logoKey: 'vendors/other/logo.png' })),
      );
      expect(foreign.status).toBe(400);
      const badType = parse(
        await handler(authed('POST', '/vendor/profile/logo-upload', { contentType: 'image/gif' })),
      );
      expect(badType.status).toBe(400);
    } finally {
      setPresigner(undefined);
    }
  });
});

describe('webhooks', () => {
  it('rejects bad signatures and acknowledges unknown topics and orders', async () => {
    const bad = parse(await webhookHandler(webhook('orders/paid', { id: 1 }, 'wrong')));
    expect(bad.status).toBe(401);
    const unknownTopic = parse(await webhookHandler(webhook('products/update', { id: 1 })));
    expect(unknownTopic.status).toBe(200);
    const unknownOrder = parse(
      await webhookHandler(webhook('orders/paid', { id: 1, note_attributes: [] })),
    );
    expect(unknownOrder.body.ignored).toBe('unknown_order');
  });

  it('refunds and marks conflict when the table was taken before payment landed, then frees on refunds/create', async () => {
    const held = parse(
      await handler(
        authed('POST', `/vendor/events/${EVENT_ID}/holds`, {
          lines: [{ tableId: 'A1', dates: ['2026-10-24'] }],
          rate: 'standard',
        }),
      ),
    );
    await handler(authed('PATCH', `/vendor/holds/${held.body.hold.id}`, { vendorInfo }));
    const co = parse(await handler(authed('POST', `/vendor/holds/${held.body.hold.id}/checkout`)));
    // Hold lapses and another vendor books the day while the checkout is open.
    db.items.delete(`EVENT#${EVENT_ID}\u0000HOLD#2026-10-24#A1`);
    db.put({
      ...keys.bookedTable(EVENT_ID, '2026-10-24', 'A1'),
      tableId: 'A1',
      date: '2026-10-24',
      orderId: 'other',
      vendorId: 'v2',
    });
    const paid = parse(
      await webhookHandler(
        webhook('orders/paid', {
          id: 999,
          total_price: '200.00',
          note_attributes: [{ name: 'orderId', value: co.body.orderId }],
        }),
      ),
    );
    expect(paid.body.conflict).toBe(true);
    expect(shop.refunds).toEqual([expect.objectContaining({ orderId: '999', amountCents: 20000 })]);
    expect(db.get(`ORDER#${co.body.orderId}`, 'META')?.status).toBe('conflict');
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')?.orderId).toBe('other');
    // Shopify's refund webhook then lands; the conflict order becomes refunded without touching the other booking.
    shop.orders.set('999', shopifyOrder('999', 20000, 20000));
    const refunded = parse(
      await webhookHandler(webhook('refunds/create', { id: 5, order_id: 999 })),
    );
    expect(refunded.status).toBe(200);
    expect(db.get(`ORDER#${co.body.orderId}`, 'META')?.status).toBe('refunded');
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')?.orderId).toBe('other');
  });
  /** Maya checks out table A1 for Saturday; returns the FGG order id. */
  async function checkoutA1(): Promise<string> {
    const held = parse(
      await handler(
        authed('POST', `/vendor/events/${EVENT_ID}/holds`, {
          lines: [{ tableId: 'A1', dates: ['2026-10-24'] }],
          rate: 'standard',
        }),
      ),
    );
    await handler(authed('PATCH', `/vendor/holds/${held.body.hold.id}`, { vendorInfo }));
    const co = parse(await handler(authed('POST', `/vendor/holds/${held.body.hold.id}/checkout`)));
    return co.body.orderId as string;
  }
  const pay = (orderId: string, id: number, total = '200.00') =>
    webhookHandler(
      webhook('orders/paid', {
        id,
        total_price: total,
        note_attributes: [{ name: 'orderId', value: orderId }],
      }),
    );
  const refundHook = (id: number, orderId: number) =>
    webhookHandler(webhook('refunds/create', { id, order_id: orderId }));
  const orderStatus = (id: string) => db.get(`ORDER#${id}`, 'META')?.status;
  /** The order as the API reads it (no index keys). */
  const stored = (id: string): Order => {
    const {
      PK: _p,
      SK: _s,
      GSI1PK: _a,
      GSI1SK: _b,
      GSI2PK: _c,
      GSI2SK: _d,
      ...o
    } = db.get(`ORDER#${id}`, 'META')!;
    return o as Order;
  };

  it('books only a payment that covers the order', async () => {
    const id = await checkoutA1();
    expect(parse(await pay(id, 501, '1.00')).body.ignored).toBe('amount_mismatch');
    const noAmount = parse(
      await webhookHandler(
        webhook('orders/paid', { id: 502, note_attributes: [{ name: 'orderId', value: id }] }),
      ),
    );
    expect(noAmount.body.ignored).toBe('amount_mismatch');
    expect(orderStatus(id)).toBe('pending_payment');
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')).toBeUndefined();
    // Paying more (a tip) is fine.
    expect(parse(await pay(id, 503, '205.00')).body.passNumber).toBe('HF26-001');
    expect(orderStatus(id)).toBe('paid');
  });

  it('retries a transaction that only overlapped another, instead of refunding', async () => {
    const id = await checkoutA1();
    db.transactConflicts = 2;
    expect(parse(await pay(id, 601)).body.passNumber).toBe('HF26-001');
    expect(orderStatus(id)).toBe('paid');
    expect(shop.refunds).toEqual([]);
  });

  it('treats a duplicate delivery that lands mid-booking as already done', async () => {
    const id = await checkoutA1();
    // The first delivery commits just as the second one writes.
    db.beforeTransact = () =>
      db.put({ ...db.get(`ORDER#${id}`, 'META')!, status: 'paid', shopifyOrderId: '701' });
    expect(parse(await pay(id, 701)).body.idempotent).toBe(true);
    expect(orderStatus(id)).toBe('paid');
    expect(shop.refunds).toEqual([]);
  });

  it('never lets the sweep cancel an order that was paid a moment ago', async () => {
    const id = await checkoutA1();
    const lagging = stored(id); // what the index still shows: unpaid, and the hold is gone
    db.beforeTransact = () =>
      db.put({ ...db.get(`ORDER#${id}`, 'META')!, status: 'paid', shopifyOrderId: '801' });
    const after = await cancelAbandonedCheckout(lagging);
    expect(after.status).toBe('paid');
    expect(orderStatus(id)).toBe('paid');
    expect(shop.deletedDrafts).toEqual([]);
  });

  it("doesn't let a late payment take a table another vendor is checking out with", async () => {
    const id = await checkoutA1();
    // Maya's hold lapsed and another vendor holds A1 now, mid-checkout.
    db.put({
      ...db.get(`EVENT#${EVENT_ID}`, 'HOLD#2026-10-24#A1')!,
      holdId: '01HZX3V9K7Q2M4N8P6R5T1W0YQ',
      vendorId: 'v2',
      GSI1PK: 'VENDOR#v2',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(parse(await pay(id, 901)).body.conflict).toBe(true);
    expect(db.get(`EVENT#${EVENT_ID}`, 'HOLD#2026-10-24#A1')?.vendorId).toBe('v2');
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')).toBeUndefined();
    expect(shop.refunds).toEqual([expect.objectContaining({ orderId: '901', amountCents: 20000 })]);
  });

  it('keeps the booking on a partial Shopify refund and frees it on a full one', async () => {
    const id = await checkoutA1();
    await pay(id, 1001);
    shop.orders.set('1001', shopifyOrder('1001', 20000, 500));
    expect(parse(await refundHook(1, 1001)).body.partialRefundCents).toBe(500);
    expect(orderStatus(id)).toBe('paid');
    expect(stored(id).refundedCents).toBe(500);
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')?.orderId).toBe(id);
    await refundHook(1, 1001); // duplicate delivery: nothing changes
    expect(stored(id).refundedCents).toBe(500);

    shop.orders.set('1001', shopifyOrder('1001', 20000, 20000));
    expect(parse(await refundHook(2, 1001)).status).toBe(200);
    expect(orderStatus(id)).toBe('refunded');
    expect(stored(id).refundedCents).toBeUndefined();
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')).toBeUndefined();
  });

  it('refunds once when staff click twice, and the refund webhook waits for the staff refund', async () => {
    const id = await checkoutA1();
    await pay(id, 1101);
    const order = stored(id);
    // Shopify is slow to answer: a second click and Shopify's webhook arrive in the meantime.
    const during: { second?: any; hook?: any } = {};
    const refund = shop.refundOrder.bind(shop);
    shop.refundOrder = async (orderId, amountCents, note) => {
      during.second = await refundOrCancel(order, event, SUB, 'again').catch((e: unknown) => e);
      shop.orders.set('1101', shopifyOrder('1101', 20000, 20000));
      during.hook = parse(await refundHook(3, 1101));
      return refund(orderId, amountCents, note);
    };
    const done = await refundOrCancel(order, event, SUB, 'cancellation approved');
    expect(done.status).toBe('refunded');
    expect(during.second).toMatchObject({ status: 409, code: 'refund_in_progress' });
    expect(during.hook.status).toBe(409);
    expect(shop.refunds).toHaveLength(1);
    expect(db.get(`ORDER#${id}`, 'META')?.refundingAt).toBeUndefined();
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')).toBeUndefined();
    // Shopify retries the webhook later; by then there is nothing to do.
    expect(parse(await refundHook(3, 1101)).body.idempotent).toBe(true);
  });

  it("counts a staff refund as done when Shopify's webhook closed the order first", async () => {
    const id = await checkoutA1();
    await pay(id, 1201);
    db.beforeTransact = () => db.put({ ...db.get(`ORDER#${id}`, 'META')!, status: 'refunded' });
    const done = await refundOrCancel(stored(id), event, SUB, 'approved');
    expect(done.status).toBe('refunded');
    expect(shop.refunds).toHaveLength(1);
  });

  it('kills the invoice when staff cancel an unpaid order', async () => {
    const id = await checkoutA1();
    const done = await refundOrCancel(stored(id), event, SUB, 'vendor asked');
    expect(done.status).toBe('cancelled');
    expect(shop.deletedDrafts).toEqual(['draft-1']);
  });

  it('lets staff try again after Shopify refuses a refund', async () => {
    const id = await checkoutA1();
    await pay(id, 1301);
    shop.failRefunds = true;
    await expect(refundOrCancel(stored(id), event, SUB, 'approved')).rejects.toThrow();
    expect(orderStatus(id)).toBe('paid');
    expect(db.get(`ORDER#${id}`, 'META')?.refundingAt).toBeUndefined();
    shop.failRefunds = false;
    expect((await refundOrCancel(stored(id), event, SUB, 'approved')).status).toBe('refunded');
  });
});
