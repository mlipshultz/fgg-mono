/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { Vendor, VendorApplication, VendorStanding } from '@fgg/types';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { FakeDdb } from './fake-ddb.js';
import { EVENT_ID, event, floorPlan, parse, req as baseReq, venue } from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';
process.env.WEB_ORIGINS = 'http://localhost:3000';
process.env.USER_POOL_ID = 'us-east-1_test';
process.env.SHOPIFY_SECRET_ID = 'fgg/test/shopify';

const db = new FakeDdb();
const cognito = mockClient(CognitoIdentityProviderClient);
const { keys } = await import('../src/lib/db.js');
const { clearVenueCache } = await import('../src/lib/events.js');
const { FakeShopifyClient, setShopifyClient } = await import('../src/lib/shopify.js');
const { handler } = await import('../src/handlers/account.js');

const SUB = '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';
const ADMIN = '9f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';
const user = (sub: string, roles: string[]) => ({
  ...keys.userIndex({
    sub,
    email: `${sub.slice(0, 4)}@example.com`,
    createdAt: '2026-04-01T00:00:00Z',
  }),
  sub,
  email: `${sub.slice(0, 4)}@example.com`,
  displayName: 'Someone',
  birthYear: 1990,
  roles,
  memberSince: '2026-04-01T00:00:00Z',
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
});

function as(sub: string, groups: string[]) {
  return (
    method: any,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): APIGatewayProxyEventV2 => {
    const r = baseReq(method, path, { body, ...(query ? { query } : {}) }) as any;
    r.requestContext.authorizer = {
      jwt: {
        claims: { sub, email: `${sub.slice(0, 4)}@example.com`, 'cognito:groups': groups },
        scopes: [],
      },
    };
    return r;
  };
}
const applicant = as(SUB, ['attendee']);
const staff = as(ADMIN, ['superadmin', 'staff', 'attendee']);

const input = {
  businessName: "Maya's Card Corner",
  phone: '4105550100',
  sellsDescription: 'Modern singles and a bulk bin',
  pokeBucksInterest: true,
  codeOfConductAccepted: true,
  sealedPolicyAccepted: true,
};

beforeEach(() => {
  db.reset();
  cognito.reset();
  clearVenueCache();
  cognito.on(AdminAddUserToGroupCommand).resolves({});
  cognito.on(AdminRemoveUserFromGroupCommand).resolves({});
  setShopifyClient(new FakeShopifyClient());
  db.put(user(SUB, ['attendee']));
  db.put(user(ADMIN, ['superadmin', 'staff', 'attendee']));
  db.put({ ...keys.eventIndex(event), ...event });
  db.put({ ...keys.venue(venue.id), ...venue });
  db.put({ ...keys.floorPlan(venue.id), ...floorPlan });
});

describe('vendor applications', () => {
  it('submits once, shows up in the staff queue, and approval creates the vendor and flips roles', async () => {
    const empty = VendorStanding.parse(
      parse(await handler(applicant('GET', '/me/vendor-application'))).body,
    );
    expect(empty.application).toBeNull();
    expect(empty.approvalMode).toBe('manual_call');

    const created = parse(await handler(applicant('POST', '/me/vendor-application', input)));
    expect(created.status).toBe(201);
    const app = VendorApplication.parse(created.body);
    expect(app.status).toBe('submitted');
    // Contact details are taken from the account, not the form.
    expect(app.email).toBe(`${SUB.slice(0, 4)}@example.com`);
    expect(app.contactName).toBeTruthy();
    expect(cognito.commandCalls(AdminAddUserToGroupCommand)[0]!.args[0].input.GroupName).toBe(
      'vendor_applicant',
    );

    const dup = parse(await handler(applicant('POST', '/me/vendor-application', input)));
    expect(dup.status).toBe(409);

    const queue = parse(
      await handler(staff('GET', '/admin/vendor-applications', undefined, { status: 'submitted' })),
    );
    expect(queue.body.items.map((a: any) => a.id)).toEqual([app.id]);
    const forbidden = parse(await handler(applicant('GET', '/admin/vendor-applications')));
    expect(forbidden.status).toBe(403);

    const scheduled = parse(
      await handler(staff('POST', `/admin/vendor-applications/${app.id}/call-scheduled`)),
    );
    expect(scheduled.body.status).toBe('call_scheduled');

    const approved = parse(
      await handler(
        staff('POST', `/admin/vendor-applications/${app.id}/approve`, { notes: 'great call' }),
      ),
    );
    expect(approved.status).toBe(200);
    const vendor = Vendor.parse(approved.body);
    expect(vendor.pokeBucksPartner).toBe(true);
    expect(db.get(`VENDOR#${vendor.id}`, `MEMBER#${SUB}`)?.role).toBe('owner');
    expect(db.get(`USER#${SUB}`, 'META')?.roles).toEqual(['attendee', 'vendor']);
    expect(db.get(`USER#${SUB}`, 'META')?.vendorId).toBe(vendor.id);
    const groups = cognito
      .commandCalls(AdminAddUserToGroupCommand)
      .map((c) => c.args[0].input.GroupName);
    expect(groups).toContain('vendor');
    expect(cognito.commandCalls(AdminRemoveUserFromGroupCommand)[0]!.args[0].input.GroupName).toBe(
      'vendor_applicant',
    );

    const standing = VendorStanding.parse(
      parse(await handler(applicant('GET', '/me/vendor-application'))).body,
    );
    expect(standing.vendor?.id).toBe(vendor.id);
    expect(standing.application?.status).toBe('approved');
    const again = parse(await handler(applicant('POST', '/me/vendor-application', input)));
    expect(again.body.error.code).toBe('already_vendor');
  });

  it('rejects with notes and lets the applicant try again', async () => {
    const app = parse(await handler(applicant('POST', '/me/vendor-application', input))).body;
    const rejected = parse(
      await handler(
        staff('POST', `/admin/vendor-applications/${app.id}/reject`, { notes: 'not a fit' }),
      ),
    );
    expect(rejected.body.status).toBe('rejected');
    expect(rejected.body.reviewNotes).toBe('not a fit');
    const resubmit = parse(await handler(applicant('POST', '/me/vendor-application', input)));
    expect(resubmit.status).toBe(201);
  });

  it('auto-approves when the settings switch is on', async () => {
    db.put({ ...keys.settings(), vendorApprovalMode: 'auto_video_terms' });
    const res = parse(await handler(applicant('POST', '/me/vendor-application', input)));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('approved');
    expect(res.body.reviewedBy).toBe('system');
  });
});

describe('admin orders', () => {
  it('comps a table as a $0 paid order and lists it, then refunds/cancels it', async () => {
    const app = parse(await handler(applicant('POST', '/me/vendor-application', input))).body;
    const vendor = parse(
      await handler(staff('POST', `/admin/vendor-applications/${app.id}/approve`)),
    ).body;
    const comp = parse(
      await handler(
        staff('POST', '/admin/orders/comp', {
          eventId: EVENT_ID,
          vendorId: vendor.id,
          tableId: 'A3',
          dates: ['2026-10-24'],
          note: 'sponsor',
        }),
      ),
    );
    expect(comp.status).toBe(201);
    expect(comp.body).toMatchObject({
      status: 'paid',
      source: 'manual',
      totalCents: 0,
      passNumber: 'HF26-001',
    });
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A3')?.orderId).toBe(comp.body.id);

    const taken = parse(
      await handler(
        staff('POST', '/admin/orders/comp', {
          eventId: EVENT_ID,
          vendorId: vendor.id,
          tableId: 'A3',
          dates: ['2026-10-24'],
        }),
      ),
    );
    expect(taken.status).toBe(409);

    const list = parse(
      await handler(staff('GET', '/admin/orders', undefined, { eventId: EVENT_ID })),
    );
    expect(list.body.items.map((o: any) => o.id)).toContain(comp.body.id);
    const byStatus = parse(
      await handler(staff('GET', '/admin/orders', undefined, { status: 'paid' })),
    );
    expect(byStatus.body.items[0].event.name).toBe('Halloween Fest');

    const cancelled = parse(
      await handler(staff('POST', `/admin/orders/${comp.body.id}/refund`, { reason: 'no show' })),
    );
    expect(cancelled.body.status).toBe('cancelled');
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A3')).toBeUndefined();
  });

  it('registers webhooks for superadmin only', async () => {
    const res = parse(await handler(staff('POST', '/admin/shopify/register-webhooks')));
    expect(res.status).toBe(200);
    expect(res.body.created).toEqual(['ORDERS_PAID', 'REFUNDS_CREATE']);
    expect(res.body.callbackUrl).toBe('https://x/webhooks/shopify');
    const nope = parse(await handler(applicant('POST', '/admin/shopify/register-webhooks')));
    expect(nope.status).toBe(403);
  });
});
