/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminEvent, AdminEventList, PublicEventList } from '@fgg/types';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { FakeDdb } from './fake-ddb.js';
import { EVENT_ID, VENUE_ID, event, floorPlan, parse, req as baseReq, venue } from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';
process.env.WEB_ORIGINS = 'http://localhost:3000';
process.env.USER_POOL_ID = 'us-east-1_test';
process.env.STAGE = 'test';

const db = new FakeDdb();
const { keys } = await import('../src/lib/db.js');
const { clearVenueCache, zonedToUtcIso } = await import('../src/lib/events.js');
const { setPresigner } = await import('../src/lib/media.js');
const { setRebuildDispatcher } = await import('../src/lib/site-rebuild.js');
const { handler } = await import('../src/handlers/account.js');
const { handler: publicHandler } = await import('../src/handlers/public.js');

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
const staff = as(['staff', 'attendee']);
const vendor = as(['vendor', 'attendee']);

/** What the editor sends for a new two-day show at the seeded venue. */
const input = {
  name: 'Winter Fest',
  slug: 'winter-fest-2027',
  blurb: 'Snow-day trading.',
  venueId: VENUE_ID,
  days: [
    { date: '2027-01-24', opens: '11:00', closes: '17:00' },
    { date: '2027-01-23', opens: '10:00', closes: '18:00', vendorLoadIn: '08:00' },
  ],
  vendorStatus: 'coming_soon',
  tableRateCents: 20000,
  pokeBucksRateCents: 10000,
  tableBooking: 'floor_plan',
  published: false,
};

beforeEach(() => {
  db.reset();
  clearVenueCache();
  setRebuildDispatcher(undefined);
  delete process.env.GITHUB_SECRET_ID;
  db.put({ ...keys.eventIndex(event), ...event });
  db.put({ ...keys.venue(venue.id), ...venue });
  db.put({ ...keys.floorPlan(venue.id), ...floorPlan });
});

describe('zonedToUtcIso', () => {
  it('converts local show times on either side of a clock change', () => {
    expect(zonedToUtcIso('2026-10-24', '11:00', 'America/New_York')).toBe(
      '2026-10-24T15:00:00.000Z',
    );
    expect(zonedToUtcIso('2027-01-23', '11:00', 'America/New_York')).toBe(
      '2027-01-23T16:00:00.000Z',
    );
    expect(zonedToUtcIso('2026-11-01', '09:00', 'America/New_York')).toBe(
      '2026-11-01T14:00:00.000Z',
    );
    expect(zonedToUtcIso('2027-06-26', '10:30', 'America/Los_Angeles')).toBe(
      '2027-06-26T17:30:00.000Z',
    );
  });
});

describe('admin events', () => {
  it('creates a draft, lists it with the venues, and only shows it publicly once published', async () => {
    const created = parse(await handler(staff('POST', '/admin/events', input)));
    expect(created.status).toBe(201);
    const ev = AdminEvent.parse(created.body);
    // Days are sorted and the instants come from the venue's time zone.
    expect(ev.days.map((d) => d.date)).toEqual(['2027-01-23', '2027-01-24']);
    expect(ev).toMatchObject({
      startsAt: '2027-01-23T15:00:00.000Z',
      endsAt: '2027-01-24T22:00:00.000Z',
      timeZone: 'America/New_York',
      published: false,
    });
    expect(db.get(`EVENT#${ev.id}`, 'META')).toMatchObject({
      GSI1PK: 'EVENTS#draft',
      GSI2PK: 'SLUG#winter-fest-2027',
    });

    const list = AdminEventList.parse(parse(await handler(staff('GET', '/admin/events'))).body);
    expect(list.events.map((e) => e.slug)).toEqual(['winter-fest-2027', 'halloween-fest-2026']);
    expect(list.venues).toEqual([expect.objectContaining({ id: VENUE_ID, hasFloorPlan: true })]);
    const publicSlugs = async () =>
      PublicEventList.parse(
        parse(await publicHandler(baseReq('GET', '/public/events'))).body,
      ).events.map((e) => e.slug);
    expect(await publicSlugs()).not.toContain('winter-fest-2027');

    const published = parse(
      await handler(
        staff('PUT', `/admin/events/${ev.id}`, {
          ...input,
          published: true,
          slug: 'winter-fest',
          cardKey: 'events/card-01abc.jpg',
        }),
      ),
    );
    expect(published.status).toBe(200);
    expect(AdminEvent.parse(published.body).cardUrl).toBe(
      'https://media.test/events/card-01abc.jpg',
    );
    expect(db.get(`EVENT#${ev.id}`, 'META')).toMatchObject({
      GSI1PK: 'EVENTS#published',
      GSI2PK: 'SLUG#winter-fest',
      createdAt: ev.createdAt,
    });
    expect(await publicSlugs()).toContain('winter-fest');

    // Unpublishing drops it from the public list again; clearing the card image removes the key.
    await handler(staff('PUT', `/admin/events/${ev.id}`, { ...input, slug: 'winter-fest' }));
    expect(await publicSlugs()).not.toContain('winter-fest');
    expect(db.get(`EVENT#${ev.id}`, 'META')).not.toHaveProperty('cardKey');
  });

  it('validates the input and the link, and is for staff only', async () => {
    const post = async (patch: object) =>
      parse(await handler(staff('POST', '/admin/events', { ...input, ...patch })));
    expect((await post({ slug: 'halloween-fest-2026' })).body.error.code).toBe('slug_taken');
    expect((await post({ venueId: EVENT_ID })).body.error.code).toBe('venue_not_found');
    expect((await post({ tableBooking: 'quantity' })).body.error.code).toBe('capacity_required');
    expect((await post({ days: [input.days[0], input.days[0]] })).body.error.code).toBe(
      'duplicate_day',
    );
    expect(
      (await post({ days: [{ date: '2027-01-23', opens: '17:00', closes: '11:00' }] })).body.error
        .code,
    ).toBe('bad_hours');
    expect((await post({ posterKey: 'vendors/x/logo.png' })).body.error.code).toBe('bad_image_key');
    expect((await post({ tableBooking: 'quantity', tableCapacity: 40 })).status).toBe(201);
    expect(parse(await handler(vendor('GET', '/admin/events'))).status).toBe(403);
    expect(parse(await handler(vendor('POST', '/admin/events', input))).status).toBe(403);
    expect(parse(await handler(staff('PUT', `/admin/events/${VENUE_ID}`, input))).status).toBe(404);
  });

  it('will not open map booking at a venue without a floor plan', async () => {
    const made = parse(
      await handler(
        staff('POST', '/admin/venues', {
          name: 'Frederick Fairgrounds',
          address: '797 E Patrick St',
          city: 'Frederick',
          state: 'MD',
          timeZone: 'America/New_York',
        }),
      ),
    );
    expect(made.status).toBe(201);
    expect(made.body.hasFloorPlan).toBe(false);
    const open = { ...input, venueId: made.body.id, vendorStatus: 'open' };
    expect(parse(await handler(staff('POST', '/admin/events', open))).body.error.code).toBe(
      'no_floor_plan',
    );
    const byCount = { ...open, tableBooking: 'quantity', tableCapacity: 40 };
    expect(parse(await handler(staff('POST', '/admin/events', byCount))).status).toBe(201);
  });

  it('protects what vendors have booked: their days, the venue and the way the event books', async () => {
    db.put({
      ...keys.bookedTable(EVENT_ID, '2026-10-25', 'A1'),
      tableId: 'A1',
      date: '2026-10-25',
      orderId: 'o1',
      vendorId: 'v1',
    });
    const current = {
      name: event.name,
      slug: event.slug,
      blurb: event.blurb,
      venueId: event.venueId,
      days: event.days,
      vendorStatus: event.vendorStatus,
      tableRateCents: event.tableRateCents,
      pokeBucksRateCents: event.pokeBucksRateCents,
      tableBooking: 'floor_plan',
      posterKey: event.posterKey,
      published: true,
    };
    const put = async (patch: object) =>
      parse(await handler(staff('PUT', `/admin/events/${EVENT_ID}`, { ...current, ...patch })));
    expect((await put({ days: [event.days[0]] })).body.error).toMatchObject({
      code: 'day_has_bookings',
      message: '2026-10-25 has tables booked or held',
    });
    expect((await put({ tableBooking: 'quantity', tableCapacity: 40 })).body.error.code).toBe(
      'has_bookings',
    );
    const other = parse(
      await handler(
        staff('POST', '/admin/venues', { ...venue, id: undefined, name: 'Somewhere Else' }),
      ),
    );
    expect((await put({ venueId: other.body.id, vendorStatus: 'closed' })).body.error.code).toBe(
      'has_bookings',
    );
    // Everything else stays editable.
    const renamed = await put({ name: 'Halloween Fest 2026', tableRateCents: 22000 });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Halloween Fest 2026', tableRateCents: 22000 });
  });
});

describe('admin venues', () => {
  it('edits a venue and events follow its time zone', async () => {
    const saved = parse(
      await handler(
        staff('PUT', `/admin/venues/${VENUE_ID}`, {
          name: 'Maryland State Fairgrounds',
          address: '2200 York Road',
          city: 'Lutherville-Timonium',
          state: 'MD',
          timeZone: 'America/Chicago',
        }),
      ),
    );
    expect(saved.status).toBe(200);
    expect(db.get(`VENUE#${VENUE_ID}`, 'META')).toMatchObject({
      city: 'Lutherville-Timonium',
      GSI1PK: 'VENUES',
    });
    const ev = parse(await handler(staff('POST', '/admin/events', input)));
    expect(ev.body).toMatchObject({
      timeZone: 'America/Chicago',
      startsAt: '2027-01-23T16:00:00.000Z',
    });
    expect(parse(await handler(vendor('POST', '/admin/venues', saved.body))).status).toBe(403);
    expect(parse(await handler(staff('PUT', `/admin/venues/${EVENT_ID}`, saved.body))).status).toBe(
      404,
    );
  });
});

describe('image upload and site rebuild', () => {
  it('presigns poster and card uploads under events/', async () => {
    setPresigner(async (key, type) => `https://upload.test/${key}?type=${type}`);
    const res = parse(
      await handler(
        staff('POST', '/admin/events/image-upload', { kind: 'card', contentType: 'image/webp' }),
      ),
    );
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^events\/card-[0-9a-z]{26}\.webp$/);
    expect(res.body.url).toBe(`https://media.test/${res.body.key}`);
    const bad = parse(
      await handler(
        staff('POST', '/admin/events/image-upload', { kind: 'card', contentType: 'image/gif' }),
      ),
    );
    expect(bad.status).toBe(400);
    setPresigner(undefined);
  });

  it('asks for a rebuild of this stage, and says so plainly when that is not set up', async () => {
    const missing = parse(await handler(staff('POST', '/admin/site/rebuild')));
    expect(missing.status).toBe(409);
    expect(missing.body.error.code).toBe('rebuild_not_configured');
    const asked: string[] = [];
    setRebuildDispatcher(async (stage) => void asked.push(stage));
    expect(parse(await handler(staff('POST', '/admin/site/rebuild'))).status).toBe(202);
    expect(asked).toEqual(['test']);
    expect(parse(await handler(vendor('POST', '/admin/site/rebuild'))).status).toBe(403);
  });
});
