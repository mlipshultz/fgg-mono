import { z } from 'zod';
import { Cents, IsoDate, IsoDateTime, Slug, TimeZone, Ulid } from './common.js';

export const VendorTableStatus = z.enum(['open', 'closed', 'coming_soon']);
export type VendorTableStatus = z.infer<typeof VendorTableStatus>;

export const EventDay = z.object({
  date: IsoDate,
  /** Local times, HH:MM. */
  opens: z.string().regex(/^\d{2}:\d{2}$/),
  closes: z.string().regex(/^\d{2}:\d{2}$/),
  vendorLoadIn: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});
export type EventDay = z.infer<typeof EventDay>;

/** Dated pricing. The server picks the window containing "now" at hold time, else the base rates. */
export const PriceWindow = z.object({
  id: Ulid,
  kind: z.enum(['early_bird', 'standard', 'late']),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  tableRateCents: Cents,
  pokeBucksRateCents: Cents,
});
export type PriceWindow = z.infer<typeof PriceWindow>;

export const TicketType = z.object({
  id: Ulid,
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  priceCents: Cents,
  capacity: z.number().int().positive().optional(),
  salesStart: IsoDateTime.optional(),
  salesEnd: IsoDateTime.optional(),
  /** Per-order cap. */
  maxPerOrder: z.number().int().positive().default(10),
});
export type TicketType = z.infer<typeof TicketType>;

export const Event = z.object({
  id: Ulid,
  slug: Slug,
  /** Groups recurring shows across years, e.g. "halloween-fest". */
  seriesId: z.string().max(60).optional(),
  name: z.string().min(1).max(120),
  blurb: z.string().max(600),
  venueId: Ulid,
  timeZone: TimeZone.default('America/New_York'),
  days: z.array(EventDay).min(1),
  /** Derived from days; kept for sort keys. */
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  posterKey: z.string().optional(),
  published: z.boolean(),
  vendorStatus: VendorTableStatus,
  vendorOpensAt: IsoDateTime.optional(),
  /** Base per-day rates in cents. Price windows and table overrides adjust these. */
  tableRateCents: Cents,
  pokeBucksRateCents: Cents,
  floorPlanVersion: z.number().int().positive().optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Event = z.infer<typeof Event>;

/** What the public site needs for the calendar and 3b cards. */
export const EventSummary = Event.pick({
  id: true,
  slug: true,
  name: true,
  blurb: true,
  days: true,
  startsAt: true,
  endsAt: true,
  posterKey: true,
  vendorStatus: true,
  timeZone: true,
}).extend({
  venueName: z.string(),
  venueCity: z.string(),
  tablesLeft: z.number().int().nonnegative().optional(),
});
export type EventSummary = z.infer<typeof EventSummary>;
