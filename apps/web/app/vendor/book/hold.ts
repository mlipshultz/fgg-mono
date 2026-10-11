import { useEffect, useState } from 'react';
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
