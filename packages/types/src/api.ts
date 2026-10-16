import { z } from 'zod';
import { Activity, Partner } from './content.js';
import { Event, EventDay, PriceWindow, TableBooking, VendorTableStatus } from './event.js';
import { CognitoSub, Email, IsoDate, IsoDateTime, Slug, TimeZone, Ulid } from './common.js';
import { Me, Role } from './user.js';
import {
  SocialHandles,
  Vendor,
  VendorApplication,
  VendorApprovalMode,
  SellsCategory,
} from './vendor.js';
import { FloorPlan, Venue } from './venue.js';
import { Settings } from './settings.js';
import {
  Order,
  PricingInputs,
  TableHold,
  TableRate,
  VendorInfo,
  VendorInfoInput,
} from './order.js';

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
  /** Landscape image for the home card, when the event has one. */
  cardUrl: z.string().url().optional(),
  vendorStatus: VendorTableStatus,
  vendorOpensAt: IsoDateTime.optional(),
  /** Absent means `floor_plan`. */
  tableBooking: TableBooking.optional(),
  /** Live count; undefined when vendor tables are not open. */
  tablesLeft: z.number().int().nonnegative().optional(),
  tableRateCents: z.number().int().nonnegative(),
  pokeBucksRateCents: z.number().int().nonnegative(),
  /** Cheapest standard per-day table price right now: current price window, lowest table override. */
  tablesFromCents: z.number().int().nonnegative().optional(),
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
  /** Per day: table IDs that are taken or currently held; on `quantity` events, tables left. */
  days: z.array(
    z.object({
      date: IsoDate,
      unavailable: z.array(z.string()),
      left: z.number().int().nonnegative().optional(),
    }),
  ),
});
export type EventAvailability = z.infer<typeof EventAvailability>;

/** GET /public/gallery?eventId=&videosOnly=&cursor= */
export const GalleryPage = Paginated(PublicGalleryItem).extend({
  events: z.array(z.object({ id: Ulid, label: z.string() })),
});
export type GalleryPage = z.infer<typeof GalleryPage>;

/** POST /public/subscribe, /public/contact, /public/events/{id}/waitlist all return Ok. */

// ---------------------------------------------------------------------------
// Authenticated (Cognito JWT) account API.
// ---------------------------------------------------------------------------

export const UpdateMeInput = z.object({
  displayName: z.string().min(1).max(60),
});
export type UpdateMeInput = z.infer<typeof UpdateMeInput>;

/** Derived from the XP total and the Level config (packages/game). */
export const LevelProgress = z.object({
  level: z.number().int().positive(),
  title: z.string(),
  xp: z.number().int().nonnegative(),
  /** XP earned inside the current level and the size of the level. */
  xpIntoLevel: z.number().int().nonnegative(),
  xpForLevel: z.number().int().positive(),
  xpToNext: z.number().int().nonnegative(),
  /** 0..1 */
  pct: z.number().min(0).max(1),
  nextLevel: z.number().int().positive().optional(),
  nextTitle: z.string().optional(),
  nextUnlocks: z.string().optional(),
});
export type LevelProgress = z.infer<typeof LevelProgress>;

export const BadgeStatus = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  artUrl: z.string().url().optional(),
  earned: z.boolean(),
  awardedAt: IsoDateTime.optional(),
});
export type BadgeStatus = z.infer<typeof BadgeStatus>;

/** GET /me/dashboard — everything the attendee dashboard (mock 2c) needs. */
export const Dashboard = z.object({
  me: Me,
  progress: LevelProgress,
  stats: z.object({
    fests: z.number().int().nonnegative(),
    badgesEarned: z.number().int().nonnegative(),
    badgesTotal: z.number().int().nonnegative(),
    memberSince: IsoDateTime,
  }),
  badges: z.array(BadgeStatus),
  savedEvents: z.array(PublicEvent),
});
export type Dashboard = z.infer<typeof Dashboard>;

/** GET /me/saved — ids only, for heart state on event cards. */
export const SavedEventIds = z.object({ eventIds: z.array(Ulid) });
export type SavedEventIds = z.infer<typeof SavedEventIds>;

// ---------------------------------------------------------------------------
// Admin (staff / superadmin).
// ---------------------------------------------------------------------------

export const AdminUserRow = z.object({
  sub: CognitoSub,
  email: Email,
  displayName: z.string(),
  roles: z.array(Role),
  vendorId: z.string().optional(),
  memberSince: IsoDateTime,
});
export type AdminUserRow = z.infer<typeof AdminUserRow>;

/** GET /admin/users?cursor=&q= (q = exact email) */
export const AdminUserList = Paginated(AdminUserRow);
export type AdminUserList = z.infer<typeof AdminUserList>;

/** PUT /admin/users/{sub}/roles — superadmin only. */
export const SetRolesInput = z.object({ roles: z.array(Role).min(1) });
export type SetRolesInput = z.infer<typeof SetRolesInput>;

/** GET /admin/settings — what the settings screen edits. Superadmin only. */
export const AdminSettings = Settings.pick({
  processingFeePct: true,
  taxPct: true,
  holdMinutes: true,
  checkoutHoldMinutes: true,
  refundCutoffDays: true,
  calendlyUrl: true,
});
export type AdminSettings = z.infer<typeof AdminSettings>;

/** PUT /admin/settings — every field is sent; a null Calendly link clears it. */
export const UpdateSettingsInput = z.object({
  processingFeePct: z.number().min(0).max(100),
  taxPct: z.number().min(0).max(100),
  holdMinutes: z.number().int().min(1).max(120),
  checkoutHoldMinutes: z.number().int().min(1).max(120),
  refundCutoffDays: z.number().int().min(0).max(365),
  calendlyUrl: z.string().url().max(500).nullable(),
});
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInput>;

// ---------------------------------------------------------------------------
// Admin events and venues (staff / superadmin).
// ---------------------------------------------------------------------------

/**
 * POST /admin/events, PUT /admin/events/{id} — the whole event as the editor holds it.
 * `startsAt` / `endsAt` are derived from the days on the server.
 */
export const EventInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: Slug,
  seriesId: z.string().trim().max(60).optional(),
  blurb: z.string().trim().max(600),
  venueId: Ulid,
  days: z.array(EventDay).min(1).max(7),
  vendorStatus: VendorTableStatus,
  vendorOpensAt: IsoDateTime.optional(),
  tableRateCents: z.number().int().nonnegative(),
  pokeBucksRateCents: z.number().int().nonnegative(),
  tableBooking: TableBooking,
  /** Required when `tableBooking` is `quantity`: tables for sale per day. */
  tableCapacity: z.number().int().positive().max(1000).optional(),
  posterKey: z.string().max(300).optional(),
  cardKey: z.string().max(300).optional(),
  published: z.boolean(),
  /**
   * Dated rates (early bird, late). The whole list is replaced on save; omit it to leave the
   * windows as they are. A window without an id is new.
   */
  priceWindows: z
    .array(PriceWindow.partial({ id: true }))
    .max(10)
    .optional(),
});
export type EventInput = z.infer<typeof EventInput>;

/** An event as the admin editor sees it: every stored field, with image URLs resolved. */
export const AdminEvent = Event.extend({
  posterUrl: z.string().url().optional(),
  cardUrl: z.string().url().optional(),
  priceWindows: z.array(PriceWindow),
});
export type AdminEvent = z.infer<typeof AdminEvent>;

/** POST /admin/venues, PUT /admin/venues/{id} */
export const VenueInput = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(50),
  timeZone: TimeZone,
});
export type VenueInput = z.infer<typeof VenueInput>;

/** A table that costs something other than the event rate: a fixed price or a surcharge. */
export const PremiumTable = z.union([
  z.object({ tableId: z.string(), priceOverrideCents: z.number().int().nonnegative() }),
  z.object({ tableId: z.string(), premiumDeltaCents: z.number().int().positive() }),
]);
export type PremiumTable = z.infer<typeof PremiumTable>;

/** PUT /admin/venues/{id}/premium-tables — the full list; tables left out go back to normal. */
export const PremiumTablesInput = z.object({ tables: z.array(PremiumTable).max(500) });
export type PremiumTablesInput = z.infer<typeof PremiumTablesInput>;

/** A venue in the admin list; `hasFloorPlan` says whether events there can use the map picker. */
export const AdminVenue = Venue.extend({
  hasFloorPlan: z.boolean(),
  /** Every table on the floor plan, in plan order (empty without one). */
  tableIds: z.array(z.string()).default([]),
  premiumTables: z.array(PremiumTable).default([]),
});
export type AdminVenue = z.infer<typeof AdminVenue>;

/** GET /admin/events — every event, drafts included, newest first, plus the venues to pick from. */
export const AdminEventList = z.object({
  events: z.array(AdminEvent),
  venues: z.array(AdminVenue),
});
export type AdminEventList = z.infer<typeof AdminEventList>;

export const EventImageKind = z.enum(['poster', 'card']);
export type EventImageKind = z.infer<typeof EventImageKind>;

/** POST /admin/events/{id}/image-upload → PUT the file, then save the key on the event. */
export const EventImageUploadInput = z.object({
  kind: EventImageKind,
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
});
export type EventImageUploadInput = z.infer<typeof EventImageUploadInput>;
export const EventImageUploadResponse = z.object({
  /** Presigned S3 PUT; send the file with the same content-type. */
  uploadUrl: z.string().url(),
  key: z.string(),
  url: z.string().url(),
});
export type EventImageUploadResponse = z.infer<typeof EventImageUploadResponse>;

// ---------------------------------------------------------------------------
// Vendor application (attendee → vendor_applicant → vendor).
// ---------------------------------------------------------------------------

/** GET /me/vendor-application — the caller's standing as a vendor. */
export const VendorStanding = z.object({
  application: VendorApplication.nullable(),
  vendor: Vendor.nullable(),
  /** Calendly scheduling link shown on the pending screen (Settings). */
  calendlyUrl: z.string().url().optional(),
  approvalMode: VendorApprovalMode,
});
export type VendorStanding = z.infer<typeof VendorStanding>;

export const ReviewInput = z.object({ notes: z.string().max(2000).optional() });
export type ReviewInput = z.infer<typeof ReviewInput>;

/** GET /admin/vendor-applications?status=&cursor= */
export const VendorApplicationList = Paginated(VendorApplication);
export type VendorApplicationList = z.infer<typeof VendorApplicationList>;

// ---------------------------------------------------------------------------
// Vendor booking: floor plan → quote → hold → info → checkout → order.
// ---------------------------------------------------------------------------

/** GET /public/events/{idOrSlug}/floorplan */
export const EventFloorPlan = z.object({
  event: PublicEvent,
  venue: Venue,
  /** Absent on `quantity` events. */
  floorPlan: FloorPlan.optional(),
  availability: EventAvailability,
  /** The booking terms in force (Settings), for the wording on the booking pages. */
  terms: Settings.pick({
    holdMinutes: true,
    checkoutHoldMinutes: true,
    refundCutoffDays: true,
  }).optional(),
  /**
   * The per-day rates right now (the active price window, else the event's base rates), so the
   * picker can price a table before the server quote arrives. Table overrides and surcharges
   * apply on top, from the floor plan.
   */
  pricing: z
    .object({
      tableRateCents: z.number().int().nonnegative(),
      pokeBucksRateCents: z.number().int().nonnegative(),
      windowKind: PriceWindow.shape.kind.optional(),
      windowEndsAt: IsoDateTime.optional(),
    })
    .optional(),
});
export type EventFloorPlan = z.infer<typeof EventFloorPlan>;

export const MAX_TABLES_PER_ORDER = 10;

/** One table in the cart with the days wanted for it. */
export const TableLineInput = z.object({
  tableId: z.string().regex(/^[A-Z]{1,2}\d{1,3}$/),
  dates: z.array(IsoDate).min(1),
});
export type TableLineInput = z.infer<typeof TableLineInput>;

/** `quantity` events: how many tables, and the days wanted for all of them. */
export const TableCountInput = z.object({
  quantity: z.number().int().positive().max(MAX_TABLES_PER_ORDER),
  dates: z.array(IsoDate).min(1),
});
export type TableCountInput = z.infer<typeof TableCountInput>;

export const QuoteLineInput = z.union([TableLineInput, TableCountInput]);
export type QuoteLineInput = z.infer<typeof QuoteLineInput>;

/** POST /vendor/events/{id}/quote and /holds: the cart. One rate applies to every table. */
export const QuoteInput = z.object({
  lines: z.array(QuoteLineInput).min(1).max(MAX_TABLES_PER_ORDER),
  rate: TableRate,
});
export type QuoteInput = z.infer<typeof QuoteInput>;

const LinePrice = {
  /** Per table per day. */
  unitCents: z.number().int().nonnegative(),
  lineCents: z.number().int().nonnegative(),
  pricingInputs: PricingInputs,
};

/** Price resolved server-side per table (base rate, price window, table override). */
export const TableQuoteLine = TableLineInput.extend({
  ...LinePrice,
  /** "Row B · Main Hall", "Right by the stage, next to the Art Station." */
  rowLabel: z.string(),
  nearby: z.string(),
});
export type TableQuoteLine = z.infer<typeof TableQuoteLine>;

export const TableCountQuoteLine = TableCountInput.extend(LinePrice);
export type TableCountQuoteLine = z.infer<typeof TableCountQuoteLine>;

export const QuoteLine = z.union([TableQuoteLine, TableCountQuoteLine]);
export type QuoteLine = z.infer<typeof QuoteLine>;

export const Quote = z.object({
  rate: TableRate,
  lines: z.array(QuoteLine).min(1),
  subtotalCents: z.number().int().nonnegative(),
  feeCents: z.number().int().nonnegative(),
  taxCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
});
export type Quote = z.infer<typeof Quote>;

/** POST /vendor/events/{id}/holds, GET/PATCH /vendor/holds/{id} */
export const HoldResponse = z.object({
  hold: TableHold,
  quote: Quote,
  event: PublicEvent,
  vendorInfo: VendorInfo.optional(),
  /** From the vendor profile, to seed the info step when nothing has been saved yet. */
  prefill: VendorInfoInput.omit({ codeOfConductAccepted: true }).partial().optional(),
});
export type HoldResponse = z.infer<typeof HoldResponse>;

export const UpdateHoldInput = z.object({ vendorInfo: VendorInfoInput });
export type UpdateHoldInput = z.infer<typeof UpdateHoldInput>;

/** POST /vendor/holds/{id}/checkout → send the browser to invoiceUrl. */
export const CheckoutResponse = z.object({
  orderId: Ulid,
  invoiceUrl: z.string().url(),
  /** Hold is extended to this instant while the vendor is on Shopify. */
  holdExpiresAt: IsoDateTime,
});
export type CheckoutResponse = z.infer<typeof CheckoutResponse>;

/** An order with the event denormalized for dashboards, passes and receipts. */
export const VendorOrder = Order.extend({
  event: PublicEvent.pick({
    id: true,
    slug: true,
    name: true,
    startDate: true,
    endDate: true,
    days: true,
    timeZone: true,
    venue: true,
    posterUrl: true,
  }),
  /** "Sat Oct 24 · 8:30am" when the event defines a load-in time. */
  loadInLabel: z.string().optional(),
});
export type VendorOrder = z.infer<typeof VendorOrder>;

export const VendorOrderList = z.object({ orders: z.array(VendorOrder) });
export type VendorOrderList = z.infer<typeof VendorOrderList>;

export const CancelRequestInput = z.object({ reason: z.string().max(1000).optional() });
export type CancelRequestInput = z.infer<typeof CancelRequestInput>;

/** GET /vendor/dashboard (mock 1m). */
/** GET/PATCH /vendor/profile — the vendor record with its logo resolved to a URL. */
export const VendorProfile = Vendor.extend({ logoUrl: z.string().url().optional() });
export type VendorProfile = z.infer<typeof VendorProfile>;

export const VendorDashboard = z.object({
  vendor: VendorProfile,
  upcoming: z.array(VendorOrder),
  history: z.array(VendorOrder),
  paidThisYearCents: z.number().int().nonnegative(),
  balanceDueCents: z.number().int().nonnegative(),
  refundCutoffDays: z.number().int().nonnegative(),
});
export type VendorDashboard = z.infer<typeof VendorDashboard>;

/** GET /public/events/{idOrSlug}/vendors — who has a paid table. No contact details. */
/** One vendor at an event, however many tables they booked. */
export const EventVendor = z.object({
  vendorId: Ulid,
  name: z.string(),
  sellsDescription: z.string(),
  tags: z.array(SellsCategory),
  logoUrl: z.string().url().optional(),
  socials: SocialHandles,
  /** Empty on `quantity` events, where tables have no spots yet. */
  tables: z.array(z.object({ tableId: z.string(), dates: z.array(IsoDate).min(1) })),
});
export type EventVendor = z.infer<typeof EventVendor>;
export const EventVendorList = z.object({ event: PublicEvent, vendors: z.array(EventVendor) });
export type EventVendorList = z.infer<typeof EventVendorList>;

// ---------------------------------------------------------------------------
// Admin orders.
// ---------------------------------------------------------------------------

/** GET /admin/orders?eventId=&status=&cursor= */
export const AdminOrderList = Paginated(VendorOrder);
export type AdminOrderList = z.infer<typeof AdminOrderList>;

export const RefundInput = z.object({ reason: z.string().max(1000).optional() });
export type RefundInput = z.infer<typeof RefundInput>;

/** GET /admin/orders/cancel-requests — paid orders whose vendor asked to cancel, oldest first. */
export const CancelRequestList = z.object({
  items: z.array(VendorOrder),
  refundCutoffDays: z.number().int().nonnegative(),
});
export type CancelRequestList = z.infer<typeof CancelRequestList>;

/**
 * POST /admin/orders/{id}/cancel-request/approve — refund and free the tables. `amountCents`
 * defaults to the full total; less is allowed (inside the refund window staff decide).
 */
export const ApproveCancelInput = z.object({
  amountCents: z.number().int().nonnegative().optional(),
  note: z.string().max(1000).optional(),
});
export type ApproveCancelInput = z.infer<typeof ApproveCancelInput>;

/** POST /admin/orders/{id}/cancel-request/decline — the booking stays; the vendor sees the note. */
export const DeclineCancelInput = z.object({ note: z.string().max(1000).optional() });
export type DeclineCancelInput = z.infer<typeof DeclineCancelInput>;

/**
 * POST /admin/orders/comp — staff assign a table without payment (source: manual, $0). Send
 * `tableId` on floor-plan events and `quantity` on `quantity` events.
 */
export const CompOrderInput = z.object({
  eventId: Ulid,
  vendorId: Ulid,
  tableId: z
    .string()
    .regex(/^[A-Z]{1,2}\d{1,3}$/)
    .optional(),
  quantity: z.number().int().positive().max(MAX_TABLES_PER_ORDER).optional(),
  dates: z.array(IsoDate).min(1),
  note: z.string().max(500).optional(),
});
export type CompOrderInput = z.infer<typeof CompOrderInput>;
