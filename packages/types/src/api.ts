import { z } from 'zod';
import { Activity, Partner } from './content.js';
import { EventDay, VendorTableStatus } from './event.js';
import { CognitoSub, Email, IsoDate, IsoDateTime, Slug, TimeZone, Ulid } from './common.js';
import { Me, Role } from './user.js';
import { SocialHandles, Vendor, VendorApplication, VendorApprovalMode } from './vendor.js';
import { FloorPlan, Venue } from './venue.js';
import { Order, TableHold, TableRate, VendorInfo } from './order.js';

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
  floorPlan: FloorPlan,
  availability: EventAvailability,
});
export type EventFloorPlan = z.infer<typeof EventFloorPlan>;

export const QuoteInput = z.object({
  tableId: z.string().regex(/^[A-Z]{1,2}\d{1,3}$/),
  dates: z.array(IsoDate).min(1),
  rate: TableRate,
});
export type QuoteInput = z.infer<typeof QuoteInput>;

/** Price resolved server-side (base rate, price window, table override). Stored on the hold. */
export const Quote = QuoteInput.extend({
  unitCents: z.number().int().nonnegative(),
  amountCents: z.number().int().nonnegative(),
  feeCents: z.number().int().nonnegative(),
  taxCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  pricingInputs: z.object({
    priceWindowId: Ulid.optional(),
    priceWindowKind: z.string().optional(),
    tableOverrideCents: z.number().int().optional(),
    premiumDeltaCents: z.number().int().optional(),
  }),
  /** "Row B · Main Hall", "Right by the stage, next to the Art Station." */
  rowLabel: z.string(),
  nearby: z.string(),
});
export type Quote = z.infer<typeof Quote>;

/** POST /vendor/events/{id}/holds, GET/PATCH /vendor/holds/{id} */
export const HoldResponse = z.object({
  hold: TableHold,
  quote: Quote,
  event: PublicEvent,
  vendorInfo: VendorInfo.optional(),
  /** From the vendor profile, to seed the info step when nothing has been saved yet. */
  prefill: VendorInfo.omit({ codeOfConductAccepted: true }).partial().optional(),
});
export type HoldResponse = z.infer<typeof HoldResponse>;

export const UpdateHoldInput = z.object({ vendorInfo: VendorInfo });
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
  cancelRequestedAt: IsoDateTime.optional(),
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
  /** Other events for "Quick register". */
  events: z.array(PublicEvent),
  refundCutoffDays: z.number().int().nonnegative(),
});
export type VendorDashboard = z.infer<typeof VendorDashboard>;

/** GET /public/events/{idOrSlug}/vendors — who has a paid table. No contact details. */
export const EventVendor = z.object({
  vendorId: Ulid,
  name: z.string(),
  sellsDescription: z.string(),
  logoUrl: z.string().url().optional(),
  socials: SocialHandles,
  tableId: z.string(),
  dates: z.array(IsoDate).min(1),
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

/** POST /admin/orders/comp — staff assign a table without payment (source: manual, $0). */
export const CompOrderInput = z.object({
  eventId: Ulid,
  vendorId: Ulid,
  tableId: z.string().regex(/^[A-Z]{1,2}\d{1,3}$/),
  dates: z.array(IsoDate).min(1),
  note: z.string().max(500).optional(),
});
export type CompOrderInput = z.infer<typeof CompOrderInput>;
