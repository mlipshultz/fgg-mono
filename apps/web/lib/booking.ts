import type {
  EventAvailability,
  EventFloorPlan,
  FloorPlan,
  FloorTable,
  IsoDate,
  Order,
} from '@fgg/types';
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
/** Tables with no spots yet on each booked day of a `quantity` order, in day order. */
export function unassignedByDay(order: Pick<Order, 'lines'>): [date: IsoDate, quantity: number][] {
  const byDay = new Map<IsoDate, number>();
  for (const l of order.lines) {
    if (l.type !== 'unassigned_tables') continue;
    for (const d of l.dates) byDay.set(d, (byDay.get(d) ?? 0) + l.quantity);
  }
  return [...byDay.entries()].sort(([x], [y]) => x.localeCompare(y));
}
/** Tables booked by number on a `quantity` event (the most on any one day); FGG assigns them. */
export function unassignedTables(order: Pick<Order, 'lines'>): number {
  return Math.max(0, ...unassignedByDay(order).map(([, n]) => n));
}
/** How many tables an order books, whichever way the event books. */
export function tableCount(order: Pick<Order, 'lines'>): number {
  return tableLinesOf(order).length + unassignedTables(order);
}
/** Every line that books tables, for the days and the rate. */
function bookedLinesOf(order: Pick<Order, 'lines'>) {
  return order.lines.flatMap((l) => (l.type === 'ticket' ? [] : [l]));
}
export function orderRate(order: Pick<Order, 'lines'>) {
  return bookedLinesOf(order)[0]?.rate;
}
/** "1 table" / "3 tables" */
export function tableCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'table' : 'tables'}`;
}
/**
 * "B7" or "B7, B8". Tables with no spots yet read "2 tables", or day by day when the number
 * differs: "2 tables Sat, 1 table Sun".
 */
export function tablesLabel(order: Pick<Order, 'lines'>): string {
  const byDay = unassignedByDay(order);
  const same = byDay.every(([, n]) => n === byDay[0]![1]);
  const unassigned = !byDay.length
    ? []
    : same
      ? [tableCountLabel(byDay[0]![1])]
      : byDay.map(([d, n]) => `${tableCountLabel(n)} ${dayOfWeek(d)}`);
  return [...tableLinesOf(order).map((l) => l.tableId), ...unassigned].join(', ');
}
/** "Table B7" / "Tables B7, B8" / "2 tables" */
export function tablesPhrase(order: Pick<Order, 'lines'>): string {
  const label = tablesLabel(order);
  if (unassignedTables(order) || !label) return label;
  return `${tableLinesOf(order).length === 1 ? 'Table' : 'Tables'} ${label}`;
}
/**
 * Tables with their days, only spelling days out per table when they differ:
 * "B2, C4 · Sat + Sun" when every table has the same days, else "B2 · Sat, C4 · Sat + Sun".
 * Tables with no spots yet read "2 tables · Sat + Sun", or "2 tables Sat, 1 table Sun".
 */
export function tableDaysSummary(order: Pick<Order, 'lines'>, eventDays?: IsoDate[]): string {
  const byDay = unassignedByDay(order);
  if (byDay.length) {
    // A different number each day already names the days: "2 tables Sat, 1 table Sun".
    if (byDay.some(([, n]) => n !== byDay[0]![1])) return tablesLabel(order);
    const dates = byDay.map(([d]) => d);
    const days = eventDays ? daysShort(eventDays, dates) : dates.map(dayOfWeek).join(' + ');
    return `${tablesLabel(order)} · ${days}`;
  }
  const lines = tableLinesOf(order);
  if (!lines.length) return '—';
  const key = (d: IsoDate[]) => [...d].sort().join();
  const same = lines.every((l) => key(l.dates) === key(lines[0]!.dates));
  const spelled = (d: IsoDate[]) => [...d].sort().map(dayOfWeek).join(' + ');
  if (same) {
    const days = eventDays
      ? daysShort(eventDays, [...lines[0]!.dates].sort())
      : spelled(lines[0]!.dates);
    return `${lines.map((l) => l.tableId).join(', ')} · ${days}`;
  }
  // Days differ per table: spell each one out so "Sat" and "Sat + Sun" sit side by side.
  return lines.map((l) => `${l.tableId} · ${spelled(l.dates)}`).join(', ');
}

/** Total table-days on an order (a table booked for two days counts twice). */
export function tableDaysCount(order: Pick<Order, 'lines'>): number {
  return bookedLinesOf(order).reduce(
    (n, l) => n + l.dates.length * (l.type === 'unassigned_tables' ? l.quantity : 1),
    0,
  );
}

/** Union of booked days, sorted. */
export function orderDates(order: Pick<Order, 'lines'>): IsoDate[] {
  return [...new Set(bookedLinesOf(order).flatMap((l) => l.dates))].sort();
}

const WINDOW_LABEL = { early_bird: 'Early-bird', late: 'Late' } as const;

/** "Early-bird pricing until Oct 1", when an early-bird or late window is in force. */
export function priceWindowNote(pricing?: EventFloorPlan['pricing']): string | undefined {
  if (!pricing?.windowKind || pricing.windowKind === 'standard' || !pricing.windowEndsAt) return;
  const end = new Date(new Date(pricing.windowEndsAt).getTime() - 1);
  const until = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${WINDOW_LABEL[pricing.windowKind]} pricing until ${until}`;
}

/** What a table costs per day at a base rate: its fixed price, or the rate plus its surcharge. */
export function tableUnitCents(table: FloorTable | undefined, baseCents: number): number {
  if (!table) return baseCents;
  if (table.priceOverrideCents !== undefined) return table.priceOverrideCents;
  return Math.max(0, baseCents + (table.premiumDeltaCents ?? 0));
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
