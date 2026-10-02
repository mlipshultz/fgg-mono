import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type {
  Event,
  HeldTable,
  Order,
  OrderHistoryEntry,
  OrderStatus,
  PublicEvent,
  Quote,
  TableHold,
  Venue,
  VendorInfo,
  VendorOrder,
} from '@fgg/types';
import {
  TABLE,
  TransactWriteCommand,
  ddb,
  deleteItem,
  getHoldItems,
  keys,
  listHolds,
  listVendorHolds,
  putItem,
  putOrderHistory,
  type HoldItem,
} from './db.js';
import { fmtTime, toPublicEvent } from './events.js';
import { HttpError } from './http.js';

export const isConditionalFailure = (e: unknown): boolean => {
  const name = (e as { name?: string }).name ?? '';
  return name === 'ConditionalCheckFailedException' || name === 'TransactionCanceledException';
};

const nowIso = () => new Date().toISOString();
const epoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

export function isExpired(h: Pick<HoldItem, 'expiresAt'>, now = new Date()): boolean {
  return new Date(h.expiresAt).getTime() < now.getTime();
}

/** "HF26" from "Halloween Fest" + "2026-10-24". */
export function eventCode(ev: Pick<Event, 'name' | 'days'>): string {
  const initials = ev.name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, '')[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 4);
  const year = ([...ev.days].map((d) => d.date).sort()[0] ?? '').slice(2, 4);
  return `${initials || 'FGG'}${year}`;
}

// ---------------------------------------------------------------------------
// Holds
// ---------------------------------------------------------------------------

export interface CreateHoldArgs {
  event: Event;
  vendorId: string;
  heldBy: string;
  quote: Quote;
  holdMinutes: number;
  now?: Date;
}

/** One entry per table (items are per table-day), in table order. */
export function heldTables(items: HoldItem[]): HeldTable[] {
  const byTable = new Map<string, HoldItem>();
  for (const it of items) if (!byTable.has(it.tableId)) byTable.set(it.tableId, it);
  return [...byTable.values()]
    .sort((a, b) => a.tableId.localeCompare(b.tableId, 'en', { numeric: true }))
    .map((h) => ({
      tableId: h.tableId,
      dates: [...h.dates].sort(),
      unitCents: h.unitCents,
      amountCents: h.amountCents,
      pricingInputs: h.pricingInputs as HeldTable['pricingInputs'],
    }));
}

/** Hold items → the public TableHold shape. */
export function toTableHold(items: HoldItem[]): TableHold {
  const h = items[0]!;
  return {
    id: h.holdId,
    eventId: h.eventId,
    vendorId: h.vendorId,
    heldBy: h.heldBy,
    rate: h.rate,
    tables: heldTables(items),
    subtotalCents: h.subtotalCents,
    expiresAt: h.expiresAt,
    createdAt: h.createdAt,
  };
}

/** Rebuild the stored quote (prices, fee, tax and total travel with the hold). */
export function quoteFromHold(
  items: HoldItem[],
  describe: (tableId: string) => { rowLabel: string; nearby: string },
): Quote {
  const h = items[0]!;
  return {
    rate: h.rate,
    lines: heldTables(items).map((t) => ({
      tableId: t.tableId,
      dates: t.dates,
      unitCents: t.unitCents,
      lineCents: t.amountCents,
      pricingInputs: t.pricingInputs,
      ...describe(t.tableId),
    })),
    subtotalCents: h.subtotalCents,
    feeCents: h.feeCents,
    taxCents: h.taxCents,
    totalCents: h.totalCents,
  };
}

/**
 * Race-safe hold (docs/PLAN.md §3.4): one HOLD item per table-day, all-or-nothing, each
 * conditioned on no live hold and no booked table for that day. Expired holds are removed first
 * so a stale item (TTL lags) never blocks a real vendor. The whole cart succeeds or fails.
 */
export async function createHold(args: CreateHoldArgs): Promise<HoldItem[]> {
  const now = args.now ?? new Date();
  const { event, quote } = args;
  // One active hold per vendor per event: release the previous one.
  for (const prev of await listVendorHolds(args.vendorId, event.id)) {
    await deleteItem({ PK: prev.PK, SK: prev.SK });
  }
  // Clear expired holds on the requested table-days (best effort).
  const wanted = new Set(quote.lines.flatMap((l) => l.dates.map((d) => `${l.tableId}#${d}`)));
  const stale = (await listHolds(event.id)).filter(
    (h) => wanted.has(`${h.tableId}#${h.date}`) && isExpired(h, now),
  );
  for (const s of stale) await deleteItem({ PK: s.PK, SK: s.SK });

  const holdId = ulid();
  const expiresAt = new Date(now.getTime() + args.holdMinutes * 60_000).toISOString();
  const items: HoldItem[] = quote.lines.flatMap((line) =>
    line.dates.map((date) => ({
      ...keys.hold(event.id, date, line.tableId),
      GSI1PK: `VENDOR#${args.vendorId}`,
      GSI1SK: `HOLD#${holdId}`,
      holdId,
      eventId: event.id,
      vendorId: args.vendorId,
      heldBy: args.heldBy,
      tableId: line.tableId,
      date,
      dates: line.dates,
      rate: quote.rate,
      unitCents: line.unitCents,
      amountCents: line.lineCents,
      pricingInputs: line.pricingInputs,
      subtotalCents: quote.subtotalCents,
      feeCents: quote.feeCents,
      taxCents: quote.taxCents,
      totalCents: quote.totalCents,
      expiresAt,
      ttl: epoch(expiresAt),
      createdAt: now.toISOString(),
    })),
  );
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: items.flatMap((it) => [
          {
            Put: { TableName: TABLE, Item: it, ConditionExpression: 'attribute_not_exists(PK)' },
          },
          {
            ConditionCheck: {
              TableName: TABLE,
              Key: keys.bookedTable(event.id, it.date, it.tableId),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ]),
      }),
    );
  } catch (e) {
    if (isConditionalFailure(e)) {
      const ids = quote.lines.map((l) => l.tableId);
      throw new HttpError(
        409,
        'table_unavailable',
        ids.length === 1
          ? `Table ${ids[0]} is no longer available on one of those days`
          : `One of ${ids.join(', ')} is no longer available on a selected day`,
      );
    }
    throw e;
  }
  return items;
}

export async function loadHold(vendorId: string, holdId: string): Promise<HoldItem[]> {
  const items = await getHoldItems(vendorId, holdId);
  if (!items.length) throw new HttpError(404, 'hold_not_found', 'Hold not found');
  if (isExpired(items[0]!))
    throw new HttpError(410, 'hold_expired', 'Your hold expired. Pick the table again.');
  return items;
}

export async function releaseHold(items: HoldItem[]): Promise<void> {
  for (const it of items) await deleteItem({ PK: it.PK, SK: it.SK });
}

/** Patch every day-item of a hold (vendorInfo, expiry). */
export async function updateHoldItems(
  items: HoldItem[],
  patch: { vendorInfo?: VendorInfo; expiresAt?: string },
): Promise<HoldItem[]> {
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  if (patch.vendorInfo) {
    sets.push('#vi = :vi');
    names['#vi'] = 'vendorInfo';
    values[':vi'] = patch.vendorInfo;
  }
  if (patch.expiresAt) {
    sets.push('#ex = :ex', '#ttl = :ttl');
    names['#ex'] = 'expiresAt';
    names['#ttl'] = 'ttl';
    values[':ex'] = patch.expiresAt;
    values[':ttl'] = epoch(patch.expiresAt);
  }
  if (!sets.length) return items;
  for (const it of items) {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: it.PK, SK: it.SK },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }
  return items.map((it) => ({
    ...it,
    ...(patch.vendorInfo ? { vendorInfo: patch.vendorInfo } : {}),
    ...(patch.expiresAt ? { expiresAt: patch.expiresAt, ttl: epoch(patch.expiresAt) } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function writeOrder(order: Order, startsAt: string): Promise<void> {
  await putItem({ ...keys.orderIndex(order, startsAt), ...order });
  await putItem({
    ...keys.eventOrder(order.eventId, order.id),
    orderId: order.id,
    status: order.status,
    ownerId: order.ownerId,
    createdAt: order.createdAt,
  });
}

export async function history(
  orderId: string,
  to: OrderStatus,
  by: OrderHistoryEntry['by'],
  from?: OrderStatus,
  note?: string,
): Promise<void> {
  await putOrderHistory({
    orderId,
    at: nowIso(),
    to,
    by,
    ...(from ? { from } : {}),
    ...(note ? { note } : {}),
  });
}

/** Next sequential pass number for an event: "HF26-017". */
export async function nextPassNumber(ev: Event): Promise<string> {
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: keys.counter(ev.id),
      UpdateExpression: 'ADD passSeq :one',
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  const seq = Number(res.Attributes?.passSeq ?? 1);
  return `${eventCode(ev)}-${String(seq).padStart(3, '0')}`;
}

/** Every table line on an order (a vendor can book several tables at once). */
export function tableLines(order: Order): { tableId: string; dates: string[] }[] {
  return order.lines.flatMap((l) =>
    l.type === 'table' ? [{ tableId: l.tableId, dates: l.dates }] : [],
  );
}

/** "B7" or "B7, B8" */
export function tablesLabel(order: Order): string {
  return tableLines(order)
    .map((l) => l.tableId)
    .join(', ');
}

/** Union of every booked day, sorted. */
export function orderDates(order: Order): string[] {
  return [...new Set(tableLines(order).flatMap((l) => l.dates))].sort();
}

export interface PaidArgs {
  order: Order;
  event: Event;
  startsAt: string;
  shopifyOrderId?: string;
  shopifyOrderName?: string;
  by: OrderHistoryEntry['by'];
}

/**
 * Take the table days for a paid (or comped) order: write TABLE# rows conditioned on no owner,
 * delete the hold rows, and mark the order paid with a pass number. Throws `TableTakenError`
 * when another vendor owns one of the days (caller refunds).
 */
export class TableTakenError extends Error {}

export async function finalizePaidOrder(args: PaidArgs): Promise<Order> {
  const { order, event } = args;
  const lines = tableLines(order);
  if (!lines.length) throw new Error(`order ${order.id} has no table line`);
  const paidAt = nowIso();
  const passNumber = order.passNumber ?? (await nextPassNumber(event));
  const paid: Order = {
    ...order,
    status: 'paid',
    paidAt,
    passNumber,
    ...(args.shopifyOrderId ? { shopifyOrderId: args.shopifyOrderId } : {}),
    updatedAt: paidAt,
  };
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          ...lines.flatMap((line) =>
            line.dates.map((date) => ({
              Put: {
                TableName: TABLE,
                Item: {
                  ...keys.bookedTable(event.id, date, line.tableId),
                  tableId: line.tableId,
                  date,
                  orderId: order.id,
                  vendorId: order.ownerId,
                  bookedAt: paidAt,
                },
                ConditionExpression: 'attribute_not_exists(PK) OR orderId = :oid',
                ExpressionAttributeValues: { ':oid': order.id },
              },
            })),
          ),
          ...lines.flatMap((line) =>
            line.dates.map((date) => ({
              Delete: { TableName: TABLE, Key: keys.hold(event.id, date, line.tableId) },
            })),
          ),
          { Put: { TableName: TABLE, Item: { ...keys.orderIndex(paid, args.startsAt), ...paid } } },
          {
            Put: {
              TableName: TABLE,
              Item: {
                ...keys.eventOrder(event.id, order.id),
                orderId: order.id,
                status: 'paid',
                ownerId: order.ownerId,
                createdAt: order.createdAt,
              },
            },
          },
          ...(args.shopifyOrderId
            ? [
                {
                  Put: {
                    TableName: TABLE,
                    Item: { ...keys.shopifyOrder(args.shopifyOrderId), orderId: order.id },
                  },
                },
              ]
            : []),
        ],
      }),
    );
  } catch (e) {
    if (isConditionalFailure(e))
      throw new TableTakenError(`one of ${tablesLabel(order)} is already booked`);
    throw e;
  }
  await history(order.id, 'paid', args.by, order.status, args.shopifyOrderName);
  return paid;
}

/** Move an order to a terminal status and free its table days. */
export async function closeOrder(
  order: Order,
  event: Event,
  startsAt: string,
  status: Extract<OrderStatus, 'refunded' | 'cancelled' | 'conflict'>,
  by: OrderHistoryEntry['by'],
  note?: string,
): Promise<Order> {
  const lines = tableLines(order);
  const at = nowIso();
  const next: Order = {
    ...order,
    status,
    updatedAt: at,
    ...(status === 'refunded' ? { refundedAt: at } : {}),
  };
  const frees =
    order.status === 'paid'
      ? lines.flatMap((line) =>
          line.dates.map((date) => ({
            Delete: {
              TableName: TABLE,
              Key: keys.bookedTable(event.id, date, line.tableId),
              ConditionExpression: 'attribute_not_exists(PK) OR orderId = :oid',
              ExpressionAttributeValues: { ':oid': order.id },
            },
          })),
        )
      : [];
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        ...frees,
        { Put: { TableName: TABLE, Item: { ...keys.orderIndex(next, startsAt), ...next } } },
        {
          Put: {
            TableName: TABLE,
            Item: {
              ...keys.eventOrder(event.id, order.id),
              orderId: order.id,
              status,
              ownerId: order.ownerId,
              createdAt: order.createdAt,
            },
          },
        },
      ],
    }),
  );
  await history(order.id, status, by, order.status, note);
  return next;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat Oct 24" */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]} ${MON[m - 1]} ${d}`;
}

export function loadInLabel(ev: Event, dates: string[]): string | undefined {
  const first = [...dates].sort()[0];
  const day = ev.days.find((d) => d.date === first);
  if (!day) return undefined;
  const t = day.vendorLoadIn ?? day.opens;
  return `${shortDate(day.date)} · ${fmtTime(t)}`;
}

export function toVendorOrder(order: Order, ev: Event, venue: Venue): VendorOrder {
  const pe: PublicEvent = toPublicEvent(ev, venue);
  const dates = orderDates(order);
  const label = dates.length ? loadInLabel(ev, dates) : undefined;
  return {
    ...order,
    event: {
      id: pe.id,
      slug: pe.slug,
      name: pe.name,
      startDate: pe.startDate,
      endDate: pe.endDate,
      days: pe.days,
      timeZone: pe.timeZone,
      venue: pe.venue,
      ...(pe.posterUrl ? { posterUrl: pe.posterUrl } : {}),
    },
    ...(label ? { loadInLabel: label } : {}),
  };
}
