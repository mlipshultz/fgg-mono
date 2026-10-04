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
  const prices = (plan?.tables ?? []).map((t) =>
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
    vendorStatus: ev.vendorStatus,
    ...(ev.vendorOpensAt ? { vendorOpensAt: ev.vendorOpensAt } : {}),
    ...(tablesLeft !== undefined ? { tablesLeft } : {}),
    ...(fromCents !== undefined ? { tablesFromCents: fromCents } : {}),
    tableRateCents: ev.tableRateCents,
    pokeBucksRateCents: ev.pokeBucksRateCents,
  };
}

interface Unavailable {
  tableId: string;
  date: string;
  expiresAt?: string;
}

/** Pure availability math, shared by the handler and tests. Expired holds are free. */
export function computeAvailability(
  ev: Event,
  plan: FloorPlan | undefined,
  holds: Unavailable[],
  booked: Unavailable[],
  now = new Date(),
): EventAvailability {
  const tableIds = new Set((plan?.tables ?? []).map((t) => t.id));
  const perDay = new Map<string, Set<string>>(ev.days.map((d) => [d.date, new Set<string>()]));
  const take = (u: Unavailable) => {
    const set = perDay.get(u.date);
    if (set && tableIds.has(u.tableId)) set.add(u.tableId);
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

const venueCache = new Map<string, Promise<Venue | undefined>>();
export function venueFor(id: string): Promise<Venue | undefined> {
  let p = venueCache.get(id);
  if (!p) {
    p = getVenue(id);
    venueCache.set(id, p);
  }
  return p;
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

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
