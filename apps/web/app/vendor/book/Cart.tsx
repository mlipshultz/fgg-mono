'use client';

import type { ReactNode } from 'react';
import type { FloorPlan, IsoDate, Quote, TableRate } from '@fgg/types';
import { dayLabel, daysShort, fmtCents, tableById } from '@/lib/booking';
import { dayOfWeek } from '@/lib/dates';
import styles from './book.module.css';

export interface CartLine {
  tableId: string;
  dates: IsoDate[];
}

/** One-line PokéBucks switch; the explanation sits behind a disclosure. */
export function RateSwitch({
  rate,
  pokeBucksCents,
  disabled,
  onChange,
}: {
  rate: TableRate;
  pokeBucksCents: number;
  disabled: boolean;
  onChange: (rate: TableRate) => void;
}) {
  const on = rate === 'poke_bucks';
  return (
    <div className={styles.rateRow}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={styles.switch}
        disabled={disabled}
        onClick={() => onChange(on ? 'standard' : 'poke_bucks')}
      >
        <span className={styles.switchKnob} aria-hidden="true" />
        <span className={styles.switchText}>
          PokéBucks partner rate · {fmtCents(pokeBucksCents)}/day
        </span>
      </button>
      <details className={styles.rateHelp}>
        <summary>What&apos;s this?</summary>
        <p>
          Partners bring a bulk binder and sell cards to kids for the PokéBucks they get at the
          door, in exchange for a half-price table.
        </p>
      </details>
    </div>
  );
}

/**
 * The cart as rendered in the desktop side panel and inside the phone sheet: what's already
 * yours, the lines, the rate switch and the totals. Actions (hold / continue) are passed in so
 * the sheet can keep them outside its scroll area.
 */
export function CartBody({
  cart,
  plan,
  eventDays,
  openDays,
  mine,
  perTable,
  rate,
  pokeBucksCents,
  priced,
  lineUnit,
  lineCents,
  subtotal,
  total,
  frozen,
  onRate,
  onToggleLineDay,
  onRemove,
  onPerTable,
  onSameDays,
  heading = true,
  children,
}: {
  cart: CartLine[];
  plan: FloorPlan;
  eventDays: IsoDate[];
  openDays: ReadonlyMap<string, ReadonlySet<IsoDate>>;
  mine: ReadonlyMap<string, IsoDate[]>;
  /** Show the per-table day toggles (the exception path). */
  perTable: boolean;
  rate: TableRate;
  pokeBucksCents: number;
  priced: Quote | null;
  lineUnit: (l: CartLine) => number;
  lineCents: (l: CartLine) => number;
  subtotal: number;
  total: number;
  /** A hold exists: nothing in the cart can change. */
  frozen: boolean;
  onRate: (rate: TableRate) => void;
  onToggleLineDay: (tableId: string, d: IsoDate) => void;
  onRemove: (tableId: string) => void;
  onPerTable: () => void;
  onSameDays: () => void;
  /** The phone sheet's handle already says how many tables are picked. */
  heading?: boolean;
  children?: ReactNode;
}) {
  const multiDay = eventDays.length > 1;
  const tablesWord = cart.length === 1 ? 'table' : 'tables';
  const tableDays = cart.reduce((n, l) => n + l.dates.length, 0);
  return (
    <>
      {mine.size > 0 && (
        <div className={styles.mine}>
          <b>Already yours</b>
          <span>
            {[...mine.entries()]
              .sort(([x], [y]) => x.localeCompare(y, 'en', { numeric: true }))
              .map(([id, dates]) => `${id} · ${daysShort(eventDays, dates)}`)
              .join(', ')}
          </span>
        </div>
      )}
      {heading && (
        <div>
          <div className={styles.selName}>
            {cart.length ? `${cart.length} ${tablesWord} picked` : 'Nothing picked yet'}
          </div>
          <div className={styles.selSub}>
            {cart.length
              ? 'Add more from the map, or continue.'
              : 'Every table is 8ft with 2 chairs and 2 vendor passes.'}
          </div>
        </div>
      )}
      <div className={styles.cart}>
        {cart.length === 0 && (
          <div className={styles.cartEmpty}>
            Tap any open table on the map. Add as many as you need.
          </div>
        )}
        {cart.map((l) => {
          const t = tableById(plan, l.tableId);
          const open = openDays.get(l.tableId) ?? new Set<IsoDate>();
          return (
            <div className={styles.cartLine} key={l.tableId}>
              <span className={styles.cartTile}>{l.tableId}</span>
              <div className={styles.cartBody}>
                <span className={styles.cartRow}>
                  {t ? `Row ${t.row}` : 'Main Hall'} · {fmtCents(lineUnit(l))}/day
                  {multiDay && !perTable ? ` · ${daysShort(eventDays, l.dates)}` : ''}
                </span>
                {multiDay && perTable && (
                  <div
                    className={styles.cartDays}
                    role="group"
                    aria-label={`Days for ${l.tableId}`}
                  >
                    {eventDays.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={styles.cartDay}
                        aria-pressed={l.dates.includes(d)}
                        disabled={frozen || !open.has(d)}
                        title={open.has(d) ? dayLabel(d) : `${dayLabel(d)} · taken`}
                        onClick={() => onToggleLineDay(l.tableId, d)}
                      >
                        {dayOfWeek(d)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className={styles.cartRight}>
                <span className={styles.cartPrice}>{fmtCents(lineCents(l))}</span>
                {!frozen && (
                  <button
                    type="button"
                    className={styles.cartRemove}
                    onClick={() => onRemove(l.tableId)}
                    aria-label={`Remove ${l.tableId}`}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {multiDay && cart.length > 0 && !frozen && (
          <button
            type="button"
            className={styles.perTableLink}
            onClick={perTable ? onSameDays : onPerTable}
          >
            {perTable ? 'Use the same days for every table' : 'Need different days for one table?'}
          </button>
        )}
      </div>
      <RateSwitch rate={rate} pokeBucksCents={pokeBucksCents} disabled={frozen} onChange={onRate} />
      <div className={styles.lines}>
        <div className={styles.line}>
          <span>
            {cart.length} {tablesWord} · {tableDays} table-{tableDays === 1 ? 'day' : 'days'}
          </span>
          <span>{fmtCents(subtotal)}</span>
        </div>
        {priced && priced.feeCents > 0 && (
          <div className={`${styles.line} ${styles.lineMuted}`}>
            <span>Processing fee</span>
            <span>{fmtCents(priced.feeCents)}</span>
          </div>
        )}
        {priced && priced.taxCents > 0 && (
          <div className={`${styles.line} ${styles.lineMuted}`}>
            <span>Tax</span>
            <span>{fmtCents(priced.taxCents)}</span>
          </div>
        )}
        <div className={styles.total}>
          <span>Total</span>
          <span>{fmtCents(total)}</span>
        </div>
      </div>
      {children}
    </>
  );
}
