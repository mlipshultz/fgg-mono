import { ulid } from 'ulid';
import {
  EventImageUploadInput,
  EventInput,
  PremiumTablesInput,
  VenueInput,
  type AdminEvent,
  type AdminEventList,
  type AdminVenue,
  type Event,
  type EventImageUploadResponse,
  type FloorPlan,
  type PremiumTable,
  type PriceWindow,
  type Venue,
} from '@fgg/types';
import { claimsFrom } from '../lib/auth.js';
import { isExpired } from '../lib/booking.js';
import {
  getEvent,
  getEventBySlug,
  getFloorPlan,
  getVenue,
  keys,
  listBookedTables,
  listDraftEvents,
  listHolds,
  listIndexedVenues,
  listPriceWindows,
  listPublishedEvents,
  putItem,
  stripKeys,
  TABLE,
  TransactWriteCommand,
  ddb,
} from '../lib/db.js';
import { clearVenueCache, zonedToUtcIso } from '../lib/events.js';
import { HttpError, json, parseBody, type Router } from '../lib/http.js';
import { mediaUrl, presignUpload } from '../lib/media.js';
import { require as requireCan } from '../lib/permissions.js';
import { requestSiteRebuild } from '../lib/site-rebuild.js';

const STAGE = process.env.STAGE ?? 'dev';
const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function adminEvent(item: Event, windows: PriceWindow[]): AdminEvent {
  const ev = stripKeys<Event>(item as unknown as Record<string, unknown>);
  return {
    ...ev,
    ...(ev.posterKey ? { posterUrl: mediaUrl(ev.posterKey) } : {}),
    ...(ev.cardKey ? { cardUrl: mediaUrl(ev.cardKey) } : {}),
    priceWindows: windows,
  };
}

const priceWindowsOf = async (eventId: string): Promise<PriceWindow[]> =>
  (await listPriceWindows(eventId))
    .map((w) => stripKeys<PriceWindow>(w as unknown as Record<string, unknown>))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

/** The tables on a plan that cost something other than the event rate. */
function premiumTablesOf(plan: FloorPlan): PremiumTable[] {
  return plan.tables.flatMap((t): PremiumTable[] =>
    t.priceOverrideCents !== undefined
      ? [{ tableId: t.id, priceOverrideCents: t.priceOverrideCents }]
      : t.premiumDeltaCents !== undefined
        ? [{ tableId: t.id, premiumDeltaCents: t.premiumDeltaCents }]
        : [],
  );
}

async function adminVenue(v: Venue): Promise<AdminVenue> {
  const plan = await getFloorPlan(v.id);
  return {
    ...v,
    hasFloorPlan: !!plan,
    tableIds: plan?.tables.map((t) => t.id) ?? [],
    premiumTables: plan ? premiumTablesOf(plan) : [],
  };
}

async function allEvents(): Promise<Event[]> {
  const [published, drafts] = await Promise.all([listPublishedEvents(), listDraftEvents()]);
  return [...published, ...drafts].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

/** Venues saved from the console plus any an event points at (seeded venues have no index yet). */
async function allVenues(events: Event[]): Promise<Venue[]> {
  const byId = new Map((await listIndexedVenues()).map((v) => [v.id, v]));
  for (const id of new Set(events.map((e) => e.venueId))) {
    if (byId.has(id)) continue;
    const v = await getVenue(id);
    if (v) byId.set(id, stripKeys<Venue>(v as unknown as Record<string, unknown>));
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check the editor's input against what is already sold, then build the stored event. Things a
 * vendor has paid for (or is holding) can't be pulled out from under them: the days they booked,
 * the venue whose table numbers they hold, and the way the event books.
 */
async function buildEvent(input: EventInput, existing: Event | undefined): Promise<Event> {
  const venue = await getVenue(input.venueId);
  if (!venue) throw new HttpError(404, 'venue_not_found', 'Venue not found');
  const sameSlug = await getEventBySlug(input.slug);
  if (sameSlug && sameSlug.id !== existing?.id)
    throw new HttpError(409, 'slug_taken', `Another event already uses the link "${input.slug}"`);

  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(days.map((d) => d.date)).size !== days.length)
    throw new HttpError(400, 'duplicate_day', 'Each day can only be listed once');
  for (const d of days) {
    if (d.closes <= d.opens)
      throw new HttpError(400, 'bad_hours', `${d.date} closes before it opens`);
  }
  if (input.tableBooking === 'quantity' && !input.tableCapacity)
    throw new HttpError(400, 'capacity_required', 'Say how many tables are for sale each day');
  if (
    input.tableBooking === 'floor_plan' &&
    input.vendorStatus === 'open' &&
    !(await getFloorPlan(venue.id))
  ) {
    throw new HttpError(
      409,
      'no_floor_plan',
      `${venue.name} has no floor plan yet. Book by number of tables, or keep vendor tables closed.`,
    );
  }
  for (const key of [input.posterKey, input.cardKey]) {
    if (key && !key.startsWith('events/'))
      throw new HttpError(400, 'bad_image_key', 'Image key does not belong to an event');
  }
  checkPriceWindows(input.priceWindows ?? []);

  if (existing) {
    const [booked, holds] = await Promise.all([
      listBookedTables(existing.id),
      listHolds(existing.id),
    ]);
    const taken = [...booked, ...holds.filter((h) => !isExpired(h))];
    const kept = new Set(days.map((d) => d.date));
    const lost = [...new Set(taken.map((t) => t.date))].filter((d) => !kept.has(d)).sort();
    if (lost.length)
      throw new HttpError(409, 'day_has_bookings', `${lost.join(', ')} has tables booked or held`);
    if (taken.length && (existing.tableBooking ?? 'floor_plan') !== input.tableBooking)
      throw new HttpError(
        409,
        'has_bookings',
        'Tables are already booked or held, so the way this event books cannot change',
      );
    if (taken.length && existing.venueId !== input.venueId)
      throw new HttpError(
        409,
        'has_bookings',
        'Tables are already booked or held, so the venue cannot change',
      );
  }

  const now = new Date().toISOString();
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const timeZone = venue.timeZone;
  return {
    // Fields the editor doesn't manage (floorPlanVersion) carry over.
    ...(existing ? stripKeys<Event>(existing as unknown as Record<string, unknown>) : {}),
    id: existing?.id ?? ulid(),
    slug: input.slug,
    name: input.name,
    blurb: input.blurb,
    venueId: venue.id,
    timeZone,
    days,
    startsAt: zonedToUtcIso(first.date, first.opens, timeZone),
    endsAt: zonedToUtcIso(last.date, last.closes, timeZone),
    published: input.published,
    vendorStatus: input.vendorStatus,
    tableRateCents: input.tableRateCents,
    pokeBucksRateCents: input.pokeBucksRateCents,
    tableBooking: input.tableBooking,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...optional('seriesId', input.seriesId),
    ...optional('vendorOpensAt', input.vendorOpensAt),
    ...optional(
      'tableCapacity',
      input.tableBooking === 'quantity' ? input.tableCapacity : undefined,
    ),
    ...optional('posterKey', input.posterKey),
    ...optional('cardKey', input.cardKey),
  } as Event;
}

/** Each window ends after it starts, and no two overlap (the quote would have to pick one). */
function checkPriceWindows(windows: NonNullable<EventInput['priceWindows']>): void {
  const sorted = [...windows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  sorted.forEach((w, i) => {
    if (new Date(w.endsAt) <= new Date(w.startsAt))
      throw new HttpError(400, 'bad_price_window', 'A price window has to end after it starts');
    const prev = sorted[i - 1];
    if (prev && new Date(w.startsAt) < new Date(prev.endsAt))
      throw new HttpError(400, 'overlapping_price_windows', 'Two price windows overlap');
  });
}

/**
 * Replace an event's price windows. Keys include the start, so an edited start re-keys; the
 * whole set is swapped in one transaction. Prices already held or paid are not affected.
 */
async function savePriceWindows(
  eventId: string,
  input: NonNullable<EventInput['priceWindows']>,
): Promise<PriceWindow[]> {
  const old = await listPriceWindows(eventId);
  const next: PriceWindow[] = input
    .map((w) => ({ ...w, id: w.id ?? ulid() }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const items = [
    ...old.map((w) => ({
      Delete: { TableName: TABLE, Key: keys.priceWindow(eventId, w.kind, w.startsAt) },
    })),
    ...next.map((w) => ({
      Put: { TableName: TABLE, Item: { ...keys.priceWindow(eventId, w.kind, w.startsAt), ...w } },
    })),
  ];
  // A window kept as it was is both deleted and put under the same key: just put it.
  const putKeys = new Set(next.map((w) => `${w.kind}#${w.startsAt}`));
  const ops = items.filter(
    (op) => !('Delete' in op) || !putKeys.has(op.Delete.Key.SK.replace(/^PRICE#/, '')),
  );
  if (ops.length) await ddb.send(new TransactWriteCommand({ TransactItems: ops }));
  return next;
}

/** `{ key: value }`, or `{ key: undefined }` so a cleared field overrides the stored one. */
const optional = <K extends string, V>(key: K, value: V | undefined) =>
  ({ [key]: value || undefined }) as Record<K, V | undefined>;

/** The whole item is rewritten, so a draft leaves the published index and a new slug re-keys. */
async function saveEvent(ev: Event): Promise<void> {
  const clean = Object.fromEntries(Object.entries(ev).filter(([, v]) => v !== undefined)) as Event;
  await putItem({ ...keys.eventIndex(clean), ...clean });
}

/** Save the event, and its price windows when the editor sent them. */
async function saveWithWindows(ev: Event, input: EventInput): Promise<AdminEvent> {
  await saveEvent(ev);
  const windows = input.priceWindows
    ? await savePriceWindows(ev.id, input.priceWindows)
    : await priceWindowsOf(ev.id);
  return adminEvent(ev, windows);
}

/** Events, venues and the site rebuild: staff and superadmin (`manage_events`). */
export function addEventAdminRoutes(router: Router): void {
  router
    .add('GET', '/admin/events', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      const events = await allEvents();
      const venues = await allVenues(events);
      const body: AdminEventList = {
        events: await Promise.all(
          events.map(async (e) => adminEvent(e, await priceWindowsOf(e.id))),
        ),
        venues: await Promise.all(venues.map(adminVenue)),
      };
      return json(req, body, 200, { 'cache-control': 'no-store' });
    })
    .add('POST', '/admin/events', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      const input = parseBody(req, EventInput);
      const ev = await buildEvent(input, undefined);
      return json(req, await saveWithWindows(ev, input), 201);
    })
    .add('POST', '/admin/events/image-upload', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      const input = parseBody(req, EventImageUploadInput);
      const key = `events/${input.kind}-${ulid().toLowerCase()}.${IMAGE_EXT[input.contentType]}`;
      const body: EventImageUploadResponse = {
        uploadUrl: await presignUpload(key, input.contentType),
        key,
        url: mediaUrl(key),
      };
      return json(req, body, 201, { 'cache-control': 'no-store' });
    })
    .add('PUT', '/admin/events/{id}', async (req, { id }) => {
      requireCan(claimsFrom(req), 'manage_events');
      const existing = await getEvent(id!);
      if (!existing) throw new HttpError(404, 'event_not_found', 'Event not found');
      const input = parseBody(req, EventInput);
      const ev = await buildEvent(input, existing);
      return json(req, await saveWithWindows(ev, input));
    })
    .add('POST', '/admin/venues', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      const venue: Venue = { id: ulid(), ...parseBody(req, VenueInput) };
      await putItem({ ...keys.venueIndex(venue), ...venue });
      return json(req, await adminVenue(venue), 201);
    })
    .add('PUT', '/admin/venues/{id}', async (req, { id }) => {
      requireCan(claimsFrom(req), 'manage_events');
      if (!(await getVenue(id!))) throw new HttpError(404, 'venue_not_found', 'Venue not found');
      const venue: Venue = { id: id!, ...parseBody(req, VenueInput) };
      await putItem({ ...keys.venueIndex(venue), ...venue });
      clearVenueCache();
      return json(req, await adminVenue(venue));
    })
    .add('PUT', '/admin/venues/{id}/premium-tables', async (req, { id }) => {
      requireCan(claimsFrom(req), 'manage_events');
      const venue = await getVenue(id!);
      if (!venue) throw new HttpError(404, 'venue_not_found', 'Venue not found');
      const raw = await getFloorPlan(id!);
      if (!raw) throw new HttpError(409, 'no_floor_plan', `${venue.name} has no floor plan yet`);
      const plan = stripKeys<FloorPlan>(raw as unknown as Record<string, unknown>);
      const { tables } = parseBody(req, PremiumTablesInput);
      const wanted = new Map(tables.map((t) => [t.tableId, t]));
      const unknown = [...wanted.keys()].filter((tid) => !plan.tables.some((t) => t.id === tid));
      if (unknown.length)
        throw new HttpError(400, 'table_not_found', `Not on the floor plan: ${unknown.join(', ')}`);
      const next: FloorPlan = {
        ...plan,
        version: plan.version + 1,
        tables: plan.tables.map(({ priceOverrideCents: _o, premiumDeltaCents: _d, ...t }) => {
          const p = wanted.get(t.id);
          if (!p) return t;
          return 'priceOverrideCents' in p
            ? { ...t, priceOverrideCents: p.priceOverrideCents }
            : { ...t, premiumDeltaCents: p.premiumDeltaCents };
        }),
      };
      await putItem({ ...keys.floorPlan(venue.id), ...next });
      return json(
        req,
        await adminVenue(stripKeys<Venue>(venue as unknown as Record<string, unknown>)),
      );
    })
    .add('POST', '/admin/site/rebuild', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      await requestSiteRebuild(STAGE);
      return json(req, { ok: true }, 202);
    });
}
