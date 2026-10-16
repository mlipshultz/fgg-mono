import { ulid } from 'ulid';
import {
  GalleryImageUploadInput,
  GalleryItemInput,
  GalleryItemUpdate,
  GalleryMoveInput,
  type AdminGalleryItem,
  type AdminGalleryList,
  type GalleryImageUploadResponse,
} from '@fgg/types';
import { claimsFrom } from '../lib/auth.js';
import {
  deleteItem,
  findGalleryItem,
  getEvent,
  keys,
  listEventGallery,
  putItem,
  stripKeys,
  type StoredGalleryItem,
} from '../lib/db.js';
import { VARIANTS, originalId, toPublicGalleryItem, variantKey } from '../lib/gallery-media.js';
import { HttpError, json, parseBody, type Router } from '../lib/http.js';
import { deleteMedia, mediaUrl, presignUpload } from '../lib/media.js';
import { require as requireCan } from '../lib/permissions.js';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function adminItem(it: StoredGalleryItem): AdminGalleryItem {
  return {
    ...toPublicGalleryItem(it),
    sortOrder: it.sortOrder,
    featured: 'featured' in it ? (it.featured ?? false) : false,
    ...(it.type === 'photo' ? { originalUrl: mediaUrl(it.mediaKey) } : {}),
  };
}

/** Write an item at the key for its event and position (the key changes when it moves). */
async function save(it: StoredGalleryItem): Promise<void> {
  const clean = stripKeys<StoredGalleryItem>(it as unknown as Record<string, unknown>);
  await putItem({ ...keys.galleryItem(clean.eventId, clean.sortOrder), ...clean });
}

async function itemOr404(id: string): Promise<StoredGalleryItem> {
  const it = await findGalleryItem(id);
  if (!it) throw new HttpError(404, 'gallery_item_not_found', 'Gallery item not found');
  return stripKeys<StoredGalleryItem>(it as unknown as Record<string, unknown>);
}

/** Gallery: photos (resized by the media stack's Lambda), stats and quotes per past event. */
export function addGalleryAdminRoutes(router: Router): void {
  router
    .add('GET', '/admin/gallery', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      const eventId = req.queryStringParameters?.eventId;
      if (!eventId) throw new HttpError(400, 'event_required', 'Pick an event');
      const body: AdminGalleryList = { items: (await listEventGallery(eventId)).map(adminItem) };
      return json(req, body, 200, { 'cache-control': 'no-store' });
    })
    .add('POST', '/admin/gallery/image-upload', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      const input = parseBody(req, GalleryImageUploadInput);
      const key = `gallery/originals/${ulid().toLowerCase()}.${EXT[input.contentType]}`;
      const body: GalleryImageUploadResponse = {
        uploadUrl: await presignUpload(key, input.contentType),
        key,
        url: mediaUrl(key),
      };
      return json(req, body, 201, { 'cache-control': 'no-store' });
    })
    .add('POST', '/admin/gallery', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      const input = parseBody(req, GalleryItemInput);
      const ev = await getEvent(input.eventId);
      if (!ev) throw new HttpError(404, 'event_not_found', 'Event not found');
      const existing = await listEventGallery(ev.id);
      const first = [...ev.days].map((d) => d.date).sort()[0] ?? ev.startsAt;
      const base = {
        id: ulid(),
        eventId: ev.id,
        eventName: ev.name,
        eventLabel: `${ev.name} ${first.slice(0, 4)}`,
        sortOrder: Math.max(0, ...existing.map((i) => i.sortOrder)) + 1,
        featured: input.featured,
      };
      const it: StoredGalleryItem =
        input.type === 'photo'
          ? {
              ...base,
              type: 'photo',
              mediaKey: input.mediaKey,
              ...(input.width && input.height ? { width: input.width, height: input.height } : {}),
              ...(input.caption ? { caption: input.caption } : {}),
            }
          : input.type === 'stat'
            ? { ...base, type: 'stat', value: input.value, label: input.label }
            : {
                ...base,
                type: 'quote',
                text: input.text,
                ...(input.attribution ? { attribution: input.attribution } : {}),
              };
      await save(it);
      return json(req, adminItem(it), 201);
    })
    .add('PUT', '/admin/gallery/{id}', async (req, { id }) => {
      requireCan(claimsFrom(req), 'manage_events');
      const it = await itemOr404(id!);
      const u = parseBody(req, GalleryItemUpdate);
      // Only the fields that belong to the item's type; an empty caption or attribution clears it.
      const next = { ...it, ...(u.featured !== undefined ? { featured: u.featured } : {}) };
      const set = (k: string, v: string | undefined) => {
        if (v === undefined) return;
        if (v) (next as Record<string, unknown>)[k] = v;
        else delete (next as Record<string, unknown>)[k];
      };
      if (it.type === 'photo' || it.type === 'video') set('caption', u.caption);
      if (it.type === 'stat') {
        set('value', u.value);
        set('label', u.label);
      }
      if (it.type === 'quote') {
        set('text', u.text);
        set('attribution', u.attribution);
      }
      await save(next as StoredGalleryItem);
      return json(req, adminItem(next as StoredGalleryItem));
    })
    .add('POST', '/admin/gallery/{id}/move', async (req, { id }) => {
      requireCan(claimsFrom(req), 'manage_events');
      const it = await itemOr404(id!);
      const { direction } = parseBody(req, GalleryMoveInput);
      const items = await listEventGallery(it.eventId);
      const i = items.findIndex((x) => x.id === it.id);
      const j = direction === 'up' ? i - 1 : i + 1;
      const other = items[j];
      if (other) {
        // Swapping positions swaps keys: each item is written over the other's slot.
        const a = {
          ...stripKeys<StoredGalleryItem>(items[i] as never),
          sortOrder: other.sortOrder,
        };
        const b = {
          ...stripKeys<StoredGalleryItem>(other as never),
          sortOrder: items[i]!.sortOrder,
        };
        await save(a);
        await save(b);
      }
      const body: AdminGalleryList = { items: (await listEventGallery(it.eventId)).map(adminItem) };
      return json(req, body);
    })
    .add('DELETE', '/admin/gallery/{id}', async (req, { id }) => {
      requireCan(claimsFrom(req), 'manage_events');
      const it = await itemOr404(id!);
      await deleteItem(keys.galleryItem(it.eventId, it.sortOrder));
      // An uploaded photo takes its original and resized copies with it.
      if (it.type === 'photo') {
        const oid = originalId(it.mediaKey);
        if (oid) await deleteMedia([it.mediaKey, ...VARIANTS.map((v) => variantKey(oid, v.name))]);
      }
      return json(req, { ok: true });
    });
}
