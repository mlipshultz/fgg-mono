import type { VendorOrder } from '@fgg/types';
import { daysLabel, fmtCents, orderDates, tableLinesOf, tablesLabel } from '@/lib/booking';
import { dayOfWeek } from '@/lib/dates';
import styles from '@/app/vendor/orders/done/done.module.css';

/** VENDOR PASS card from mock 1l step 4. */
export function PassCard({ order, large = false }: { order: VendorOrder; large?: boolean }) {
  const lines = tableLinesOf(order);
  const tableId = tablesLabel(order) || '—';
  const dates = orderDates(order);
  const many = lines.length > 1;
  const key = (d: string[]) => [...d].sort().join();
  const sameDays = lines.every((l) => key(l.dates) === key(lines[0]?.dates ?? []));
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
          <div className={styles.passLabel}>{many ? 'Tables' : 'Table'}</div>
          {many && !sameDays ? (
            <b>
              {lines.map((l) => (
                <span key={l.tableId} style={{ display: 'block' }}>
                  {l.tableId} · {[...l.dates].sort().map(dayOfWeek).join(' + ')}
                </span>
              ))}
            </b>
          ) : (
            <b>{tableId} · Main Hall</b>
          )}
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
