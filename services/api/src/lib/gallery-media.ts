import type { PublicGalleryItem } from '@fgg/types';
import type { StoredGalleryItem } from './db.js';
import { mediaUrl } from './media.js';

/**
 * Gallery photos are uploaded to `gallery/originals/{id}.{ext}`; the resize Lambda writes
 * `gallery/derived/{id}/display.webp` (1600 wide) and `thumb.webp` (480 wide). Keys outside
 * that prefix (the seeded posters) have no variants and are served as they are.
 */
export const ORIGINALS = 'gallery/originals/';
export const DERIVED = 'gallery/derived/';

export const VARIANTS = [
  { name: 'display', width: 1600 },
  { name: 'thumb', width: 480 },
] as const;

/** `gallery/originals/01abc.jpg` → `01abc`; undefined for keys without variants. */
export function originalId(key: string): string | undefined {
  if (!key.startsWith(ORIGINALS)) return undefined;
  return key.slice(ORIGINALS.length).replace(/\.[a-z0-9]+$/i, '') || undefined;
}

export const variantKey = (id: string, name: (typeof VARIANTS)[number]['name']) =>
  `${DERIVED}${id}/${name}.webp`;

/** Display and thumbnail URLs for a gallery photo's stored key. */
export function galleryPhotoUrls(key: string): { url: string; thumbUrl: string } {
  const id = originalId(key);
  if (!id) return { url: mediaUrl(key), thumbUrl: mediaUrl(key) };
  return { url: mediaUrl(variantKey(id, 'display')), thumbUrl: mediaUrl(variantKey(id, 'thumb')) };
}

/** A stored gallery item as the public site shows it, with media keys resolved to URLs. */
export function toPublicGalleryItem(it: StoredGalleryItem): PublicGalleryItem {
  const base = {
    id: it.id,
    eventId: it.eventId,
    eventName: it.eventName,
    eventLabel: it.eventLabel,
  };
  switch (it.type) {
    case 'photo':
      return {
        ...base,
        type: 'photo',
        ...galleryPhotoUrls(it.mediaKey),
        ...(it.width && it.height ? { width: it.width, height: it.height } : {}),
        ...(it.caption ? { caption: it.caption } : {}),
        featured: it.featured ?? false,
      };
    case 'video':
      return {
        ...base,
        type: 'video',
        url: mediaUrl(it.mediaKey),
        posterUrl: mediaUrl(it.posterKey),
        durationSeconds: it.durationSeconds,
        ...(it.caption ? { caption: it.caption } : {}),
        featured: it.featured ?? false,
      };
    case 'stat':
      return { ...base, type: 'stat', value: it.value, label: it.label };
    case 'quote':
      return {
        ...base,
        type: 'quote',
        text: it.text,
        ...(it.attribution ? { attribution: it.attribution } : {}),
      };
  }
}
