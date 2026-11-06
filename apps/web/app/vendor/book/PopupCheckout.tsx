'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { CheckoutResponse } from '@fgg/types';
import { Button } from '@/components/Button';
import { authStyles as a } from '@/components/auth/AuthCard';
import v from '@/components/vendor/vendor.module.css';
import { getVendorOrder } from '@/lib/api';
import styles from './book.module.css';

/**
 * Shopify checkout in a popup window over the booking page (PLAN §3.5 "Returning from Shopify").
 * Shopify has no way to send a buyer back after paying, so the vendor never leaves: the page
 * watches the order and, the moment the paid webhook lands, closes the window and shows the pass.
 * If the browser won't open a window (blocked, some in-app browsers), checkout opens in this tab
 * as before and the store theme's redirect brings the vendor back.
 *
 * The window is opened blank inside the click (so popup blockers allow it) and pointed at the
 * draft order's invoice once the API answers, through Shopify's Checkout Kit for Web. Checkout
 * Kit marks the visit as a delegated window, and Shopify then leaves off the
 * Cross-Origin-Opener-Policy that otherwise cuts the window off from this page (we could no
 * longer see it close, or close it). Its own completion events don't fire for draft-order
 * checkouts (tested 2026-11-05), so payment is detected from our order instead.
 */

const WINDOW_NAME = 'fgg-checkout';
const POLL_MS = 2500;

function windowFeatures(): string {
  const w = 520;
  const h = Math.min(820, window.screen.availHeight - 40);
  const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - w) / 2));
  const top = Math.round(window.screenY + Math.max(0, (window.outerHeight - h) / 2));
  return `popup,width=${w},height=${h},left=${left},top=${top}`;
}

/** Open (or reuse) the checkout window. Must run inside the click, before any await. */
function openWindow(url = ''): Window | null {
  try {
    const w = window.open(url, WINDOW_NAME, windowFeatures());
    if (!w) return null;
    if (!url) {
      try {
        w.document.title = 'Opening secure checkout…';
        w.document.body.style.cssText = 'font: 600 16px system-ui, sans-serif; padding: 24px;';
        w.document.body.textContent = 'Opening secure checkout…';
      } catch {
        /* not ours to write to; fine */
      }
    }
    return w;
  } catch {
    return null;
  }
}

type CheckoutElement = HTMLElement & { src: string; open(): void; close(): void };

let kitLoad: Promise<void> | undefined;
let kitReady = false;
/** Load Checkout Kit's <shopify-checkout> element once, in the background. */
function loadKit(): Promise<void> {
  kitLoad ??= import('@shopify/checkout-kit/shopify-checkout').then(
    () => {
      kitReady = true;
    },
    () => undefined,
  );
  return kitLoad;
}

let kitEl: CheckoutElement | undefined;
function kitElement(): CheckoutElement {
  if (!kitEl) {
    kitEl = document.createElement('shopify-checkout') as CheckoutElement;
    // Hidden: it would otherwise dim this page with its own overlay; we show our own panel.
    kitEl.style.display = 'none';
    document.body.appendChild(kitEl);
  }
  return kitEl;
}

/**
 * Point the (already open) window at Shopify, through Checkout Kit when it loaded and accepts
 * the link, else directly. Direct still pays fine; this page just can't see the window close.
 */
function sendTo(w: Window, url: string) {
  if (kitReady) {
    const el = kitElement();
    let failed = false;
    const fail = () => {
      failed = true;
    };
    el.addEventListener('error', fail, { once: true });
    el.addEventListener('blocked', fail, { once: true });
    try {
      el.setAttribute('target', WINDOW_NAME);
      el.src = url;
      el.open();
    } catch {
      failed = true;
    }
    el.removeEventListener('error', fail);
    el.removeEventListener('blocked', fail);
    if (!failed) return;
  }
  w.location.href = url;
}

export interface Paying extends CheckoutResponse {
  /** The vendor closed the checkout window (or it never got focus back to us). */
  windowClosed: boolean;
}

export function usePopupCheckout() {
  const win = useRef<Window | null>(null);
  const [paying, setPaying] = useState<Paying | null>(null);

  useEffect(() => {
    void loadKit();
  }, []);

  /** Call first thing in the click handler, before any await, so the browser allows it. */
  const prepare = useCallback(() => {
    win.current = openWindow();
  }, []);

  /** Checkout couldn't start (API error), or the vendor left it: put the window away. */
  const abandon = useCallback(() => {
    try {
      kitEl?.close();
    } catch {
      /* nothing open */
    }
    win.current?.close();
    win.current = null;
  }, []);

  /**
   * The draft order is ready: send the window to it (true), or this tab when there is no window
   * (false; the page is leaving).
   */
  const go = useCallback((res: CheckoutResponse): boolean => {
    sessionStorage.setItem('fgg.order', res.orderId);
    const w = win.current;
    if (!w || w.closed) {
      window.location.href = res.invoiceUrl;
      return false;
    }
    sendTo(w, res.invoiceUrl);
    setPaying({ ...res, windowClosed: false });
    return true;
  }, []);

  /** From a click: bring the checkout back (it was closed, or went behind this window). */
  const reopen = useCallback(() => {
    if (!paying) return;
    const open = win.current && !win.current.closed ? win.current : null;
    if (open) {
      open.focus();
      return;
    }
    const w = openWindow();
    if (!w) {
      window.location.href = paying.invoiceUrl;
      return;
    }
    sendTo(w, paying.invoiceUrl);
    win.current = w;
    setPaying((p) => p && { ...p, windowClosed: false });
  }, [paying]);

  /** Leave the checkout (to change tables). Its order is replaced when they hold again. */
  const cancel = useCallback(() => {
    abandon();
    setPaying(null);
  }, [abandon]);

  // Watch the order until Shopify's paid webhook settles it, then show the result page.
  const orderId = paying?.orderId;
  useEffect(() => {
    if (!orderId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const o = await getVendorOrder(orderId);
        if (!alive) return;
        if (o.status !== 'pending_payment') {
          win.current?.close();
          // Fixture builds gate vendor pages behind ?preview=1; keep it if this page has it.
          const preview = new URLSearchParams(window.location.search).has('preview')
            ? '&preview=1'
            : '';
          window.location.assign(`/vendor/orders/done/?id=${encodeURIComponent(o.id)}${preview}`);
          return;
        }
      } catch {
        /* a blip; keep watching */
      }
      if (!alive) return;
      if (win.current?.closed)
        setPaying((p) => (p && !p.windowClosed ? { ...p, windowClosed: true } : p));
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [orderId]);

  return { paying, prepare, go, abandon, reopen, cancel };
}

/** What the booking page shows while the vendor pays in the Shopify window. */
export function CheckoutWaiting({
  paying,
  countdown,
  holdExpired,
  backLabel,
  onReopen,
  onCancel,
}: {
  paying: Paying;
  countdown: ReactNode;
  holdExpired: boolean;
  backLabel: string;
  onReopen: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={`${a.card} ${a.cardAqua} ${styles.waiting}`}>
      <span className={styles.eyebrow}>Almost there</span>
      <h1 className={styles.stepTitle}>
        {paying.windowClosed ? 'Checkout window closed' : 'Finish paying in the Shopify window'}
      </h1>
      <p className={a.lead}>
        {paying.windowClosed
          ? 'If you already paid, this page updates in a moment. If not, reopen checkout to finish.'
          : 'Your secure checkout opened in a new window. Pay there, and this page shows your vendor pass the moment it goes through.'}
      </p>
      <div className={styles.waitingStatus} role="status">
        <span className={a.spinner} aria-hidden="true" />
        <span>Waiting for your payment…</span>
      </div>
      {countdown}
      {holdExpired && (
        <p className={styles.holdNote}>
          Your hold has run out, but you can still finish paying. If your tables are still free,
          they&apos;re yours; if someone else took them, you get a full refund.
        </p>
      )}
      <Button
        type="button"
        variant={paying.windowClosed ? 'primary' : 'secondary'}
        size="lg"
        block
        onClick={onReopen}
      >
        {paying.windowClosed ? 'Reopen checkout' : 'Show the checkout window'}
      </Button>
      <span className={styles.policy}>
        Don&apos;t see it? It may be behind this window, or your browser may have blocked it.
      </span>
      <div className={v.footerNav}>
        <button type="button" className={v.back} onClick={onCancel}>
          {backLabel}
        </button>
      </div>
    </div>
  );
}
