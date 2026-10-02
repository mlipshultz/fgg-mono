import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Order } from '@fgg/types';
import { TableTakenError, closeOrder, finalizePaidOrder } from '../lib/booking.js';
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

async function onOrdersPaid(p: PaidPayload): Promise<Res> {
  const shopifyOrderId = String(p.id);
  const orderId = attr(p, 'orderId');
  let order: Order | undefined = orderId ? await getOrder(orderId) : undefined;
  if (!order) order = await getOrderByShopifyId(shopifyOrderId);
  if (!order) {
    console.warn(
      `orders/paid: no FGG order for Shopify order ${shopifyOrderId}`,
      p.note_attributes,
    );
    return ok({ ok: true, ignored: 'unknown_order' });
  }
  if (order.status === 'paid' && order.shopifyOrderId === shopifyOrderId)
    return ok({ ok: true, idempotent: true });
  if (order.status !== 'pending_payment') {
    console.warn(`orders/paid: order ${order.id} is ${order.status}; ignoring`);
    return ok({ ok: true, ignored: order.status });
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
    if (line?.type === 'table' && line.rate === 'poke_bucks') {
      await updateVendor(paid.ownerId, { pokeBucksPartner: true });
    }
    return ok({ ok: true, orderId: paid.id, passNumber: paid.passNumber });
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
        order.totalCents,
        `FGG: table ${order.lines[0]?.type === 'table' ? order.lines[0].tableId : ''} was no longer available`,
      );
    } catch (err) {
      console.error('automatic refund failed; staff must refund manually', err);
    }
    return ok({ ok: true, orderId: conflicted.id, conflict: true });
  }
}

async function onRefundsCreate(p: RefundPayload): Promise<Res> {
  const order = await getOrderByShopifyId(String(p.order_id));
  if (!order) {
    console.warn(`refunds/create: no FGG order for Shopify order ${p.order_id}`);
    return ok({ ok: true, ignored: 'unknown_order' });
  }
  if (order.status === 'refunded') return ok({ ok: true, idempotent: true });
  if (order.status !== 'paid' && order.status !== 'conflict')
    return ok({ ok: true, ignored: order.status });
  const event = await getEvent(order.eventId);
  if (!event) throw new Error(`event ${order.eventId} missing`);
  await closeOrder(order, event, event.startsAt, 'refunded', 'shopify', p.note);
  return ok({ ok: true, orderId: order.id });
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
