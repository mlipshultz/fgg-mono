import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Order } from '@fgg/types';
import {
  OrderChangedError,
  TableTakenError,
  closeOrder,
  finalizePaidOrder,
  history,
  recordPartialRefund,
  refundInFlight,
  tablesLabel,
} from '../lib/booking.js';
import { getEvent, getOrder, getOrderByShopifyId, updateVendor } from '../lib/db.js';
import { Router, type Req, type Res } from '../lib/http.js';
import { loadShopifyConfig } from '../lib/shopify-secret.js';
import { shopify } from '../lib/shopify.js';

/** Shopify signs webhook bodies with the app's client secret: base64(HMAC-SHA256(raw body)). */
export function verifyWebhook(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header, 'base64');
  } catch {
    return false;
  }
  return given.length === digest.length && timingSafeEqual(given, digest);
}

function rawBody(req: Req): Buffer {
  const b = req.body ?? '';
  return req.isBase64Encoded ? Buffer.from(b, 'base64') : Buffer.from(b, 'utf8');
}

function header(req: Req, name: string): string | undefined {
  const h = req.headers ?? {};
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

const ok = (body: unknown = { ok: true }): Res => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

interface PaidPayload {
  id: number | string;
  name?: string;
  email?: string;
  financial_status?: string;
  /** What the buyer paid, as a decimal string ("200.00"). */
  total_price?: string;
  note_attributes?: { name: string; value: string }[];
}

interface RefundPayload {
  id: number | string;
  order_id: number | string;
  note?: string;
}

function attr(p: PaidPayload, name: string): string | undefined {
  return p.note_attributes?.find((a) => a.name === name)?.value;
}

/** "200.00" → 20000; undefined when missing or not a number. */
function cents(amount: string | undefined): number | undefined {
  const n = Number(amount);
  return amount !== undefined && amount !== '' && Number.isFinite(n)
    ? Math.round(n * 100)
    : undefined;
}

async function findPaidOrder(p: PaidPayload, shopifyOrderId: string): Promise<Order | undefined> {
  const orderId = attr(p, 'orderId');
  return (
    (orderId ? await getOrder(orderId) : undefined) ?? (await getOrderByShopifyId(shopifyOrderId))
  );
}

/**
 * orders/paid. Decided from the order's current status; if the order changes while we act (a
 * duplicate delivery, the sweep, staff), it is read again and decided once more.
 */
async function onOrdersPaid(p: PaidPayload): Promise<Res> {
  const shopifyOrderId = String(p.id);
  for (let pass = 1; ; pass++) {
    const order = await findPaidOrder(p, shopifyOrderId);
    if (!order) {
      console.warn(
        `orders/paid: no FGG order for Shopify order ${shopifyOrderId}`,
        p.note_attributes,
      );
      return ok({ ok: true, ignored: 'unknown_order' });
    }
    try {
      return await settlePayment(order, p, shopifyOrderId);
    } catch (e) {
      if (!(e instanceof OrderChangedError) || pass >= 3) throw e;
    }
  }
}

async function settlePayment(order: Order, p: PaidPayload, shopifyOrderId: string): Promise<Res> {
  if (
    (order.status === 'paid' || order.status === 'conflict' || order.status === 'refunded') &&
    order.shopifyOrderId === shopifyOrderId
  )
    return ok({ ok: true, idempotent: true });
  // An unpaid checkout, or one we gave up on (hold lapsed, vendor walked away) whose invoice
  // was paid anyway. Anything else (already paid by another order, refunded, conflict) is left
  // for staff.
  const late = order.status === 'cancelled' && !order.paidAt;
  if (order.status !== 'pending_payment' && !late) {
    console.error(
      `orders/paid: FGG order ${order.id} is ${order.status}; Shopify order ${shopifyOrderId} needs a look from staff`,
    );
    return ok({ ok: true, ignored: order.status });
  }
  // The order id travels as a note attribute, which a shopper can set on any cart. Only a
  // payment that covers the order books it.
  const paidCents = cents(p.total_price);
  if (paidCents === undefined || paidCents < order.totalCents) {
    console.error(
      `PAYMENT MISMATCH: Shopify order ${shopifyOrderId} paid ${p.total_price ?? 'nothing'} for FGG order ${order.id} (total ${order.totalCents} cents); not booking it`,
    );
    await history(
      order.id,
      order.status,
      'shopify',
      order.status,
      `payment mismatch: Shopify order ${p.name ?? shopifyOrderId} paid ${p.total_price ?? 'nothing'}; not booked`,
    );
    return ok({ ok: true, ignored: 'amount_mismatch' });
  }
  const event = await getEvent(order.eventId);
  if (!event) throw new Error(`event ${order.eventId} missing for order ${order.id}`);
  try {
    const paid = await finalizePaidOrder({
      order,
      event,
      startsAt: event.startsAt,
      shopifyOrderId,
      ...(p.name ? { shopifyOrderName: p.name } : {}),
      by: 'shopify',
    });
    const line = paid.lines[0];
    if (line && line.type !== 'ticket' && line.rate === 'poke_bucks') {
      await updateVendor(paid.ownerId, { pokeBucksPartner: true });
    }
    if (late) console.info(`order ${order.id} paid after its checkout lapsed; tables were free`);
    return ok({
      ok: true,
      orderId: paid.id,
      passNumber: paid.passNumber,
      ...(late ? { late: true } : {}),
    });
  } catch (e) {
    if (!(e instanceof TableTakenError)) throw e;
    console.error(
      `CONFLICT: order ${order.id} paid but table taken; refunding Shopify order ${shopifyOrderId}`,
    );
    const conflicted = await closeOrder(
      { ...order, shopifyOrderId },
      event,
      event.startsAt,
      'conflict',
      'system',
      'table taken before payment landed; refunded',
    );
    try {
      await shopify().refundOrder(
        shopifyOrderId,
        paidCents,
        `FGG: ${order.lines[0]?.type === 'table' ? `table ${order.lines[0].tableId} was` : `${tablesLabel(order)} were`} no longer available`,
      );
    } catch (err) {
      console.error(
        `REFUND FAILED: automatic refund of Shopify order ${shopifyOrderId} failed; staff must refund it`,
        err,
      );
      await history(
        order.id,
        'conflict',
        'system',
        'conflict',
        `automatic refund failed (${err instanceof Error ? err.message : String(err)}); refund it in Shopify`,
      );
    }
    return ok({ ok: true, orderId: conflicted.id, conflict: true });
  }
}

/**
 * refunds/create. Shopify's running refund total decides: all of the order's total back frees
 * its tables (a full refund made in Shopify admin counts too); less than that is recorded on the
 * order and the booking stays. While staff are refunding from our admin, Shopify is asked to
 * retry, so the admin's own write lands first.
 */
async function onRefundsCreate(p: RefundPayload): Promise<Res> {
  const shopifyOrderId = String(p.order_id);
  for (let pass = 1; ; pass++) {
    const order = await getOrderByShopifyId(shopifyOrderId);
    if (!order) {
      console.warn(`refunds/create: no FGG order for Shopify order ${shopifyOrderId}`);
      return ok({ ok: true, ignored: 'unknown_order' });
    }
    if (order.status === 'refunded') return ok({ ok: true, idempotent: true });
    if (order.status !== 'paid' && order.status !== 'conflict')
      return ok({ ok: true, ignored: order.status });
    if (refundInFlight(order)) {
      return {
        statusCode: 409,
        headers: { 'content-type': 'application/json' },
        body: '{"error":"refund_in_progress"}',
      };
    }
    const so = await shopify().getOrder(shopifyOrderId);
    if (!so) throw new Error(`Shopify order ${shopifyOrderId} not found`);
    const event = await getEvent(order.eventId);
    if (!event) throw new Error(`event ${order.eventId} missing`);
    try {
      if (so.totalRefundedCents >= order.totalCents) {
        // All of it back: drop any earlier partial figure, refundedCents means "less than all".
        const { refundedCents: _partial, ...whole } = order;
        await closeOrder(whole, event, event.startsAt, 'refunded', 'shopify', p.note);
        return ok({ ok: true, orderId: order.id });
      }
      await recordPartialRefund(order, so.totalRefundedCents, 'shopify', p.note);
      return ok({ ok: true, orderId: order.id, partialRefundCents: so.totalRefundedCents });
    } catch (e) {
      if (!(e instanceof OrderChangedError) || pass >= 3) throw e;
    }
  }
}

const router = new Router().add('POST', '/webhooks/shopify', async (req) => {
  const cfg = await loadShopifyConfig();
  const body = rawBody(req);
  if (!verifyWebhook(body, header(req, 'x-shopify-hmac-sha256'), cfg.clientSecret)) {
    return {
      statusCode: 401,
      headers: { 'content-type': 'application/json' },
      body: '{"error":"bad_signature"}',
    };
  }
  const topic = header(req, 'x-shopify-topic') ?? '';
  const payload = JSON.parse(body.toString('utf8') || '{}') as unknown;
  switch (topic) {
    case 'orders/paid':
      return onOrdersPaid(payload as PaidPayload);
    case 'refunds/create':
      return onRefundsCreate(payload as RefundPayload);
    default:
      console.info(`webhook ${topic} ignored`);
      return ok({ ok: true, ignored: topic });
  }
});

export const handler = (req: Req) => router.handle(req);
