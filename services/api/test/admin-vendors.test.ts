/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminVendor, AdminVendorList } from '@fgg/types';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { FakeDdb } from './fake-ddb.js';
import { EVENT_ID, parse, req as baseReq } from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';
process.env.WEB_ORIGINS = 'http://localhost:3000';
process.env.USER_POOL_ID = 'us-east-1_test';

const db = new FakeDdb();
const { keys } = await import('../src/lib/db.js');
const { setPresigner } = await import('../src/lib/media.js');
const { handler } = await import('../src/handlers/account.js');

const MAYA = '01HZX3V9K7Q2M4N8P6R5T1W0YD';
const PLUSH = '01HZX3V9K7Q2M4N8P6R5T1W0YE';
function as(groups: string[]) {
  return (method: any, path: string, body?: unknown): APIGatewayProxyEventV2 => {
    const r = baseReq(method, path, { body }) as any;
    r.requestContext.authorizer = {
      jwt: {
        claims: {
          sub: '9f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d',
          email: 'staff@example.com',
          'cognito:groups': groups,
        },
        scopes: [],
      },
    };
    return r;
  };
}
const staff = as(['staff']);
const vendorUser = as(['vendor', 'attendee']);

function vendor(id: string, businessName: string, status: 'active' | 'suspended') {
  db.put({
    ...keys.vendorIndex({ id, status, businessName }),
    id,
    businessName,
    contactName: 'Someone',
    email: `${id.slice(-4).toLowerCase()}@example.com`,
    phone: '4105550100',
    sells: ['pokemon_cards'],
    sellsDescription: 'Cards',
    socials: {},
    pokeBucksPartner: false,
    status,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  });
}
function member(vendorId: string, sub: string) {
  db.put({
    ...keys.vendorMember(vendorId, sub),
    vendorId,
    userId: sub,
    role: 'owner',
    addedBy: 'x',
    addedAt: '2026-09-01T00:00:00Z',
  });
}
function order(id: string, ownerId: string, status: string) {
  db.put({
    PK: `ORDER#${id}`,
    SK: 'META',
    GSI1PK: `OWNER#${ownerId}`,
    GSI1SK: `ORDER#2026-10-24#${id}`,
    id,
    eventId: EVENT_ID,
    ownerId,
    status,
  });
}

beforeEach(() => {
  db.reset();
  vendor(MAYA, "Maya's Card Corner", 'active');
  vendor(PLUSH, 'Plush Pals', 'suspended');
  member(MAYA, '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d');
  member(MAYA, '3f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d');
  order('o1', MAYA, 'paid');
  order('o2', MAYA, 'refunded');
  order('o3', MAYA, 'paid');
});

describe('admin vendors', () => {
  it('lists active and suspended vendors by name with members and paid bookings', async () => {
    const list = AdminVendorList.parse(parse(await handler(staff('GET', '/admin/vendors'))).body);
    expect(
      list.items.map((v) => [v.businessName, v.status, v.memberCount, v.paidOrderCount]),
    ).toEqual([
      ["Maya's Card Corner", 'active', 2, 2],
      ['Plush Pals', 'suspended', 0, 0],
    ]);
    expect(parse(await handler(vendorUser('GET', '/admin/vendors'))).status).toBe(403);
  });

  it('edits a vendor on its behalf, including status and the PokéBucks partner flag', async () => {
    const res = parse(
      await handler(
        staff('PATCH', `/admin/vendors/${MAYA}`, {
          businessName: 'Maya Cards',
          email: 'Maya@CardCorner.com',
          sells: ['pokemon_cards', 'graded'],
          socials: { instagram: 'mayacards' },
          status: 'suspended',
          pokeBucksPartner: true,
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(AdminVendor.parse(res.body)).toMatchObject({
      businessName: 'Maya Cards',
      email: 'maya@cardcorner.com',
      status: 'suspended',
      pokeBucksPartner: true,
      sells: ['pokemon_cards', 'graded'],
    });
    // The list index follows the new name and status.
    expect(db.get(`VENDOR#${MAYA}`, 'META')).toMatchObject({
      GSI1PK: 'VENDORS#suspended',
      GSI1SK: 'maya cards',
    });
    const reactivated = parse(
      await handler(
        staff('PATCH', `/admin/vendors/${MAYA}`, { status: 'active', pokeBucksPartner: false }),
      ),
    );
    expect(reactivated.body).toMatchObject({ status: 'active', pokeBucksPartner: false });

    const bad = parse(
      await handler(
        staff('PATCH', `/admin/vendors/${MAYA}`, { logoKey: `vendors/${PLUSH}/logo.png` }),
      ),
    );
    expect(bad.body.error.code).toBe('bad_logo_key');
    expect(
      parse(await handler(staff('PATCH', `/admin/vendors/${EVENT_ID}`, { phone: '4105550199' })))
        .status,
    ).toBe(404);
    expect(
      parse(await handler(vendorUser('PATCH', `/admin/vendors/${MAYA}`, { status: 'active' })))
        .status,
    ).toBe(403);
  });

  it('presigns a logo upload under the vendor', async () => {
    setPresigner(async (key) => `https://upload.test/${key}`);
    const res = parse(
      await handler(
        staff('POST', `/admin/vendors/${PLUSH}/logo-upload`, { contentType: 'image/png' }),
      ),
    );
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(new RegExp(`^vendors/${PLUSH}/logo-[0-9a-z]{26}\\.png$`));
    const saved = parse(
      await handler(staff('PATCH', `/admin/vendors/${PLUSH}`, { logoKey: res.body.key })),
    );
    expect(saved.body.logoUrl).toBe(`https://media.test/${res.body.key}`);
    setPresigner(undefined);
  });
});
