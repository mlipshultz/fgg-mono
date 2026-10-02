'use client';

import { useEffect, useState } from 'react';
import type { VendorOrder } from '@fgg/types';
import { Button } from '@/components/Button';
import { PassCard } from '@/components/vendor/PassCard';
import { downloadVendorFile, getVendorOrder } from '@/lib/api';
import { tableDaysSummary, tableLinesOf, tablesLabel } from '@/lib/booking';
import styles from './done.module.css';

const MAX_WAIT_MS = 2 * 60_000;

export function Done() {
  const [order, setOrder] = useState<VendorOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const id =
      new URLSearchParams(window.location.search).get('id') ?? sessionStorage.getItem('fgg.order');
    if (!id) {
      setError('We could not find that order.');
      return;
    }
    let alive = true;
    const started = Date.now();
    const tick = async () => {
      try {
        const o = await getVendorOrder(id);
        if (!alive) return;
        setOrder(o);
        if (o.status === 'pending_payment') {
          if (Date.now() - started > MAX_WAIT_MS) setTimedOut(true);
          else setTimeout(tick, 3000);
        } else {
          sessionStorage.removeItem('fgg.hold');
          sessionStorage.removeItem('fgg.order');
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load the order');
      }
    };
    void tick();
    return () => {
      alive = false;
    };
  }, []);

  const download = (kind: 'pass.ics' | 'receipt.pdf') => {
    if (!order) return;
    const base = `${order.event.slug}-table-${tablesLabel(order).replace(/, /g, '-') || 'pass'}`;
    void downloadVendorFile(
      order.id,
      kind,
      kind === 'pass.ics' ? `${base}.ics` : `${base}-receipt.pdf`,
    ).catch(() => {});
  };

  if (error) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Hmm</h1>
          <p className={styles.lead}>{error}</p>
          <Button href="/vendor" variant="yellow" size="md">
            Go to my vendor dashboard
          </Button>
        </div>
      </main>
    );
  }

  if (!order || (order.status === 'pending_payment' && !timedOut)) {
    return (
      <main className={styles.page}>
        <div className={styles.card} aria-busy="true">
          <span className={styles.spinner} aria-hidden="true" />
          <h1 className={styles.title}>Confirming your payment…</h1>
          <p className={styles.lead}>
            Shopify is telling us it went through. This usually takes a few seconds.
          </p>
        </div>
      </main>
    );
  }

  if (order.status === 'pending_payment') {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Still waiting on Shopify</h1>
          <p className={styles.lead}>
            Your payment may still be processing. We&apos;ll email <b>{order.vendorInfo?.email}</b>{' '}
            the moment it lands, and the booking will show on your dashboard.
          </p>
          <Button href="/vendor" variant="dark" size="md">
            Go to my vendor dashboard →
          </Button>
        </div>
      </main>
    );
  }

  if (order.status === 'conflict') {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>That table slipped away</h1>
          <p className={styles.lead}>
            Your hold ran out before the payment landed and another vendor took the table. A full
            refund is already on its way to your card. Sorry about that; grab another spot now.
          </p>
          <Button href={`/vendor/book?event=${order.event.slug}`} variant="primary" size="md">
            Pick another table
          </Button>
        </div>
      </main>
    );
  }

  if (order.status !== 'paid') {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>This booking is {order.status}</h1>
          <Button href="/vendor" variant="dark" size="md">
            Go to my vendor dashboard →
          </Button>
        </div>
      </main>
    );
  }

  const tables = tablesLabel(order);
  const many = tableLinesOf(order).length > 1;
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.check} aria-hidden="true">
          ✓
        </div>
        <div>
          <h1 className={styles.title}>You&apos;re booked!</h1>
          <p className={styles.lead}>
            {many ? 'Tables' : 'Table'}{' '}
            {many
              ? tableDaysSummary(
                  order,
                  order.event.days.map((d) => d.date),
                )
              : tables}{' '}
            at {order.event.name} {many ? 'are' : 'is'} yours. Receipt sent to{' '}
            <b>{order.vendorInfo?.email}</b>.
          </p>
        </div>
        <PassCard order={order} />
        <div className={styles.actions}>
          <Button type="button" variant="secondary" size="md" onClick={() => download('pass.ics')}>
            Add to calendar
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => download('receipt.pdf')}
          >
            Download receipt
          </Button>
        </div>
        <Button href="/vendor" variant="dark" size="lg" block>
          Go to my vendor dashboard →
        </Button>
        <span className={styles.upsell}>
          Want the $100 rate next time? Join the PokéBucks program from your dashboard.
        </span>
      </div>
    </main>
  );
}
