import { useEffect, useState } from 'react';
import type { EventFloorPlan } from '@fgg/types';
import { countdown } from '@/lib/booking';

/** sessionStorage key for the hold a vendor can resume after a reload. */
export const HOLD_KEY = 'fgg.hold';

export function useCountdown(expiresAt: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return expiresAt ? countdown(expiresAt, now) : null;
}

/**
 * Coming Back from Shopify checkout, the browser can restore this page exactly as it was left,
 * with the button still saying "Opening checkout…". Run `onReturn` then to make it usable again.
 */
export function useReturnFromCheckout(onReturn: () => void) {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) onReturn();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
}

/** The booking terms from Settings that the booking pages spell out. */
export type Terms = NonNullable<EventFloorPlan['terms']>;
export const DEFAULT_TERMS: Terms = {
  holdMinutes: 10,
  checkoutHoldMinutes: 10,
  refundCutoffDays: 14,
};

/** "1 minute" / "10 minutes" */
export const minutes = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;

/** The note under Continue on the first step. */
export const holdNote = (t: Terms) =>
  `Your tables are held for ${minutes(t.holdMinutes)} once you continue, and ${minutes(t.checkoutHoldMinutes)} more when you open checkout.`;
