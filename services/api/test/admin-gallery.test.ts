/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminGalleryItem, AdminGalleryList } from '@fgg/types';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { FakeDdb } from './fake-ddb.js';
import { EVENT_ID, event, parse, req as baseReq } from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';
process.env.WEB_ORIGINS = 'http://localhost:3000';
process.env.USER_POOL_ID = 'us-east-1_test';

const db = new FakeDdb();
const { keys } = await import('../src/lib/db.js');
const { setPresigner, setMediaDeleter } = await import('../src/lib/media.js');
const { handler } = await import('../src/handlers/account.js');
const { handler: publicHandler } = await import('../src/handlers/public.js');

function as(groups: string[]) {
  return (method: any, path: string, body?: unknown, query?: Record<string, string>) => {
    const r = baseReq(method, path, { body, ...(query ? { query } : {}) }) as any;
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
    return r as APIGatewayProxyEventV2;
  };
}
const staff = as(['staff']);
const vendor = as(['vendor']);
const list = async () =>
  AdminGalleryList.parse(
    parse(await handler(staff('GET', '/admin/gallery', undefined, { eventId: EVENT_ID }))).body,
  ).items;
const create = async (body: object) =>
  AdminGalleryItem.parse(
    parse(await handler(staff('POST', '/admin/gallery', { eventId: EVENT_ID, ...body }))).body,
  );
let deleted: string[] = [];

beforeEach(() => {
  db.reset();
  deleted = [];
  setMediaDeleter(async (k) => void deleted.push(...k));
  db.put({ ...keys.eventIndex(event), ...event });
});

describe('admin gallery', () => {
  it('adds photos, stats and quotes at the end, labelled with the event, in order', async () => {
    setPresigner(async (key) => `https://upload.test/${key}`);
    const up = parse(
      await handler(staff('POST', '/admin/gallery/image-upload', { contentType: 'image/jpeg' })),
    ).body;
    expect(up.key).toMatch(/^gallery\/originals\/[0-9a-z]{26}\.jpg$/);
    setPresigner(undefined);

    const photo = await create({
      type: 'photo',
      mediaKey: up.key,
      width: 4000,
      height: 3000,
      caption: 'Costume contest',
      featured: true,
    });
    const id = up.key.slice('gallery/originals/'.length, -4);
    expect(photo).toMatchObject({
      type: 'photo',
      sortOrder: 1,
      featured: true,
      url: `https://media.test/gallery/derived/${id}/display.webp`,
      thumbUrl: `https://media.test/gallery/derived/${id}/thumb.webp`,
      width: 4000,
      eventLabel: 'Halloween Fest 2026',
    });
    await create({ type: 'stat', value: '120+', label: 'vendors' });
    await create({ type: 'quote', text: 'Best show yet!', attribution: 'A parent' });
    expect((await list()).map((i) => [i.type, i.sortOrder])).toEqual([
      ['photo', 1],
      ['stat', 2],
      ['quote', 3],
    ]);
    // Photos must be uploads, not any key in the bucket.
    const bad = parse(
      await handler(
        staff('POST', '/admin/gallery', {
          eventId: EVENT_ID,
          type: 'photo',
          mediaKey: 'vendors/x.png',
        }),
      ),
    );
    expect(bad.status).toBe(400);
  });

  it('edits text and featured, reorders, and deletes a photo with its files', async () => {
    const photo = await create({ type: 'photo', mediaKey: 'gallery/originals/01abc.jpg' });
    const stat = await create({ type: 'stat', value: '120+', label: 'vendors' });
    const quote = await create({ type: 'quote', text: 'Wow', attribution: 'A kid' });

    const edited = parse(
      await handler(
        staff('PUT', `/admin/gallery/${quote.id}`, {
          text: 'Best show yet!',
          attribution: '',
          featured: true,
        }),
      ),
    ).body;
    expect(edited).toMatchObject({ text: 'Best show yet!', featured: true });
    expect(edited.attribution).toBeUndefined();
    // Fields of another type are ignored.
    await handler(staff('PUT', `/admin/gallery/${stat.id}`, { caption: 'nope', value: '150+' }));
    expect((await list()).find((i) => i.id === stat.id)).toMatchObject({ value: '150+' });

    // Move the quote up to the top: keys follow the positions.
    await handler(staff('POST', `/admin/gallery/${quote.id}/move`, { direction: 'up' }));
    const moved = parse(
      await handler(staff('POST', `/admin/gallery/${quote.id}/move`, { direction: 'up' })),
    ).body.items;
    expect(moved.map((i: any) => i.id)).toEqual([quote.id, photo.id, stat.id]);
    expect(db.get('GALLERY', `ITEM#${EVENT_ID}#0001`)?.id).toBe(quote.id);
    expect(db.all().filter((i) => i.PK === 'GALLERY')).toHaveLength(3);
    // Already first: nothing changes.
    await handler(staff('POST', `/admin/gallery/${quote.id}/move`, { direction: 'up' }));
    expect((await list()).map((i) => i.id)).toEqual([quote.id, photo.id, stat.id]);

    expect(parse(await handler(staff('DELETE', `/admin/gallery/${photo.id}`))).status).toBe(200);
    expect(deleted).toEqual([
      'gallery/originals/01abc.jpg',
      'gallery/derived/01abc/display.webp',
      'gallery/derived/01abc/thumb.webp',
    ]);
    expect((await list()).map((i) => i.id)).toEqual([quote.id, stat.id]);
    expect(parse(await handler(staff('DELETE', `/admin/gallery/${photo.id}`))).status).toBe(404);
    expect(
      parse(await handler(vendor('GET', '/admin/gallery', undefined, { eventId: EVENT_ID })))
        .status,
    ).toBe(403);
  });

  it('the public gallery serves the resized copies and featured items reach the home page', async () => {
    await create({
      type: 'photo',
      mediaKey: 'gallery/originals/01xyz.png',
      width: 1200,
      height: 800,
      featured: true,
    });
    const page = parse(await publicHandler(baseReq('GET', '/public/gallery'))).body;
    expect(page.items[0]).toMatchObject({
      url: 'https://media.test/gallery/derived/01xyz/display.webp',
      thumbUrl: 'https://media.test/gallery/derived/01xyz/thumb.webp',
      width: 1200,
      height: 800,
    });
  });
});
