import type {
  Event,
  EventAvailability,
  EventDay,
  FloorPlan,
  PriceWindow,
  PublicEvent,
  Venue,
} from '@fgg/types';
import { mediaUrl } from './media.js';
import { getFloorPlan, getVenue, listBookedTables, listHolds, listPriceWindows } from './db.js';
import { activeWindow } from './pricing.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "11:00" → "11am", "17:00" → "5pm", "10:30" → "10:30am". */
export function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

function dowOf(date: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return DOW[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]!;
}

/** "11am–5pm" when every day matches, else "Fri 10am–5pm · Sat 10am–8pm · Sun 10am–5pm". */
export function hoursLabel(days: EventDay[]): string {
  const spans = days.map((d) => `${fmtTime(d.opens)}–${fmtTime(d.closes)}`);
  if (spans.every((s) => s === spans[0])) return spans[0] ?? '';
  return days.map((d, i) => `${dowOf(d.date)} ${spans[i]}`).join(' · ');
}

/** Cheapest standard per-day price a vendor could pay today, for "Tables from $X". */
export function tablesFromCents(
  ev: Event,
  plan: FloorPlan | undefined,
  windows: PriceWindow[],
  now = new Date(),
): number {
  const win = activeWindow(windows, now);
  const base = win ? win.tableRateCents : ev.tableRateCents;
  const tables = ev.tableBooking === 'quantity' ? [] : (plan?.tables ?? []);
  const prices = tables.map((t) =>
    t.priceOverrideCents !== undefined
      ? t.priceOverrideCents
      : Math.max(0, base + (t.premiumDeltaCents ?? 0)),
  );
  return prices.length ? Math.min(...prices) : base;
}

export function toPublicEvent(
  ev: Event,
  venue: Venue,
  tablesLeft?: number,
  fromCents?: number,
): PublicEvent {
  const dates = [...ev.days].map((d) => d.date).sort();
  return {
    id: ev.id,
    slug: ev.slug,
    name: ev.name,
    blurb: ev.blurb,
    timeZone: ev.timeZone,
    days: ev.days,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    startDate: dates[0]!,
    endDate: dates[dates.length - 1]!,
    hoursLabel: hoursLabel(ev.days),
    venue: { id: venue.id, name: venue.name, city: venue.city, state: venue.state },
    ...(ev.posterKey ? { posterUrl: mediaUrl(ev.posterKey) } : {}),
    ...(ev.cardKey ? { cardUrl: mediaUrl(ev.cardKey) } : {}),
    vendorStatus: ev.vendorStatus,
    ...(ev.vendorOpensAt ? { vendorOpensAt: ev.vendorOpensAt } : {}),
    ...(ev.tableBooking === 'quantity' ? { tableBooking: ev.tableBooking } : {}),
    ...(tablesLeft !== undefined ? { tablesLeft } : {}),
    ...(fromCents !== undefined ? { tablesFromCents: fromCents } : {}),
    tableRateCents: ev.tableRateCents,
    pokeBucksRateCents: ev.pokeBucksRateCents,
  };
}

interface Unavailable {
  tableId?: string;
  quantity?: number;
  date: string;
  expiresAt?: string;
  holdId?: string;
  orderId?: string;
}

/**
 * Tables in use per day on a `quantity` event: booked rows plus live holds. `except` leaves out
 * one hold or order, so a booking being finalized doesn't count against itself.
 */
export function tablesUsedByDay(
  holds: Unavailable[],
  booked: Unavailable[],
  now = new Date(),
  except: { holdId?: string | undefined; orderId?: string | undefined } = {},
): Map<string, number> {
  const used = new Map<string, number>();
  const add = (u: Unavailable) => used.set(u.date, (used.get(u.date) ?? 0) + (u.quantity ?? 1));
  for (const b of booked) if (!except.orderId || b.orderId !== except.orderId) add(b);
  for (const h of holds) {
    if (h.expiresAt && new Date(h.expiresAt).getTime() < now.getTime()) continue;
    if (except.holdId && h.holdId === except.holdId) continue;
    add(h);
  }
  return used;
}

/** Pure availability math, shared by the handler and tests. Expired holds are free. */
export function computeAvailability(
  ev: Event,
  plan: FloorPlan | undefined,
  holds: Unavailable[],
  booked: Unavailable[],
  now = new Date(),
): EventAvailability {
  if (ev.tableBooking === 'quantity') {
    const capacity = ev.tableCapacity ?? 0;
    const used = tablesUsedByDay(holds, booked, now);
    const days = ev.days.map((d) => ({
      date: d.date,
      unavailable: [],
      left: Math.max(0, capacity - (used.get(d.date) ?? 0)),
    }));
    return {
      eventId: ev.id,
      vendorStatus: ev.vendorStatus,
      // The most a vendor could still book on some day.
      tablesLeft: Math.max(0, ...days.map((d) => d.left)),
      days,
    };
  }
  const tableIds = new Set((plan?.tables ?? []).map((t) => t.id));
  const perDay = new Map<string, Set<string>>(ev.days.map((d) => [d.date, new Set<string>()]));
  const take = (u: Unavailable) => {
    const set = perDay.get(u.date);
    if (set && u.tableId && tableIds.has(u.tableId)) set.add(u.tableId);
  };
  for (const b of booked) take(b);
  for (const h of holds) {
    if (h.expiresAt && new Date(h.expiresAt).getTime() < now.getTime()) continue;
    take(h);
  }
  // "N left" = distinct tables that still have at least one bookable day.
  let tablesLeft = 0;
  for (const id of tableIds) {
    if ([...perDay.values()].some((taken) => !taken.has(id))) tablesLeft += 1;
  }
  return {
    eventId: ev.id,
    vendorStatus: ev.vendorStatus,
    tablesLeft,
    days: ev.days.map((d) => ({
      date: d.date,
      unavailable: [...(perDay.get(d.date) ?? [])].sort(),
    })),
  };
}

export async function loadAvailability(ev: Event): Promise<EventAvailability> {
  const [plan, holds, booked] = await Promise.all([
    getFloorPlan(ev.venueId),
    listHolds(ev.id),
    listBookedTables(ev.id),
  ]);
  return computeAvailability(ev, plan, holds, booked);
}

/** Venues change rarely but are editable in admin, so a warm Lambda re-reads them every minute. */
const VENUE_TTL_MS = 60_000;
const venueCache = new Map<string, { at: number; venue: Promise<Venue | undefined> }>();
export function venueFor(id: string): Promise<Venue | undefined> {
  const hit = venueCache.get(id);
  if (hit && Date.now() - hit.at < VENUE_TTL_MS) return hit.venue;
  const venue = getVenue(id);
  venueCache.set(id, { at: Date.now(), venue });
  return venue;
}
export function clearVenueCache(): void {
  venueCache.clear();
}

/** Resolve public events with venues; tablesLeft only for open events. */
export async function toPublicEvents(events: Event[]): Promise<PublicEvent[]> {
  const out: PublicEvent[] = [];
  for (const ev of events) {
    const venue = await venueFor(ev.venueId);
    if (!venue) continue;
    const left = ev.vendorStatus === 'open' ? (await loadAvailability(ev)).tablesLeft : undefined;
    const [plan, windows] = await Promise.all([getFloorPlan(ev.venueId), listPriceWindows(ev.id)]);
    out.push(toPublicEvent(ev, venue, left, tablesFromCents(ev, plan, windows)));
  }
  return out;
}

/** A wall-clock time in an IANA zone as a UTC instant: ("2026-10-24", "11:00", New York) → 15:00Z. */
export function zonedToUtcIso(date: string, hhmm: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  /** What the zone's clock reads at a UTC instant, as if that reading were UTC. */
  const readingAt = (utc: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!);
  };
  // Start from the wall time as UTC and correct by the zone's offset; twice, for DST edges.
  let utc = wall - (readingAt(wall) - wall);
  utc = wall - (readingAt(utc) - utc);
  return new Date(utc).toISOString();
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
