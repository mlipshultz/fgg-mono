'use client';

import { useEffect, useRef, useState } from 'react';
import type { IsoDate } from '@fgg/types';
import { Button } from '@/components/Button';
import { dayLabel, fmtCents } from '@/lib/booking';
import styles from './book.module.css';

/**
 * "Which days for this table?" Shown as a popover next to the tapped table on desktop and
 * inside the bottom sheet on phones. Days default to what the map is showing; days the table
 * isn't open on are disabled. Confirms with Add to cart (or Update + Remove for a table that
 * is already in the cart).
 */
export function TableConfirm({
  tableId,
  rowLabel,
  eventDays,
  openDays,
  initial,
  unitCents,
  inCart,
  onConfirm,
  onRemove,
  onCancel,
}: {
  tableId: string;
  rowLabel: string;
  eventDays: IsoDate[];
  openDays: ReadonlySet<IsoDate>;
  initial: IsoDate[];
  unitCents: number;
  inCart: boolean;
  onConfirm: (dates: IsoDate[]) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [dates, setDates] = useState<Set<IsoDate>>(() => new Set(initial));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const toggle = (d: IsoDate) =>
    setDates((cur) => {
      const next = new Set(cur);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  const picked = eventDays.filter((d) => dates.has(d));
  const titleId = `confirm-${tableId}`;
  return (
    <div className={styles.confirm} role="dialog" aria-labelledby={titleId} aria-modal="false">
      <div className={styles.confirmHead}>
        <span className={styles.cartTile}>{tableId}</span>
        <div>
          <div id={titleId} className={styles.confirmTitle}>
            Table {tableId}
          </div>
          <div className={styles.confirmSub}>
            {rowLabel} · {fmtCents(unitCents)}/day
          </div>
        </div>
        <button type="button" className={styles.confirmClose} aria-label="Close" onClick={onCancel}>
          ×
        </button>
      </div>
      <div className={styles.confirmDays} role="group" aria-label={`Days for ${tableId}`}>
        {eventDays.map((d, i) => {
          const open = openDays.has(d);
          return (
            <label key={d} className={`${styles.confirmDay} ${open ? '' : styles.confirmDayOff}`}>
              <input
                ref={i === 0 ? first : undefined}
                type="checkbox"
                checked={dates.has(d)}
                disabled={!open}
                onChange={() => toggle(d)}
              />
              <span>{dayLabel(d)}</span>
              {!open && <span className={styles.confirmTaken}>taken</span>}
            </label>
          );
        })}
      </div>
      <div className={styles.confirmFoot}>
        <span className={styles.confirmPrice}>
          {picked.length ? `${picked.length} ${picked.length === 1 ? 'day' : 'days'} · ` : ''}
          <b>{fmtCents(unitCents * picked.length)}</b>
        </span>
        <div className={styles.confirmActions}>
          {inCart && (
            <button type="button" className={styles.cartRemove} onClick={onRemove}>
              Remove
            </button>
          )}
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={picked.length === 0}
            onClick={() => onConfirm(picked)}
          >
            {inCart ? 'Update' : 'Add to cart'}
          </Button>
        </div>
      </div>
    </div>
  );
}
