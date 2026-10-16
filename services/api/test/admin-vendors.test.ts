/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { AdminVendor, AdminVendorList, AdminVendorMemberList } from '@fgg/types';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { FakeDdb } from './fake-ddb.js';
import { EVENT_ID, event, parse, req as baseReq, venue } from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';
process.env.WEB_ORIGINS = 'http://localhost:3000';
process.env.USER_POOL_ID = 'us-east-1_test';

const db = new FakeDdb();
const cognito = mockClient(CognitoIdentityProviderClient);
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

const OWNER = '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';
const SECOND = '3f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';
const SAM = '4f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';
function user(sub: string, email: string, roles: string[], vendorId?: string) {
  db.put({
    ...keys.userIndex({ sub, email, createdAt: '2026-04-01T00:00:00Z' }),
    sub,
    email,
    displayName: email.split('@')[0],
    birthYear: 1990,
    roles,
    ...(vendorId ? { vendorId } : {}),
    memberSince: '2026-04-01T00:00:00Z',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  });
}

beforeEach(() => {
  db.reset();
  cognito.reset();
  cognito.on(AdminAddUserToGroupCommand).resolves({});
  cognito.on(AdminRemoveUserFromGroupCommand).resolves({});
  user(OWNER, 'maya@cardcorner.com', ['attendee', 'vendor'], MAYA);
  user(SECOND, 'jo@cardcorner.com', ['attendee', 'vendor'], MAYA);
  user(SAM, 'sam@example.com', ['attendee']);
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

  it('lists members, adds one by account email and removes one, keeping their roles in step', async () => {
    const members = async () =>
      AdminVendorMemberList.parse(
        parse(await handler(staff('GET', `/admin/vendors/${MAYA}/members`))).body,
      ).items.map((m) => [m.email, m.role]);
    // Owners first, then by when they joined (both seeded as owners here).
    expect(await members()).toEqual([
      ['maya@cardcorner.com', 'owner'],
      ['jo@cardcorner.com', 'owner'],
    ]);

    const add = (email: string, vendorId = MAYA) =>
      handler(staff('POST', `/admin/vendors/${vendorId}/members`, { email }));
    expect(parse(await add('nobody@example.com')).body.error.code).toBe('no_account');
    expect(parse(await add('jo@cardcorner.com')).body.error.code).toBe('already_member');
    expect(parse(await add('maya@cardcorner.com', PLUSH)).body.error.code).toBe('other_vendor');

    const added = parse(await add('Sam@Example.com'));
    expect(added.status).toBe(201);
    expect(added.body.items).toContainEqual(
      expect.objectContaining({ email: 'sam@example.com', role: 'member' }),
    );
    expect(db.get(`USER#${SAM}`, 'META')).toMatchObject({
      roles: ['attendee', 'vendor'],
      vendorId: MAYA,
    });
    expect(cognito.commandCalls(AdminAddUserToGroupCommand)[0]!.args[0].input).toMatchObject({
      Username: SAM,
      GroupName: 'vendor',
    });
    // The new member is matched to the vendor when they sign in.
    expect(db.get(`VENDOR#${MAYA}`, `MEMBER#${SAM}`)).toMatchObject({ GSI1PK: `USER#${SAM}` });

    const removed = parse(await handler(staff('DELETE', `/admin/vendors/${MAYA}/members/${SAM}`)));
    expect(removed.status).toBe(200);
    expect(removed.body.items).toHaveLength(2);
    expect(db.get(`VENDOR#${MAYA}`, `MEMBER#${SAM}`)).toBeUndefined();
    expect(db.get(`USER#${SAM}`, 'META')!.roles).toEqual(['attendee']);
    expect(db.get(`USER#${SAM}`, 'META')).not.toHaveProperty('vendorId');
    expect(cognito.commandCalls(AdminRemoveUserFromGroupCommand)[0]!.args[0].input).toMatchObject({
      Username: SAM,
      GroupName: 'vendor',
    });

    // The last member can't be removed; neither can someone who isn't a member.
    await handler(staff('DELETE', `/admin/vendors/${MAYA}/members/${SECOND}`));
    const last = parse(await handler(staff('DELETE', `/admin/vendors/${MAYA}/members/${OWNER}`)));
    expect(last.body.error.code).toBe('last_member');
    expect(
      parse(await handler(staff('DELETE', `/admin/vendors/${MAYA}/members/${SAM}`))).status,
    ).toBe(404);
    expect(parse(await handler(vendorUser('GET', `/admin/vendors/${MAYA}/members`))).status).toBe(
      403,
    );
  });

  it("filters the orders list to one vendor's orders", async () => {
    db.put({ ...keys.eventIndex(event), ...event });
    db.put({ ...keys.venue(venue.id), ...venue });
    // The bare orders from beforeEach only carry what the counts need; use full ones here.
    for (const id of ['o1', 'o2', 'o3']) db.items.delete(db.key(`ORDER#${id}`, 'META'));
    const full = (id: string, ownerId: string, status: string) =>
      db.put({
        PK: `ORDER#${id}`,
        SK: 'META',
        GSI1PK: `OWNER#${ownerId}`,
        GSI1SK: `ORDER#2026-10-24#${id}`,
        GSI2PK: `ORDERS#${status}`,
        GSI2SK: `2026-10-01#${id}`,
        id,
        eventId: EVENT_ID,
        kind: 'vendor_table',
        source: 'shopify',
        ownerId,
        placedBy: OWNER,
        status,
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
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });
    full('01HZX3V9K7Q2M4N8P6R5T1W0Y1', MAYA, 'paid');
    full('01HZX3V9K7Q2M4N8P6R5T1W0Y2', MAYA, 'refunded');
    full('01HZX3V9K7Q2M4N8P6R5T1W0Y3', PLUSH, 'paid');
    const ids = async (query: Record<string, string>) => {
      const r = baseReq('GET', '/admin/orders', { query }) as any;
      r.requestContext.authorizer = (staff('GET', '/x') as any).requestContext.authorizer;
      return parse(await handler(r))
        .body.items.map((o: any) => o.id)
        .sort();
    };
    expect(await ids({ vendorId: MAYA })).toEqual([
      '01HZX3V9K7Q2M4N8P6R5T1W0Y1',
      '01HZX3V9K7Q2M4N8P6R5T1W0Y2',
    ]);
    expect(await ids({ vendorId: MAYA, status: 'paid' })).toEqual(['01HZX3V9K7Q2M4N8P6R5T1W0Y1']);
  });
});
