import { z } from 'zod';
import { Activity, Partner } from './content.js';
import { EventDay, VendorTableStatus } from './event.js';
import { IsoDate, IsoDateTime, Slug, TimeZone, Ulid } from './common.js';

/** Every error response from the API has this shape. */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().optional() });

export const Ok = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof Ok>;

// ---------------------------------------------------------------------------
// Public (unauthenticated) read API, consumed at build time by apps/web and
// at runtime by the client for live values.
// ---------------------------------------------------------------------------

/** An event as the public site sees it. Venue is denormalized; media keys are resolved to URLs. */
export const PublicEvent = z.object({
  id: Ulid,
  slug: Slug,
  name: z.string(),
  blurb: z.string(),
  timeZone: TimeZone,
  days: z.array(EventDay).min(1),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  /** First and last calendar dates, for calendar and card tiles. */
  startDate: IsoDate,
  endDate: IsoDate,
  /** Human hours line, e.g. "11am–5pm" or "Fri 10–5 · Sat 10–8 · Sun 10–5". */
  hoursLabel: z.string(),
  venue: z.object({ id: Ulid, name: z.string(), city: z.string(), state: z.string() }),
  posterUrl: z.string().url().optional(),
  vendorStatus: VendorTableStatus,
  vendorOpensAt: IsoDateTime.optional(),
  /** Live count; undefined when vendor tables are not open. */
  tablesLeft: z.number().int().nonnegative().optional(),
  tableRateCents: z.number().int().nonnegative(),
  pokeBucksRateCents: z.number().int().nonnegative(),
});
export type PublicEvent = z.infer<typeof PublicEvent>;

export const PublicPartner = Partner.omit({ logoKey: true }).extend({ logoUrl: z.string().url() });
export type PublicPartner = z.infer<typeof PublicPartner>;

/** Gallery item with media keys resolved to CloudFront URLs. */
export const PublicGalleryItem = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('photo'),
    id: Ulid,
    eventId: Ulid,
    eventName: z.string(),
    eventLabel: z.string(),
    url: z.string().url(),
    thumbUrl: z.string().url(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    caption: z.string().optional(),
    featured: z.boolean(),
    takenOn: IsoDate.optional(),
  }),
  z.object({
    type: z.literal('video'),
    id: Ulid,
    eventId: Ulid,
    eventName: z.string(),
    eventLabel: z.string(),
    url: z.string().url(),
    posterUrl: z.string().url(),
    durationSeconds: z.number().int().positive(),
    caption: z.string().optional(),
    featured: z.boolean(),
  }),
  z.object({
    type: z.literal('stat'),
    id: Ulid,
    eventId: Ulid,
    eventName: z.string(),
    eventLabel: z.string(),
    value: z.string(),
    label: z.string(),
  }),
  z.object({
    type: z.literal('quote'),
    id: Ulid,
    eventId: Ulid,
    eventName: z.string(),
    eventLabel: z.string(),
    text: z.string(),
    attribution: z.string().optional(),
  }),
]);
export type PublicGalleryItem = z.infer<typeof PublicGalleryItem>;

/** Public, non-secret settings the site renders. */
export const PublicSettings = z.object({
  contactEmail: z.string().email(),
  discordInviteUrl: z.string().url().optional(),
  social: z.object({
    discord: z.string().url().optional(),
    instagram: z.string().url().optional(),
    tiktok: z.string().url().optional(),
    youtube: z.string().url().optional(),
    facebook: z.string().url().optional(),
  }),
  heroVideoUrl: z.string().url().optional(),
  heroPosterUrl: z.string().url().optional(),
});
export type PublicSettings = z.infer<typeof PublicSettings>;

/** GET /public/home — everything the homepage needs in one call (build time). */
export const HomeContent = z.object({
  events: z.array(PublicEvent),
  pastEvents: z.array(
    PublicEvent.pick({
      id: true,
      slug: true,
      name: true,
      startDate: true,
      endDate: true,
      venue: true,
      posterUrl: true,
    }),
  ),
  activities: z.array(Activity),
  partners: z.array(PublicPartner),
  galleryTeaser: z.array(PublicGalleryItem),
  settings: PublicSettings,
});
export type HomeContent = z.infer<typeof HomeContent>;

/** GET /public/events — upcoming published events. */
export const PublicEventList = z.object({ events: z.array(PublicEvent) });
export type PublicEventList = z.infer<typeof PublicEventList>;

/** GET /public/events/{id}/availability — live counts for the "N left" pill. */
export const EventAvailability = z.object({
  eventId: Ulid,
  vendorStatus: VendorTableStatus,
  tablesLeft: z.number().int().nonnegative(),
  /** Per day: table IDs that are taken or currently held. */
  days: z.array(z.object({ date: IsoDate, unavailable: z.array(z.string()) })),
});
export type EventAvailability = z.infer<typeof EventAvailability>;

/** GET /public/gallery?eventId=&videosOnly=&cursor= */
export const GalleryPage = Paginated(PublicGalleryItem).extend({
  events: z.array(z.object({ id: Ulid, label: z.string() })),
});
export type GalleryPage = z.infer<typeof GalleryPage>;

/** POST /public/subscribe, /public/contact, /public/events/{id}/waitlist all return Ok. */
