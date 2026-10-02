import type { EventAvailability, FloorPlan, FloorTable, IsoDate } from '@fgg/types';
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

/** Table ids unavailable on ANY of the selected dates. */
export function unavailableFor(availability: EventAvailability, dates: IsoDate[]): Set<string> {
  const out = new Set<string>();
  for (const day of availability.days) {
    if (!dates.includes(day.date)) continue;
    for (const id of day.unavailable) out.add(id);
  }
  return out;
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
