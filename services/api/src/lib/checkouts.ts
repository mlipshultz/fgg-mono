import type { Order } from '@fgg/types';
import { closeOrder, isExpired } from './booking.js';
import { getEvent, getHoldItems } from './db.js';
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
 * link stops working; a payment that still gets through is refunded by the webhook. Returns
 * the order unchanged if its event is gone.
 */
export async function cancelAbandonedCheckout(order: Order): Promise<Order> {
  const ev = await getEvent(order.eventId);
  if (!ev) return order;
  if (order.shopifyDraftOrderId) {
    try {
      await shopify().deleteDraftOrder(order.shopifyDraftOrderId);
    } catch (e) {
      console.warn(`could not delete draft order for abandoned checkout ${order.id}`, e);
    }
  }
  return closeOrder(order, ev, ev.startsAt, 'cancelled', 'system', 'checkout abandoned');
}
