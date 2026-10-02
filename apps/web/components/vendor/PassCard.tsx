import type { VendorOrder } from '@fgg/types';
import { daysLabel, fmtCents } from '@/lib/booking';
import styles from '@/app/vendor/orders/done/done.module.css';

/** VENDOR PASS card from mock 1l step 4. */
export function PassCard({ order, large = false }: { order: VendorOrder; large?: boolean }) {
  const line = order.lines[0];
  const tableId = line?.type === 'table' ? line.tableId : '—';
  const dates = line?.type === 'table' ? line.dates : [];
  return (
    <div className={`${styles.pass} ${large ? styles.passLarge : ''}`}>
      <div className={styles.passHead}>
        <span>VENDOR PASS</span>
        <span>#{order.passNumber ?? 'PENDING'}</span>
      </div>
      <div className={styles.passGrid}>
        <div>
          <div className={styles.passLabel}>Event</div>
          <b>{order.event.name}</b>
        </div>
        <div>
          <div className={styles.passLabel}>Table</div>
          <b>{tableId} · Main Hall</b>
        </div>
        <div>
          <div className={styles.passLabel}>Days</div>
          <b>{daysLabel(dates)}</b>
        </div>
        <div>
          <div className={styles.passLabel}>Load-in</div>
          <b>{order.loadInLabel ?? 'See email'}</b>
        </div>
        <div>
          <div className={styles.passLabel}>Paid</div>
          <b className={styles.paidAmt}>
            {order.source === 'manual' ? 'Comped' : `${fmtCents(order.totalCents)} · Shopify`}
          </b>
        </div>
        <div>
          <div className={styles.passLabel}>Vendor</div>
          <b>{order.vendorInfo?.tableName ?? '—'}</b>
        </div>
      </div>
    </div>
  );
}
