import type {
  Event,
  FloorPlan,
  FloorTable,
  PriceWindow,
  Quote,
  Settings,
  TableRate,
} from '@fgg/types';
import { HttpError } from './http.js';

export interface QuoteArgs {
  event: Event;
  floorPlan: FloorPlan;
  priceWindows?: PriceWindow[];
  tableId: string;
  dates: string[];
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

/**
 * Resolve what a table costs right now (docs/PLAN.md §3.4 "Pricing resolution"). The result is
 * stored on the hold and never recomputed, so a window closing mid-checkout changes nothing.
 */
export function resolveQuote(args: QuoteArgs): Quote {
  const { event, floorPlan, tableId, rate, settings } = args;
  const now = args.now ?? new Date();
  const table = floorPlan.tables.find((t) => t.id === tableId);
  if (!table)
    throw new HttpError(404, 'table_not_found', `Table ${tableId} is not on the floor plan`);
  const dates = [...new Set(args.dates)].sort();
  const eventDates = new Set(event.days.map((d) => d.date));
  for (const d of dates) {
    if (!eventDates.has(d)) throw new HttpError(400, 'bad_date', `${d} is not a day of this event`);
  }
  if (!dates.length) throw new HttpError(400, 'bad_date', 'Pick at least one day');

  const win = activeWindow(args.priceWindows ?? [], now);
  let unit = win
    ? rate === 'poke_bucks'
      ? win.pokeBucksRateCents
      : win.tableRateCents
    : rate === 'poke_bucks'
      ? event.pokeBucksRateCents
      : event.tableRateCents;
  if (table.priceOverrideCents !== undefined) unit = table.priceOverrideCents;
  else if (table.premiumDeltaCents !== undefined) unit += table.premiumDeltaCents;
  unit = Math.max(0, unit);

  const amount = unit * dates.length;
  const fee = Math.round((amount * settings.processingFeePct) / 100);
  const tax = Math.round((amount * settings.taxPct) / 100);
  return {
    tableId,
    dates,
    rate,
    unitCents: unit,
    amountCents: amount,
    feeCents: fee,
    taxCents: tax,
    totalCents: amount + fee + tax,
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

export const dollars = (cents: number): string => (cents / 100).toFixed(2);
