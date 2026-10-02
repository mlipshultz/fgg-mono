import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type {
  Event,
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

/** Hold items → the public TableHold shape. */
export function toTableHold(items: HoldItem[]): TableHold {
  const h = items[0]!;
  return {
    id: h.holdId,
    eventId: h.eventId,
    vendorId: h.vendorId,
    heldBy: h.heldBy,
    tableId: h.tableId,
    dates: [...h.dates].sort(),
    rate: h.rate,
    unitCents: h.unitCents,
    amountCents: h.amountCents,
    pricingInputs: h.pricingInputs as TableHold['pricingInputs'],
    expiresAt: h.expiresAt,
    createdAt: h.createdAt,
  };
}

/** Rebuild the stored quote (fee/tax/total travel with the hold). */
export function quoteFromHold(items: HoldItem[], rowLabel: string, nearby: string): Quote {
  const h = items[0]!;
  return {
    tableId: h.tableId,
    dates: [...h.dates].sort(),
    rate: h.rate,
    unitCents: h.unitCents,
    amountCents: h.amountCents,
    feeCents: h.feeCents,
    taxCents: h.taxCents,
    totalCents: h.totalCents,
    pricingInputs: h.pricingInputs as Quote['pricingInputs'],
    rowLabel,
    nearby,
  };
}

/**
 * Race-safe hold (docs/PLAN.md §3.4): one HOLD item per day, all-or-nothing, each conditioned
 * on no live hold and no booked table for that day. Expired holds are removed first so a stale
 * item (TTL lags) never blocks a real vendor.
 */
export async function createHold(args: CreateHoldArgs): Promise<HoldItem[]> {
  const now = args.now ?? new Date();
  const { event, quote } = args;
  // One active hold per vendor per event: release the previous one.
  for (const prev of await listVendorHolds(args.vendorId, event.id)) {
    await deleteItem({ PK: prev.PK, SK: prev.SK });
  }
  // Clear expired holds on the requested table/days (best effort).
  const stale = (await listHolds(event.id)).filter(
    (h) => h.tableId === quote.tableId && quote.dates.includes(h.date) && isExpired(h, now),
  );
  for (const s of stale) await deleteItem({ PK: s.PK, SK: s.SK });

  const holdId = ulid();
  const expiresAt = new Date(now.getTime() + args.holdMinutes * 60_000).toISOString();
  const items: HoldItem[] = quote.dates.map((date) => ({
    ...keys.hold(event.id, date, quote.tableId),
    GSI1PK: `VENDOR#${args.vendorId}`,
    GSI1SK: `HOLD#${holdId}`,
    holdId,
    eventId: event.id,
    vendorId: args.vendorId,
    heldBy: args.heldBy,
    tableId: quote.tableId,
    date,
    dates: quote.dates,
    rate: quote.rate,
    unitCents: quote.unitCents,
    amountCents: quote.amountCents,
    feeCents: quote.feeCents,
    taxCents: quote.taxCents,
    totalCents: quote.totalCents,
    pricingInputs: quote.pricingInputs,
    expiresAt,
    ttl: epoch(expiresAt),
    createdAt: now.toISOString(),
  }));
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
      throw new HttpError(
        409,
        'table_unavailable',
        `Table ${quote.tableId} is no longer available on one of those days`,
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

function tableLine(order: Order): { tableId: string; dates: string[] } | undefined {
  const line = order.lines.find((l) => l.type === 'table');
  return line && line.type === 'table' ? { tableId: line.tableId, dates: line.dates } : undefined;
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
  const line = tableLine(order);
  if (!line) throw new Error(`order ${order.id} has no table line`);
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
          ...line.dates.map((date) => ({
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
          ...line.dates.map((date) => ({
            Delete: { TableName: TABLE, Key: keys.hold(event.id, date, line.tableId) },
          })),
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
    if (isConditionalFailure(e)) throw new TableTakenError(`table ${line.tableId} already booked`);
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
  const line = tableLine(order);
  const at = nowIso();
  const next: Order = {
    ...order,
    status,
    updatedAt: at,
    ...(status === 'refunded' ? { refundedAt: at } : {}),
  };
  const frees =
    line && order.status === 'paid'
      ? line.dates.map((date) => ({
          Delete: {
            TableName: TABLE,
            Key: keys.bookedTable(event.id, date, line.tableId),
            ConditionExpression: 'attribute_not_exists(PK) OR orderId = :oid',
            ExpressionAttributeValues: { ':oid': order.id },
          },
        }))
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
  const line = tableLine(order);
  const label = line ? loadInLabel(ev, line.dates) : undefined;
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
