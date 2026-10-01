import type { IsoDate, PublicEvent } from '@fgg/types';

export type IsoDateLike = IsoDate;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Parse YYYY-MM-DD without time-zone surprises. */
export function parseIsoDate(d: IsoDate): { y: number; m: number; d: number } {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return { y, m, d: day };
}

export function toIsoDate(y: number, m: number, d: number): IsoDate {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Local-date UTC proxy, safe for day-of-week math. */
function utc(d: IsoDate): Date {
  const { y, m, d: day } = parseIsoDate(d);
  return new Date(Date.UTC(y, m - 1, day));
}

export function monthAbbr(d: IsoDate): string {
  return MONTHS[parseIsoDate(d).m - 1]!.toUpperCase();
}

export function monthLong(y: number, m: number): string {
  return MONTHS_LONG[m - 1]!;
}

export function year(d: IsoDate): number {
  return parseIsoDate(d).y;
}

export function dayOfWeek(d: IsoDate): string {
  return DOWS[utc(d).getUTCDay()]!;
}

/** "24–25" or "6–8" or "24" for a single day. */
export function dayRange(start: IsoDate, end: IsoDate): string {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (start === end) return String(a.d);
  if (a.m === b.m) return `${a.d}–${b.d}`;
  return `${MONTHS[a.m - 1]} ${a.d} – ${MONTHS[b.m - 1]} ${b.d}`;
}

/** "Sat–Sun" */
export function dowRange(start: IsoDate, end: IsoDate): string {
  if (start === end) return dayOfWeek(start);
  return `${dayOfWeek(start)}–${dayOfWeek(end)}`;
}

/** "Sat–Sun, Oct 24–25" (year appended when not the current year) */
export function fullDateLabel(start: IsoDate, end: IsoDate, withYear = false): string {
  const a = parseIsoDate(start);
  const base = `${dowRange(start, end)}, ${MONTHS[a.m - 1]} ${dayRange(start, end)}`;
  return withYear ? `${base}, ${a.y}` : base;
}

/** "Oct 24–25" */
export function shortDateLabel(start: IsoDate, end: IsoDate): string {
  const a = parseIsoDate(start);
  return `${MONTHS[a.m - 1]} ${dayRange(start, end)}`;
}

/** "Aug 2026" */
export function monthYearLabel(d: IsoDate): string {
  const a = parseIsoDate(d);
  return `${MONTHS[a.m - 1]} ${a.y}`;
}

export function todayIso(): IsoDate {
  const now = new Date();
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function daysUntil(d: IsoDate, from: IsoDate = todayIso()): number {
  return Math.round((utc(d).getTime() - utc(from).getTime()) / 86_400_000);
}

export function countdownLabel(start: IsoDate, from?: IsoDate): string {
  const n = daysUntil(start, from);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n > 90) return monthYearLabel(start);
  return `In ${n} days`;
}

/** Every calendar date an event covers. */
export function eventDates(ev: Pick<PublicEvent, 'days'>): IsoDate[] {
  return ev.days.map((d) => d.date);
}

export interface CalendarCell {
  date: IsoDate | null;
  day: number | null;
}

/** 7-column month grid starting on Sunday, padded with empty cells. */
export function monthGrid(y: number, m: number): CalendarCell[] {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = first.getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= count; d++) cells.push({ date: toIsoDate(y, m, d), day: d });
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
  return cells;
}

/** Rotating stub color for cards and tiles: pink, aqua, yellow. */
export const STUB_COLORS = ['pink', 'aqua', 'yellow'] as const;
export type StubColor = (typeof STUB_COLORS)[number];
export function stubColor(index: number): StubColor {
  return STUB_COLORS[index % 3]!;
}
