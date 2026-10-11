import type {
  Event,
  FloorPlan,
  FloorTable,
  PriceWindow,
  Quote,
  QuoteLineInput,
  Settings,
  TableCountInput,
  TableCountQuoteLine,
  TableLineInput,
  TableQuoteLine,
  TableRate,
} from '@fgg/types';
import { HttpError } from './http.js';

export interface QuoteArgs {
  event: Event;
  /** Not needed on `quantity` events. */
  floorPlan?: FloorPlan | undefined;
  priceWindows?: PriceWindow[];
  /** The cart: each table with the days wanted for it. */
  lines: QuoteLineInput[];
  rate: TableRate;
  settings: Settings;
  now?: Date;
}

const ROW_NEAR: Record<string, string> = {
  A: 'Right by the stage and tournaments',
  B: 'Right by the stage and tournaments',
  C: 'Center of the hall',
  D: 'Center of the hall',
  E: 'First row past the entrance (busiest spot)',
  F: 'First row past the entrance (busiest spot)',
};

/** "Right by the stage and tournaments, next to the Art Station." */
export function nearbyText(table: FloorTable, plan: FloorPlan): string {
  const zones = new Map(plan.zones.map((z) => [z.id, z.label]));
  const named = table.nearby.map((id) => zones.get(id)).filter((l): l is string => !!l);
  if (named.length) return `Near ${named.join(' and ')}.`;
  const row = ROW_NEAR[table.row] ?? 'Main hall';
  const side =
    table.position <= 5 ? 'next to the Art Station' : "next to Kids Trading and Find 'Em All";
  return `${row}, ${side}.`;
}

/** The price window containing `now`, if any (earliest start wins on overlap). */
export function activeWindow(windows: PriceWindow[], now: Date): PriceWindow | undefined {
  const t = now.getTime();
  return windows
    .filter((w) => new Date(w.startsAt).getTime() <= t && t < new Date(w.endsAt).getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
}

type PriceArgs = Pick<QuoteArgs, 'event' | 'floorPlan' | 'priceWindows' | 'rate' | 'now'>;

/** The wanted days, de-duplicated and sorted; every one must be a day of the event. */
function eventDates(event: Event, wanted: string[]): string[] {
  const dates = [...new Set(wanted)].sort();
  const valid = new Set(event.days.map((d) => d.date));
  for (const d of dates) {
    if (!valid.has(d)) throw new HttpError(400, 'bad_date', `${d} is not a day of this event`);
  }
  return dates;
}

/** The event's per-day rate right now: the active price window, else the base rate. */
function currentRate(args: PriceArgs): { unit: number; win: PriceWindow | undefined } {
  const { event, rate } = args;
  const win = activeWindow(args.priceWindows ?? [], args.now ?? new Date());
  const unit = win
    ? rate === 'poke_bucks'
      ? win.pokeBucksRateCents
      : win.tableRateCents
    : rate === 'poke_bucks'
      ? event.pokeBucksRateCents
      : event.tableRateCents;
  return { unit, win };
}

/** Price one table for the given days. Shared by quotes and the hold's per-table pricing. */
export function priceLine(args: PriceArgs & TableLineInput): TableQuoteLine {
  const { floorPlan, tableId } = args;
  if (!floorPlan) throw new HttpError(409, 'no_floor_plan', 'This venue has no floor plan yet');
  const table = floorPlan.tables.find((t) => t.id === tableId);
  if (!table)
    throw new HttpError(404, 'table_not_found', `Table ${tableId} is not on the floor plan`);
  const dates = eventDates(args.event, args.dates);
  if (!dates.length) throw new HttpError(400, 'bad_date', `Pick at least one day for ${tableId}`);

  const { unit: base, win } = currentRate(args);
  let unit = base;
  if (table.priceOverrideCents !== undefined) unit = table.priceOverrideCents;
  else if (table.premiumDeltaCents !== undefined) unit += table.premiumDeltaCents;
  unit = Math.max(0, unit);

  return {
    tableId,
    dates,
    unitCents: unit,
    lineCents: unit * dates.length,
    pricingInputs: {
      ...(win ? { priceWindowId: win.id, priceWindowKind: win.kind } : {}),
      ...(table.priceOverrideCents !== undefined
        ? { tableOverrideCents: table.priceOverrideCents }
        : {}),
      ...(table.premiumDeltaCents !== undefined
        ? { premiumDeltaCents: table.premiumDeltaCents }
        : {}),
    },
    rowLabel: `Row ${table.row} · Main Hall`,
    nearby: nearbyText(table, floorPlan),
  };
}

/** Price a number of unassigned tables (`quantity` events): the event rate, no table overrides. */
export function priceTableCount(args: PriceArgs & TableCountInput): TableCountQuoteLine {
  const dates = eventDates(args.event, args.dates);
  const { unit, win } = currentRate(args);
  return {
    quantity: args.quantity,
    dates,
    unitCents: unit,
    lineCents: unit * args.quantity * dates.length,
    pricingInputs: win ? { priceWindowId: win.id, priceWindowKind: win.kind } : {},
  };
}

/**
 * Resolve what the cart costs right now (docs/PLAN.md §3.4 "Pricing resolution"). The result is
 * stored on the hold and never recomputed, so a window closing mid-checkout changes nothing.
 * Fee and tax apply to the subtotal across all tables.
 */
export function resolveQuote(args: QuoteArgs): Quote {
  const { settings } = args;
  const byCount = args.event.tableBooking === 'quantity';
  const seen = new Set<string>();
  const lines = args.lines.map((l) => {
    if ('quantity' in l) {
      if (!byCount)
        throw new HttpError(400, 'bad_cart', 'Pick specific tables on the map for this event');
      // A day's tables go on one line, so each day has a single quantity.
      for (const d of l.dates) {
        if (seen.has(d)) throw new HttpError(400, 'bad_cart', `${d} is in the cart twice`);
        seen.add(d);
      }
      return priceTableCount({ ...args, ...l });
    }
    if (byCount)
      throw new HttpError(400, 'bad_cart', 'This event books tables by number, not by spot');
    if (seen.has(l.tableId))
      throw new HttpError(400, 'duplicate_table', `Table ${l.tableId} is in the cart twice`);
    seen.add(l.tableId);
    return priceLine({ ...args, ...l });
  });
  const subtotal = lines.reduce((n, l) => n + l.lineCents, 0);
  const fee = Math.round((subtotal * settings.processingFeePct) / 100);
  const tax = Math.round((subtotal * settings.taxPct) / 100);
  return {
    rate: args.rate,
    lines,
    subtotalCents: subtotal,
    feeCents: fee,
    taxCents: tax,
    totalCents: subtotal + fee + tax,
  };
}

export const dollars = (cents: number): string => (cents / 100).toFixed(2);
