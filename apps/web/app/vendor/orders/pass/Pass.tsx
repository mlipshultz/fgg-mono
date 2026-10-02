'use client';

import { useEffect, useState } from 'react';
import type { VendorOrder } from '@fgg/types';
import { Button } from '@/components/Button';
import { PassCard } from '@/components/vendor/PassCard';
import { getVendorOrder } from '@/lib/api';
import styles from '@/app/vendor/orders/done/done.module.css';

export function Pass() {
  const [order, setOrder] = useState<VendorOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) {
      setError('No pass selected.');
      return;
    }
    getVendorOrder(id)
      .then(setOrder)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the pass'));
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {error && <p className={styles.lead}>{error}</p>}
        {order && (
          <>
            <h1 className={styles.title}>{order.event.name}</h1>
            <PassCard order={order} large />
            <div className={styles.qr} aria-label="QR code placeholder">
              QR
            </div>
            <p className={`${styles.lead} ${styles.noPrint}`}>
              Show this at vendor load-in. Staff scanning arrives with the mobile app.
            </p>
            <div className={`${styles.actions} ${styles.noPrint}`}>
              <Button type="button" variant="yellow" size="md" onClick={() => window.print()}>
                Print
              </Button>
              <Button href="/vendor" variant="outline" size="md">
                Back to dashboard
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
