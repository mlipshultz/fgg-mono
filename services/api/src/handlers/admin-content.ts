import { ulid } from 'ulid';
import {
  ActivityInput,
  ActivityUpdate,
  ContentImageUploadInput,
  ContentMoveInput,
  PartnerInput,
  PartnerUpdate,
  type Activity,
  type AdminActivity,
  type AdminActivityList,
  type AdminPartner,
  type AdminPartnerList,
  type ContentImageUploadResponse,
  type Partner,
} from '@fgg/types';
import { claimsFrom } from '../lib/auth.js';
import {
  TABLE,
  TransactWriteCommand,
  ddb,
  deleteItem,
  findActivity,
  findPartner,
  keys,
  listActivities,
  listPartners,
  putItem,
  stripKeys,
} from '../lib/db.js';
import { HttpError, json, parseBody, type Req, type Router } from '../lib/http.js';
import { deleteMedia, mediaUrl, presignUpload } from '../lib/media.js';
import { require as requireCan } from '../lib/permissions.js';

/**
 * The home page's activity tiles and partner logos (CONFIG ACTIVITY# / PARTNER#). Both keys carry
 * the sort order, so an edit writes back at the item's own key and a move swaps two keys, as the
 * gallery does. Public pages change after a site rebuild.
 */

const EXT: Record<ContentImageUploadInput['contentType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const PREFIX = { partner: 'partners/', activity: 'activities/' } as const;

/**
 * Images uploaded from this page are named `{prefix}{ulid}.{ext}`. Only those are deleted with
 * their item: seeded partners share `partners/fgg-logo.png`, which must outlive any one of them.
 */
const UPLOADED = /^(partners|activities)\/[0-9a-z]{26}\.(png|jpg|webp)$/;
async function deleteUploaded(key: string | undefined): Promise<void> {
  if (key && UPLOADED.test(key)) await deleteMedia([key]);
}

const byOrder = <T extends { sortOrder: number }>(items: T[]) =>
  [...items].sort((a, b) => a.sortOrder - b.sortOrder);

function adminActivity(a: Activity): AdminActivity {
  const clean = stripKeys<Activity>(a as unknown as Record<string, unknown>);
  return { ...clean, ...(clean.iconKey ? { iconUrl: mediaUrl(clean.iconKey) } : {}) };
}
function adminPartner(p: Partner): AdminPartner {
  const clean = stripKeys<Partner>(p as unknown as Record<string, unknown>);
  return { ...clean, logoUrl: mediaUrl(clean.logoKey) };
}
const activityList = async (): Promise<AdminActivityList> => ({
  items: byOrder(await listActivities()).map(adminActivity),
});
const partnerList = async (): Promise<AdminPartnerList> => ({
  items: byOrder(await listPartners()).map(adminPartner),
});

const saveActivity = (a: Activity) =>
  putItem({ ...keys.activity(a.id, a.sortOrder), ...stripKeys<Activity>(a as never) });
const savePartner = (p: Partner) =>
  putItem({ ...keys.partner(p.id, p.sortOrder), ...stripKeys<Partner>(p as never) });

/** "Gaming & Tournaments" → "gaming-tournaments" (the id the public payload carries). */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return s || 'activity';
}

async function activityOr404(id: string): Promise<Activity> {
  const a = await findActivity(id);
  if (!a) throw new HttpError(404, 'activity_not_found', 'Activity not found');
  return stripKeys<Activity>(a as unknown as Record<string, unknown>);
}
async function partnerOr404(id: string): Promise<Partner> {
  const p = await findPartner(id);
  if (!p) throw new HttpError(404, 'partner_not_found', 'Partner not found');
  return stripKeys<Partner>(p as unknown as Record<string, unknown>);
}

/**
 * Swap an item with its neighbour (nothing happens at either end). Keys hold the position and the
 * id, so both old keys go and two new ones are written, in one transaction.
 */
async function swap<T extends { id: string; sortOrder: number }>(
  items: T[],
  id: string,
  direction: 'up' | 'down',
  keyOf: (id: string, sortOrder: number) => { PK: string; SK: string },
): Promise<void> {
  const sorted = byOrder(items).map((x) => stripKeys<T>(x as unknown as Record<string, unknown>));
  const i = sorted.findIndex((x) => x.id === id);
  const me = sorted[i];
  const other = sorted[direction === 'up' ? i - 1 : i + 1];
  if (!me || !other) return;
  const moved = [
    { ...me, sortOrder: other.sortOrder },
    { ...other, sortOrder: me.sortOrder },
  ];
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: TABLE, Key: keyOf(me.id, me.sortOrder) } },
        { Delete: { TableName: TABLE, Key: keyOf(other.id, other.sortOrder) } },
        ...moved.map((x) => ({
          Put: { TableName: TABLE, Item: { ...keyOf(x.id, x.sortOrder), ...x } },
        })),
      ],
    }),
  );
}

const staff = (req: Req) => requireCan(claimsFrom(req), 'manage_events');

export function addContentAdminRoutes(router: Router): void {
  router
    .add('POST', '/admin/content/image-upload', async (req) => {
      staff(req);
      const input = parseBody(req, ContentImageUploadInput);
      const key = `${PREFIX[input.kind]}${ulid().toLowerCase()}.${EXT[input.contentType]}`;
      const body: ContentImageUploadResponse = {
        uploadUrl: await presignUpload(key, input.contentType),
        key,
        url: mediaUrl(key),
      };
      return json(req, body, 201, { 'cache-control': 'no-store' });
    })

    // Activities
    .add('GET', '/admin/activities', async (req) => {
      staff(req);
      return json(req, await activityList(), 200, { 'cache-control': 'no-store' });
    })
    .add('POST', '/admin/activities', async (req) => {
      staff(req);
      const input = parseBody(req, ActivityInput);
      const existing = await listActivities();
      const taken = new Set(existing.map((a) => a.id));
      const base = slugify(input.name);
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      const a: Activity = {
        id,
        name: input.name,
        description: input.description,
        xp: input.xp,
        ...(input.iconKey ? { iconKey: input.iconKey } : {}),
        sortOrder: Math.max(0, ...existing.map((x) => x.sortOrder)) + 1,
      };
      await saveActivity(a);
      return json(req, adminActivity(a), 201);
    })
    .add('PUT', '/admin/activities/{id}', async (req, { id }) => {
      staff(req);
      const a = await activityOr404(id!);
      const u = parseBody(req, ActivityUpdate);
      const next: Activity = {
        ...a,
        ...(u.name !== undefined ? { name: u.name } : {}),
        ...(u.description !== undefined ? { description: u.description } : {}),
        ...(u.xp !== undefined ? { xp: u.xp } : {}),
      };
      if (u.iconKey !== undefined) {
        if (u.iconKey) next.iconKey = u.iconKey;
        else delete next.iconKey;
      }
      await saveActivity(next);
      if (u.iconKey !== undefined && a.iconKey !== next.iconKey) await deleteUploaded(a.iconKey);
      return json(req, adminActivity(next));
    })
    .add('POST', '/admin/activities/{id}/move', async (req, { id }) => {
      staff(req);
      await activityOr404(id!);
      const { direction } = parseBody(req, ContentMoveInput);
      await swap(await listActivities(), id!, direction, keys.activity);
      return json(req, await activityList());
    })
    .add('DELETE', '/admin/activities/{id}', async (req, { id }) => {
      staff(req);
      const a = await activityOr404(id!);
      await deleteItem(keys.activity(a.id, a.sortOrder));
      await deleteUploaded(a.iconKey);
      return json(req, { ok: true });
    })

    // Partners
    .add('GET', '/admin/partners', async (req) => {
      staff(req);
      return json(req, await partnerList(), 200, { 'cache-control': 'no-store' });
    })
    .add('POST', '/admin/partners', async (req) => {
      staff(req);
      const input = parseBody(req, PartnerInput);
      const existing = await listPartners();
      const p: Partner = {
        id: ulid(),
        name: input.name,
        logoKey: input.logoKey,
        ...(input.url ? { url: input.url } : {}),
        sortOrder: Math.max(0, ...existing.map((x) => x.sortOrder)) + 1,
      };
      await savePartner(p);
      return json(req, adminPartner(p), 201);
    })
    .add('PUT', '/admin/partners/{id}', async (req, { id }) => {
      staff(req);
      const p = await partnerOr404(id!);
      const u = parseBody(req, PartnerUpdate);
      const next: Partner = {
        ...p,
        ...(u.name !== undefined ? { name: u.name } : {}),
        ...(u.logoKey !== undefined ? { logoKey: u.logoKey } : {}),
      };
      if (u.url !== undefined) {
        if (u.url) next.url = u.url;
        else delete next.url;
      }
      await savePartner(next);
      if (u.logoKey !== undefined && p.logoKey !== next.logoKey) await deleteUploaded(p.logoKey);
      return json(req, adminPartner(next));
    })
    .add('POST', '/admin/partners/{id}/move', async (req, { id }) => {
      staff(req);
      await partnerOr404(id!);
      const { direction } = parseBody(req, ContentMoveInput);
      await swap(await listPartners(), id!, direction, keys.partner);
      return json(req, await partnerList());
    })
    .add('DELETE', '/admin/partners/{id}', async (req, { id }) => {
      staff(req);
      const p = await partnerOr404(id!);
      await deleteItem(keys.partner(p.id, p.sortOrder));
      await deleteUploaded(p.logoKey);
      return json(req, { ok: true });
    });
}
