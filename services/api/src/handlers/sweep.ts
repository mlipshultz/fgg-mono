import type { Order } from '@fgg/types';
import { cancelAbandonedCheckout, checkoutIsLive, isUnpaidCheckout } from '../lib/checkouts.js';
import { listOrdersByStatus } from '../lib/db.js';

/**
 * Scheduled (every 15 minutes): cancel unpaid checkouts whose hold has run out, for vendors
 * who never come back to their dashboard or the booking page (which clean up their own).
 */
export async function handler(): Promise<{ checked: number; cancelled: string[] }> {
  const unpaid: Order[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await listOrdersByStatus('pending_payment', 100, cursor);
    unpaid.push(...page.items.filter(isUnpaidCheckout));
    cursor = page.lastKey;
  } while (cursor);
  const cancelled: string[] = [];
  for (const order of unpaid) {
    if (await checkoutIsLive(order)) continue;
    const next = await cancelAbandonedCheckout(order);
    if (next.status === 'cancelled') cancelled.push(order.id);
  }
  if (cancelled.length) console.info(`swept ${cancelled.length} abandoned checkouts`, cancelled);
  return { checked: unpaid.length, cancelled };
}
