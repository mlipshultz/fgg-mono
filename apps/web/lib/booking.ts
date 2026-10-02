import type { EventAvailability, FloorPlan, FloorTable, IsoDate, Order } from '@fgg/types';
import { dayOfWeek, parseIsoDate } from './dates';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "$200" or "$206.10" */
export function fmtCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString('en-US')}`
    : `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "Sat Oct 24" */
export function dayLabel(d: IsoDate): string {
  const p = parseIsoDate(d);
  return `${dayOfWeek(d)} ${MONTHS[p.m - 1]} ${p.d}`;
}

/** "Sat Oct 24 + Sun Oct 25" */
export function daysLabel(dates: IsoDate[]): string {
  return dates.map(dayLabel).join(' + ');
}

/** "8:30am" from "08:30" */
export function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

/** For every table on the plan, the event days it can still be booked on. */
export function openDaysByTable(
  plan: FloorPlan,
  availability: EventAvailability,
): Map<string, Set<IsoDate>> {
  const out = new Map<string, Set<IsoDate>>(plan.tables.map((t) => [t.id, new Set<IsoDate>()]));
  for (const day of availability.days) {
    const taken = new Set(day.unavailable);
    for (const t of plan.tables) if (!taken.has(t.id)) out.get(t.id)!.add(day.date);
  }
  return out;
}

/** One colour and line direction per event day (the last N of this list, so a two-day event is
 *  aqua "/" + yellow "\\" and a three-day event adds pink "—" for its first day). */
export const DAY_MARKS = [
  { color: 'var(--color-pink)', angle: '0deg', name: 'pink' },
  { color: 'var(--color-aqua)', angle: '45deg', name: 'aqua' },
  { color: 'var(--color-yellow)', angle: '-45deg', name: 'yellow' },
] as const;

export function dayMark(eventDays: IsoDate[], date: IsoDate) {
  const i = eventDays.indexOf(date);
  const offset = Math.max(0, DAY_MARKS.length - eventDays.length);
  return DAY_MARKS[Math.min(DAY_MARKS.length - 1, offset + Math.max(0, i))]!;
}

/** CSS background-image layering one stripe pattern per open day; undefined when open every day. */
export function stripesFor(
  eventDays: IsoDate[],
  openDays: ReadonlySet<IsoDate>,
): string | undefined {
  if (openDays.size === 0 || openDays.size === eventDays.length) return undefined;
  return eventDays
    .filter((d) => openDays.has(d))
    .map((d) => {
      const m = dayMark(eventDays, d);
      return `repeating-linear-gradient(${m.angle}, ${m.color} 0 3px, transparent 3px 8px)`;
    })
    .join(', ');
}

/** A single day's stripe, for filter chips and legends. */
export function stripeFor(eventDays: IsoDate[], date: IsoDate): string {
  const m = dayMark(eventDays, date);
  return `repeating-linear-gradient(${m.angle}, ${m.color} 0 3px, transparent 3px 8px)`;
}

/** "Sat" / "Sat + Sun" / "All days" */
export function daysShort(eventDays: IsoDate[], dates: IsoDate[]): string {
  if (dates.length === eventDays.length)
    return eventDays.length === 1 ? dayLabel(dates[0]!) : 'All days';
  return dates.map((d) => dayOfWeek(d)).join(' + ');
}

/** Every table line of an order. */
export function tableLinesOf(order: Pick<Order, 'lines'>) {
  return order.lines.flatMap((l) => (l.type === 'table' ? [l] : []));
}
/** "B7" or "B7, B8" */
export function tablesLabel(order: Pick<Order, 'lines'>): string {
  return tableLinesOf(order)
    .map((l) => l.tableId)
    .join(', ');
}
/** Union of booked days, sorted. */
export function orderDates(order: Pick<Order, 'lines'>): IsoDate[] {
  return [...new Set(tableLinesOf(order).flatMap((l) => l.dates))].sort();
}

export function tableById(plan: FloorPlan, id: string): FloorTable | undefined {
  return plan.tables.find((t) => t.id === id);
}

/** Rows grouped into back-to-back pairs [A,B], [C,D], [E,F] with left/right halves at the aisle. */
export interface RowLayout {
  row: string;
  left: FloorTable[];
  right: FloorTable[];
}
export function rowLayouts(plan: FloorPlan): RowLayout[] {
  const rows = new Map<string, FloorTable[]>();
  for (const t of plan.tables) {
    const list = rows.get(t.row) ?? [];
    list.push(t);
    rows.set(t.row, list);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([row, tables]) => {
      const sorted = [...tables].sort((a, b) => a.position - b.position);
      const mid = Math.ceil(sorted.length / 2);
      return { row, left: sorted.slice(0, mid), right: sorted.slice(mid) };
    });
}

export function rowPairs(plan: FloorPlan): [RowLayout, RowLayout | undefined][] {
  const rows = rowLayouts(plan);
  const pairs: [RowLayout, RowLayout | undefined][] = [];
  for (let i = 0; i < rows.length; i += 2) pairs.push([rows[i]!, rows[i + 1]]);
  return pairs;
}

const ROW_NEAR: Record<string, string> = {
  A: 'Right by the stage and tournaments',
  B: 'Right by the stage and tournaments',
  C: 'Center of the hall',
  D: 'Center of the hall',
  E: 'First row past the entrance (busiest spot)',
  F: 'First row past the entrance (busiest spot)',
};

/** Local fallback for the server's `nearby` text while a quote is loading. */
export function nearbyText(plan: FloorPlan, table: FloorTable): string {
  const zones = table.nearby
    .map((id) => plan.zones.find((z) => z.id === id)?.label)
    .filter((l): l is string => !!l);
  const side =
    zones.length > 0
      ? `next to ${zones.join(' and ')}`
      : table.position <= 5
        ? 'next to the Art Station'
        : "next to Kids Trading and Find 'Em All";
  return `${ROW_NEAR[table.row] ?? 'Main Hall'}, ${side}.`;
}

export function countdown(expiresAt: string, now = Date.now()): { text: string; expired: boolean } {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return { text: '0:00', expired: true };
  const s = Math.floor(ms / 1000);
  return { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, expired: false };
}

export const RATE_LABEL = { standard: 'Standard', poke_bucks: 'PokéBucks partner' } as const;
