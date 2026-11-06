import type { Order } from '@fgg/types';
import { OrderChangedError, closeOrder, isExpired } from './booking.js';
import { getEvent, getHoldItems, getOrder } from './db.js';
import { shopify } from './shopify.js';

/** An unpaid Shopify checkout: the only kind of order that can be abandoned. */
export const isUnpaidCheckout = (o: Order) =>
  o.status === 'pending_payment' && o.source === 'shopify';

/** Is the vendor still inside the checkout's hold? Then they may yet pay. */
export async function checkoutIsLive(order: Order): Promise<boolean> {
  if (!order.holdId) return false;
  return (await getHoldItems(order.ownerId, order.holdId)).some((h) => !isExpired(h));
}

/**
 * Cancel a checkout the vendor walked away from. The Shopify draft is deleted so its invoice
 * link stops working; a payment that still gets through is booked by the webhook if the tables
 * are free, refunded if not. Returns the order unchanged if its event is gone.
 *
 * `order` usually comes from an index that lags, and a payment removes the hold that made the
 * checkout look live, so a checkout paid a moment ago can look abandoned. The cancel only
 * applies to an order that is still unpaid; otherwise the order as it now stands comes back.
 */
export async function cancelAbandonedCheckout(order: Order): Promise<Order> {
  const ev = await getEvent(order.eventId);
  if (!ev) return order;
  const current = await getOrder(order.id);
  if (!current || !isUnpaidCheckout(current)) return current ?? order;
  try {
    const closed = await closeOrder(
      current,
      ev,
      ev.startsAt,
      'cancelled',
      'system',
      'checkout abandoned',
    );
    if (current.shopifyDraftOrderId) {
      try {
        await shopify().deleteDraftOrder(current.shopifyDraftOrderId);
      } catch (e) {
        console.warn(`could not delete draft order for abandoned checkout ${current.id}`, e);
      }
    }
    return closed;
  } catch (e) {
    if (!(e instanceof OrderChangedError)) throw e;
    return (await getOrder(order.id)) ?? order;
  }
}
