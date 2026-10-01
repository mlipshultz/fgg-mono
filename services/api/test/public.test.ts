/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { EventAvailability, GalleryPage, HomeContent, Ok } from '@fgg/types';
import { EVENT_ID, event, floorPlan, parse, req, venue } from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';
process.env.WEB_ORIGINS = 'http://localhost:3000';

const ddb = mockClient(DynamoDBDocumentClient);
const { handler } = await import('../src/handlers/public.js');
const { clearVenueCache } = await import('../src/lib/events.js');
const { keys } = await import('../src/lib/db.js');

const storedEvent = { ...keys.eventIndex(event), ...event };
const gallery = [
  {
    ...keys.galleryItem(EVENT_ID, 1),
    type: 'photo',
    id: '01HZX3V9K7Q2M4N8P6R5T1W0YC',
    eventId: EVENT_ID,
    eventName: 'Halloween Fest',
    eventLabel: 'Halloween Fest 2026',
    mediaKey: 'gallery/h/1.jpg',
    featured: true,
    sortOrder: 1,
  },
  {
    ...keys.galleryItem(EVENT_ID, 2),
    type: 'quote',
    id: '01HZX3V9K7Q2M4N8P6R5T1W0YD',
    eventId: EVENT_ID,
    eventName: 'Halloween Fest',
    eventLabel: 'Halloween Fest 2026',
    text: 'Best day ever.',
    sortOrder: 2,
  },
];

function stubReads(opts: { holds?: unknown[]; tables?: unknown[] } = {}) {
  ddb.on(QueryCommand).callsFake((input: any) => {
    const v = input.ExpressionAttributeValues ?? {};
    if (input.IndexName === 'GSI1' && v[':pk'] === 'EVENTS#published')
      return { Items: [storedEvent] };
    if (input.IndexName === 'GSI2')
      return { Items: v[':pk'] === `SLUG#${event.slug}` ? [storedEvent] : [] };
    if (v[':pk'] === `EVENT#${EVENT_ID}` && v[':sk'] === 'HOLD#')
      return { Items: opts.holds ?? [] };
    if (v[':pk'] === `EVENT#${EVENT_ID}` && v[':sk'] === 'TABLE#')
      return { Items: opts.tables ?? [] };
    if (v[':pk'] === 'CONFIG' && v[':sk'] === 'ACTIVITY#')
      return {
        Items: [{ id: 'trading', name: 'Trading', description: 'Swap', xp: 25, sortOrder: 1 }],
      };
    if (v[':pk'] === 'CONFIG' && v[':sk'] === 'PARTNER#')
      return {
        Items: [
          {
            id: '01HZX3V9K7Q2M4N8P6R5T1W0YE',
            name: 'P1',
            logoKey: 'partners/p1.png',
            sortOrder: 1,
          },
        ],
      };
    if (v[':pk'] === 'GALLERY') {
      if (input.ProjectionExpression) return { Items: gallery };
      const items = input.FilterExpression?.includes('featured')
        ? gallery.filter((g) => (g as any).featured)
        : gallery;
      return input.Limit === 1
        ? { Items: items.slice(0, 1), LastEvaluatedKey: { PK: 'GALLERY', SK: items[0]!.SK } }
        : { Items: items };
    }
    return { Items: [] };
  });
  ddb.on(GetCommand).callsFake((input: any) => {
    if (input.Key.PK === `VENUE#${venue.id}` && input.Key.SK === 'META') return { Item: venue };
    if (input.Key.PK === `VENUE#${venue.id}` && input.Key.SK === 'FLOORPLAN')
      return { Item: floorPlan };
    if (input.Key.PK === `EVENT#${EVENT_ID}`) return { Item: storedEvent };
    if (input.Key.PK === 'CONFIG')
      return {
        Item: { contactEmail: 'hi@fgg.test', social: { instagram: 'https://instagram.com/fgg' } },
      };
    return {};
  });
  ddb.on(PutCommand).resolves({});
}

beforeEach(() => {
  ddb.reset();
  clearVenueCache();
  vi.useRealTimers();
});

describe('GET /public/home', () => {
  it('returns HomeContent with resolved venue, poster URL and live table count', async () => {
    stubReads({ tables: [{ tableId: 'A1', date: '2026-10-24' }] });
    const r = parse(await handler(req('GET', '/public/home', { origin: 'http://localhost:3000' })));
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const body = HomeContent.parse(r.body);
    expect(body.events).toHaveLength(1);
    const ev = body.events[0]!;
    expect(ev.venue.name).toBe('Maryland State Fairgrounds');
    expect(ev.posterUrl).toBe('https://media.test/events/halloween-fest-2026/poster.jpg');
    expect(ev.hoursLabel).toBe('11am–5pm');
    expect(ev.startDate).toBe('2026-10-24');
    expect(ev.tablesLeft).toBe(6); // A1 is taken one day but still bookable the other
    expect(body.activities[0]).not.toHaveProperty('PK');
    expect(body.partners[0]!.logoUrl).toBe('https://media.test/partners/p1.png');
    expect(body.galleryTeaser).toHaveLength(1);
    expect(body.settings.contactEmail).toBe('hi@fgg.test');
    expect(body.settings.social.instagram).toBe('https://instagram.com/fgg');
  });
});

describe('GET /public/events/{id}/availability', () => {
  it('ignores expired holds, counts live ones, and resolves slugs', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    stubReads({
      holds: [
        { tableId: 'A2', date: '2026-10-24', expiresAt: past },
        { tableId: 'A3', date: '2026-10-24', expiresAt: future },
      ],
      tables: [{ tableId: 'B1', date: '2026-10-25' }],
    });
    const r = parse(await handler(req('GET', '/public/events/halloween-fest-2026/availability')));
    expect(r.status).toBe(200);
    const body = EventAvailability.parse(r.body);
    expect(body.tablesLeft).toBe(6); // A3 and B1 each still have an open day
    expect(body.days[0]!.unavailable).toEqual(['A3']);
    expect(body.days[1]!.unavailable).toEqual(['B1']);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('404s for unknown events', async () => {
    stubReads();
    const r = parse(await handler(req('GET', '/public/events/nope/availability')));
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('event_not_found');
  });
});

describe('GET /public/gallery', () => {
  it('pages with an opaque cursor and lists the events that have items', async () => {
    stubReads();
    const r = parse(await handler(req('GET', '/public/gallery', { query: { limit: '1' } })));
    expect(r.status).toBe(200);
    const body = GalleryPage.parse(r.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.type).toBe('photo');
    expect(body.nextCursor).toBeTypeOf('string');
    expect(body.events).toEqual([{ id: EVENT_ID, label: 'Halloween Fest 2026' }]);
    // the cursor round-trips into ExclusiveStartKey
    const r2 = parse(
      await handler(
        req('GET', '/public/gallery', { query: { limit: '1', cursor: body.nextCursor! } }),
      ),
    );
    expect(r2.status).toBe(200);
    const call = ddb
      .commandCalls(QueryCommand)
      .find((c) => (c.args[0].input as any).ExclusiveStartKey);
    expect((call!.args[0].input as any).ExclusiveStartKey).toEqual({
      PK: 'GALLERY',
      SK: gallery[0]!.SK,
    });
  });

  it('rejects a malformed cursor', async () => {
    stubReads();
    const r = parse(await handler(req('GET', '/public/gallery', { query: { cursor: '!!!' } })));
    expect(r.status).toBe(400);
  });
});

describe('POST handlers', () => {
  it('subscribe stores a lower-cased email', async () => {
    stubReads();
    const r = parse(
      await handler(req('POST', '/public/subscribe', { body: { email: 'Fan@Example.com' } })),
    );
    expect(r.status).toBe(200);
    expect(Ok.parse(r.body)).toEqual({ ok: true });
    const put = ddb.commandCalls(PutCommand)[0]!.args[0].input as any;
    expect(put.Item.SK).toBe('SUB#fan@example.com');
    expect(put.Item.source).toBe('email_band');
  });

  it('subscribe rejects a bad email with validation details', async () => {
    stubReads();
    const r = parse(await handler(req('POST', '/public/subscribe', { body: { email: 'nope' } })));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_failed');
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('contact requires name, email and message', async () => {
    stubReads();
    const bad = parse(
      await handler(req('POST', '/public/contact', { body: { name: 'A', email: 'a@b.co' } })),
    );
    expect(bad.status).toBe(400);
    const good = parse(
      await handler(
        req('POST', '/public/contact', {
          body: { name: 'A', email: 'a@b.co', message: 'Hi', interests: ['sponsor'] },
        }),
      ),
    );
    expect(good.status).toBe(200);
    const put = ddb.commandCalls(PutCommand)[0]!.args[0].input as any;
    expect(put.Item.PK).toBe('CONTACT');
    expect(put.Item.SK).toMatch(/^MSG#\d{4}-/);
  });

  it('waitlist writes under the event with the right prefix', async () => {
    stubReads();
    const r = parse(
      await handler(
        req('POST', `/public/events/${EVENT_ID}/waitlist`, {
          body: { email: 'v@x.co', kind: 'notify_me' },
        }),
      ),
    );
    expect(r.status).toBe(200);
    const put = ddb.commandCalls(PutCommand)[0]!.args[0].input as any;
    expect(put.Item.PK).toBe(`EVENT#${EVENT_ID}`);
    expect(put.Item.SK).toMatch(/^NOTIFY#/);
  });

  it('rejects invalid JSON and unknown routes', async () => {
    stubReads();
    const bad = req('POST', '/public/subscribe');
    (bad as any).body = '{not json';
    expect(parse(await handler(bad)).status).toBe(400);
    expect(parse(await handler(req('GET', '/public/nope'))).status).toBe(404);
  });
});
