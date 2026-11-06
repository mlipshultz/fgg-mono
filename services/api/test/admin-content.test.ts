/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AdminActivity,
  AdminActivityList,
  AdminPartner,
  AdminPartnerList,
  HomeContent,
} from '@fgg/types';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { FakeDdb } from './fake-ddb.js';
import { parse, req as baseReq } from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';
process.env.WEB_ORIGINS = 'http://localhost:3000';
process.env.USER_POOL_ID = 'us-east-1_test';

const db = new FakeDdb();
const { keys } = await import('../src/lib/db.js');
const { setPresigner, setMediaDeleter } = await import('../src/lib/media.js');
const { handler } = await import('../src/handlers/account.js');
const { handler: publicHandler } = await import('../src/handlers/public.js');
const { slugify } = await import('../src/handlers/admin-content.js');

function as(groups: string[]) {
  return (method: any, path: string, body?: unknown) => {
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
    return r as APIGatewayProxyEventV2;
  };
}
const staff = as(['staff']);
const vendor = as(['vendor']);
const call = async (method: string, path: string, body?: unknown) =>
  parse(await handler(staff(method, path, body)));
const activities = async () =>
  AdminActivityList.parse((await call('GET', '/admin/activities')).body).items;
const partners = async () =>
  AdminPartnerList.parse((await call('GET', '/admin/partners')).body).items;
const configKeys = (prefix: string) =>
  db
    .all()
    .filter((i) => i.PK === 'CONFIG' && String(i.SK).startsWith(prefix))
    .map((i) => i.SK as string)
    .sort();
let deleted: string[] = [];

beforeEach(() => {
  db.reset();
  deleted = [];
  setMediaDeleter(async (k) => void deleted.push(...k));
  setPresigner(async (key) => `https://upload.test/${key}`);
});

describe('admin activities', () => {
  it('is staff only', async () => {
    expect(parse(await handler(vendor('GET', '/admin/activities'))).status).toBe(403);
    expect(
      parse(
        await handler(vendor('POST', '/admin/activities', { name: 'X', description: '', xp: 1 })),
      ).status,
    ).toBe(403);
  });

  it('adds tiles at the end with ids made from the name, unique even when names repeat', async () => {
    const a = AdminActivity.parse(
      (
        await call('POST', '/admin/activities', {
          name: 'Gaming & Tournaments',
          description: 'Play',
          xp: 75,
        })
      ).body,
    );
    expect(a).toMatchObject({ id: 'gaming-tournaments', sortOrder: 1, xp: 75 });
    const b = (
      await call('POST', '/admin/activities', {
        name: 'Gaming & Tournaments!',
        description: '',
        xp: 5,
      })
    ).body;
    expect(b).toMatchObject({ id: 'gaming-tournaments-2', sortOrder: 2 });
    expect(slugify("Find 'Em All")).toBe('find-em-all');
    expect(slugify('PokéPets')).toBe('pokepets');
    expect(slugify('!!!')).toBe('activity');
    expect((await activities()).map((x) => x.id)).toEqual([
      'gaming-tournaments',
      'gaming-tournaments-2',
    ]);
  });

  it('edits text and XP in place, and sets or removes the icon (deleting an uploaded one)', async () => {
    const up = (
      await call('POST', '/admin/content/image-upload', {
        kind: 'activity',
        contentType: 'image/png',
      })
    ).body;
    expect(up.key).toMatch(/^activities\/[0-9a-z]{26}\.png$/);
    expect(up.uploadUrl).toBe(`https://upload.test/${up.key}`);
    await call('POST', '/admin/activities', {
      name: 'Art Station',
      description: 'Draw',
      xp: 25,
      iconKey: up.key,
    });
    expect((await activities())[0]!.iconUrl).toBe(`https://media.test/${up.key}`);

    const edited = (
      await call('PUT', '/admin/activities/art-station', { description: 'Draw and color', xp: 30 })
    ).body;
    expect(edited).toMatchObject({
      id: 'art-station',
      description: 'Draw and color',
      xp: 30,
      iconKey: up.key,
    });
    expect(configKeys('ACTIVITY#')).toHaveLength(1);

    const cleared = (await call('PUT', '/admin/activities/art-station', { iconKey: '' })).body;
    expect(cleared.iconKey).toBeUndefined();
    expect(cleared.iconUrl).toBeUndefined();
    expect(deleted).toEqual([up.key]);

    const bad = await call('PUT', '/admin/activities/art-station', { iconKey: 'vendors/x.png' });
    expect(bad.status).toBe(400);
    expect((await call('PUT', '/admin/activities/nope', { xp: 1 })).status).toBe(404);
  });

  it('moves a tile by swapping places, and does nothing at either end', async () => {
    for (const name of ['One', 'Two', 'Three'])
      await call('POST', '/admin/activities', { name, description: '', xp: 10 });
    const moved = AdminActivityList.parse(
      (await call('POST', '/admin/activities/three/move', { direction: 'up' })).body,
    ).items;
    expect(moved.map((a) => [a.id, a.sortOrder])).toEqual([
      ['one', 1],
      ['three', 2],
      ['two', 3],
    ]);
    // Old keys are gone: one key per activity.
    expect(configKeys('ACTIVITY#')).toEqual([
      'ACTIVITY#0001#one',
      'ACTIVITY#0002#three',
      'ACTIVITY#0003#two',
    ]);
    await call('POST', '/admin/activities/one/move', { direction: 'up' });
    expect((await activities()).map((a) => a.id)).toEqual(['one', 'three', 'two']);
  });

  it('deletes a tile with its uploaded icon', async () => {
    const key = 'activities/01m6qg8x30b2kpjw1xdphey2bx.webp';
    await call('POST', '/admin/activities', {
      name: 'Trading',
      description: '',
      xp: 25,
      iconKey: key,
    });
    expect((await call('DELETE', '/admin/activities/trading')).status).toBe(200);
    expect(await activities()).toEqual([]);
    expect(deleted).toEqual([key]);
  });
});

describe('admin partners', () => {
  it('adds, links, edits and replaces logos; only uploaded logos are deleted', async () => {
    const seeded = 'partners/fgg-logo.png';
    const p = AdminPartner.parse(
      (
        await call('POST', '/admin/partners', {
          name: 'Card Corner',
          logoKey: seeded,
          url: 'https://cardcorner.example',
        })
      ).body,
    );
    expect(p).toMatchObject({
      name: 'Card Corner',
      sortOrder: 1,
      logoUrl: `https://media.test/${seeded}`,
    });
    expect((await call('POST', '/admin/partners', { name: 'No logo' })).status).toBe(400);
    expect(
      (await call('POST', '/admin/partners', { name: 'Bad', logoKey: 'gallery/x.png' })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/admin/partners', { name: 'Bad', logoKey: seeded, url: 'not a url' }))
        .status,
    ).toBe(400);

    // Swapping out the shared seeded logo leaves the file for the other partners.
    const fresh = 'partners/01m6qg8x30b2kpjw1xdphey2bx.png';
    const next = (await call('PUT', `/admin/partners/${p.id}`, { logoKey: fresh, url: '' })).body;
    expect(next).toMatchObject({ logoKey: fresh, logoUrl: `https://media.test/${fresh}` });
    expect(next.url).toBeUndefined();
    expect(deleted).toEqual([]);
    // Deleting the partner takes its uploaded logo.
    await call('DELETE', `/admin/partners/${p.id}`);
    expect(await partners()).toEqual([]);
    expect(deleted).toEqual([fresh]);
  });

  it('moves partners and never deletes a shared seeded logo', async () => {
    const seeded = 'partners/fgg-logo.png';
    const ids: string[] = [];
    for (const name of ['A', 'B'])
      ids.push((await call('POST', '/admin/partners', { name, logoKey: seeded })).body.id);
    await call('POST', `/admin/partners/${ids[1]}/move`, { direction: 'up' });
    expect((await partners()).map((p) => p.name)).toEqual(['B', 'A']);
    expect(configKeys('PARTNER#')).toHaveLength(2);
    await call('DELETE', `/admin/partners/${ids[0]}`);
    expect(deleted).toEqual([]);
  });
});

describe('home page payload', () => {
  it('serves activity icons as URLs and keeps the order', async () => {
    db.put({
      ...keys.activity('art', 2),
      id: 'art',
      name: 'Art',
      description: '',
      xp: 25,
      iconKey: 'activities/icon.png',
      sortOrder: 2,
    });
    db.put({
      ...keys.activity('find', 1),
      id: 'find',
      name: 'Find',
      description: '',
      xp: 50,
      sortOrder: 1,
    });
    db.put({ ...keys.settings(), contactEmail: 'hi@fgg.test', social: {} });
    const r = parse(await publicHandler(baseReq('GET', '/public/home')));
    expect(r.status).toBe(200);
    const home = HomeContent.parse(r.body);
    expect(home.activities.map((a) => a.id)).toEqual(['find', 'art']);
    expect(home.activities[1]).toMatchObject({ iconUrl: 'https://media.test/activities/icon.png' });
    expect(home.activities[1]).not.toHaveProperty('iconKey');
  });
});
