import { ulid } from 'ulid';
import {
  EventImageUploadInput,
  EventInput,
  VenueInput,
  type AdminEvent,
  type AdminEventList,
  type AdminVenue,
  type Event,
  type EventImageUploadResponse,
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
  listPublishedEvents,
  putItem,
  stripKeys,
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

function adminEvent(item: Event): AdminEvent {
  const ev = stripKeys<Event>(item as unknown as Record<string, unknown>);
  return {
    ...ev,
    ...(ev.posterKey ? { posterUrl: mediaUrl(ev.posterKey) } : {}),
    ...(ev.cardKey ? { cardUrl: mediaUrl(ev.cardKey) } : {}),
  };
}

async function adminVenue(v: Venue): Promise<AdminVenue> {
  return { ...v, hasFloorPlan: !!(await getFloorPlan(v.id)) };
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

/** `{ key: value }`, or `{ key: undefined }` so a cleared field overrides the stored one. */
const optional = <K extends string, V>(key: K, value: V | undefined) =>
  ({ [key]: value || undefined }) as Record<K, V | undefined>;

/** The whole item is rewritten, so a draft leaves the published index and a new slug re-keys. */
async function saveEvent(ev: Event): Promise<void> {
  const clean = Object.fromEntries(Object.entries(ev).filter(([, v]) => v !== undefined)) as Event;
  await putItem({ ...keys.eventIndex(clean), ...clean });
}

/** Events, venues and the site rebuild: staff and superadmin (`manage_events`). */
export function addEventAdminRoutes(router: Router): void {
  router
    .add('GET', '/admin/events', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      const events = await allEvents();
      const venues = await allVenues(events);
      const body: AdminEventList = {
        events: events.map(adminEvent),
        venues: await Promise.all(venues.map(adminVenue)),
      };
      return json(req, body, 200, { 'cache-control': 'no-store' });
    })
    .add('POST', '/admin/events', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      const ev = await buildEvent(parseBody(req, EventInput), undefined);
      await saveEvent(ev);
      return json(req, adminEvent(ev), 201);
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
      const ev = await buildEvent(parseBody(req, EventInput), existing);
      await saveEvent(ev);
      return json(req, adminEvent(ev));
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
    .add('POST', '/admin/site/rebuild', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      await requestSiteRebuild(STAGE);
      return json(req, { ok: true }, 202);
    });
}
