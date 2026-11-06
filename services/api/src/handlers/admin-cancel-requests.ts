import {
  ApproveCancelInput,
  DeclineCancelInput,
  type CancelRequestList,
  type Event,
  type Order,
} from '@fgg/types';
import { claimsFrom } from '../lib/auth.js';
import {
  OrderChangedError,
  claimRefund,
  closeOrder,
  history,
  releaseRefundClaim,
  toVendorOrder,
  updateOrder,
} from '../lib/booking.js';
import { getEvent, getOrder, getSettings, listOrdersByStatus } from '../lib/db.js';
import { venueFor } from '../lib/events.js';
import { HttpError, json, parseBody, type Router } from '../lib/http.js';
import { require as requireCan } from '../lib/permissions.js';
import { shopify } from '../lib/shopify.js';

/**
 * Give an order's money back (or cancel it, if nothing was paid through Shopify) and free its
 * tables. `amountCents` below the total is a partial refund, recorded as `refundedCents`.
 *
 * The order is claimed before Shopify is asked, so a double click or two staff at once can't
 * refund it twice. Shopify's own refund webhook may land before our write; it waits for the
 * claim, and if it still got there first, that counts as done.
 */
export async function refundOrCancel(
  order: Order,
  ev: Event,
  by: string,
  reason: string | undefined,
  amountCents = order.totalCents,
): Promise<Order> {
  if (amountCents > order.totalCents)
    throw new HttpError(400, 'too_much', 'A refund cannot be more than the order total');
  const patch = amountCents < order.totalCents ? { refundedCents: amountCents } : {};
  if (order.status === 'paid' && order.source === 'shopify' && order.shopifyOrderId) {
    if (!(await claimRefund(order)))
      throw new HttpError(
        409,
        'refund_in_progress',
        'This order is already being refunded, or has changed. Refresh to see it.',
      );
    if (amountCents > 0) {
      try {
        await shopify().refundOrder(
          order.shopifyOrderId,
          amountCents,
          reason ?? 'Refunded by FGG staff',
        );
      } catch (e) {
        await releaseRefundClaim(order);
        throw e;
      }
    }
    return settle(order, () => closeOrder(order, ev, ev.startsAt, 'refunded', by, reason, patch));
  }
  if (order.status === 'paid' || order.status === 'pending_payment')
    return settle(order, () => closeOrder(order, ev, ev.startsAt, 'cancelled', by, reason));
  throw new HttpError(409, 'bad_status', `Order is already ${order.status}`);
}

/** Run a close; if the order changed first, accept it when it already ended up closed. */
async function settle(order: Order, close: () => Promise<Order>): Promise<Order> {
  try {
    return await close();
  } catch (e) {
    if (!(e instanceof OrderChangedError)) throw e;
    const now = await getOrder(order.id);
    if (now && (now.status === 'refunded' || now.status === 'cancelled')) return now;
    throw new HttpError(409, 'order_changed', 'This order just changed. Refresh and try again.');
  }
}

async function view(order: Order) {
  const ev = await getEvent(order.eventId);
  const venue = ev ? await venueFor(ev.venueId) : undefined;
  if (!ev || !venue) throw new HttpError(500, 'event_missing', 'Event missing for order');
  return toVendorOrder(order, ev, venue);
}

/** A paid order with a cancellation waiting, with its event. */
async function pendingRequest(id: string): Promise<{ order: Order; ev: Event }> {
  const order = await getOrder(id);
  if (!order) throw new HttpError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'paid' || !order.cancelRequestedAt)
    throw new HttpError(409, 'no_request', 'This order has no cancellation waiting');
  const ev = await getEvent(order.eventId);
  if (!ev) throw new HttpError(500, 'event_missing', 'Event missing');
  return { order, ev };
}

/** The cancel-request queue: staff see and decline; approving refunds, so it is superadmin. */
export function addCancelRequestRoutes(router: Router): void {
  router
    .add('GET', '/admin/orders/cancel-requests', async (req) => {
      requireCan(claimsFrom(req), 'manage_events');
      const waiting: Order[] = [];
      let cursor: Record<string, unknown> | undefined;
      do {
        const page = await listOrdersByStatus('paid', 100, cursor);
        waiting.push(...page.items.filter((o) => o.cancelRequestedAt));
        cursor = page.lastKey;
      } while (cursor);
      waiting.sort((a, b) => a.cancelRequestedAt!.localeCompare(b.cancelRequestedAt!));
      const body: CancelRequestList = {
        items: await Promise.all(waiting.map(view)),
        refundCutoffDays: (await getSettings()).refundCutoffDays,
      };
      return json(req, body, 200, { 'cache-control': 'no-store' });
    })
    .add('POST', '/admin/orders/{id}/cancel-request/approve', async (req, { id }) => {
      const actor = claimsFrom(req);
      requireCan(actor, 'admin_refunds');
      const input = parseBody(req, ApproveCancelInput);
      const { order, ev } = await pendingRequest(id!);
      const note = input.note?.trim() || 'cancellation approved';
      const next = await refundOrCancel(order, ev, actor.sub, note, input.amountCents);
      return json(req, await view(next));
    })
    .add('POST', '/admin/orders/{id}/cancel-request/decline', async (req, { id }) => {
      const actor = claimsFrom(req);
      requireCan(actor, 'manage_events');
      const input = parseBody(req, DeclineCancelInput);
      const { order, ev } = await pendingRequest(id!);
      const at = new Date().toISOString();
      const { cancelRequestedAt: _r, cancelReason: _c, ...rest } = order;
      const next: Order = {
        ...rest,
        cancelDeclinedAt: at,
        ...(input.note?.trim() ? { cancelDeclineNote: input.note.trim() } : {}),
        updatedAt: at,
      };
      await updateOrder(order, next, ev.startsAt);
      await history(
        order.id,
        order.status,
        actor.sub,
        order.status,
        `cancel declined${input.note ? `: ${input.note}` : ''}`,
      );
      return json(req, await view(next));
    });
}
