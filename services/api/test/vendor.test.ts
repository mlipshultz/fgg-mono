/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import {
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
import { EVENT_ID, event, floorPlan, parse, req as baseReq, venue } from './fixtures.js';

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
        authed('GET', `/vendor/events/${EVENT_ID}/quote`, undefined, {
          tableId: 'B2',
          dates: '2026-10-24,2026-10-25',
          rate: 'poke_bucks',
        }),
      ),
    );
    expect(quote.status).toBe(200);
    expect(quote.body.totalCents).toBe(20000);

    const held = parse(
      await handler(
        authed('POST', `/vendor/events/${EVENT_ID}/holds`, {
          tableId: 'B2',
          dates: ['2026-10-24', '2026-10-25'],
          rate: 'poke_bucks',
        }),
      ),
    );
    expect(held.status).toBe(201);
    const hr = HoldResponse.parse(held.body);
    expect(hr.quote.rowLabel).toBe('Row B · Main Hall');
    expect(hr.hold.dates).toHaveLength(2);
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
      totalCents: 20000,
      email: 'maya@cardcorner.com',
      attributes: { orderId: co.orderId, tableId: 'B2' },
    });
    expect(shop.drafts[0]!.title).toBe('Halloween Fest · Table B2 · Sat Oct 24 + Sun Oct 25');
    // Hold was extended for checkout.
    const holdItem = db.get(`EVENT#${EVENT_ID}`, 'HOLD#2026-10-24#B2')!;
    expect(new Date(holdItem.expiresAt).getTime()).toBeGreaterThan(Date.now() + 20 * 60_000);
    // Second checkout reuses the same draft.
    const again = parse(await handler(authed('POST', `/vendor/holds/${hr.hold.id}/checkout`)));
    expect(again.status).toBe(200);
    expect(again.body.orderId).toBe(co.orderId);
    expect(shop.drafts).toHaveLength(1);

    const paid = parse(
      await webhookHandler(
        webhook('orders/paid', {
          id: 777,
          name: '#1001',
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
    expect(d.events.map((e) => e.id)).not.toContain(EVENT_ID);

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
        tableId: 'B2',
        dates: ['2026-10-24', '2026-10-25'],
      }),
    ]);
    expect(JSON.stringify(who.body)).not.toContain('4105550100');
  });

  it('shows an empty vendor list before anyone has paid', async () => {
    const who = parse(await publicHandler(baseReq('GET', `/public/events/${EVENT_ID}/vendors`)));
    expect(who.status).toBe(200);
    expect(EventVendorList.parse(who.body).vendors).toEqual([]);
  });

  it('rejects anyone without a vendor and expired holds', async () => {
    db.items.delete(`VENDOR#${VENDOR}\u0000MEMBER#${SUB}`);
    const res = parse(
      await handler(
        authed('POST', `/vendor/events/${EVENT_ID}/holds`, {
          tableId: 'A1',
          dates: ['2026-10-24'],
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
          tableId: 'A1',
          dates: ['2026-10-24'],
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
          tableId: 'B3',
          dates: ['2026-10-24'],
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
          tableId: 'A1',
          dates: ['2026-10-24'],
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
          note_attributes: [{ name: 'orderId', value: co.body.orderId }],
        }),
      ),
    );
    expect(paid.body.conflict).toBe(true);
    expect(shop.refunds).toEqual([expect.objectContaining({ orderId: '999', amountCents: 20000 })]);
    expect(db.get(`ORDER#${co.body.orderId}`, 'META')?.status).toBe('conflict');
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')?.orderId).toBe('other');
    // Shopify's refund webhook then lands; the conflict order becomes refunded without touching the other booking.
    db.put({ ...keys.shopifyOrder('999'), orderId: co.body.orderId });
    const refunded = parse(
      await webhookHandler(webhook('refunds/create', { id: 5, order_id: 999 })),
    );
    expect(refunded.status).toBe(200);
    expect(db.get(`ORDER#${co.body.orderId}`, 'META')?.status).toBe('refunded');
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')?.orderId).toBe('other');
  });
});
