'use client';

import type { ReactNode } from 'react';
import type { FloorPlan, IsoDate } from '@fgg/types';
import { dayLabel, stripeFor } from '@/lib/booking';
import { dayOfWeek } from '@/lib/dates';
import { FloorPlanMap } from './FloorPlanMap';
import styles from './book.module.css';

/**
 * Step 1 layout: title row, Days chips, the map and its legend, then the cart in a side panel
 * (desktop) or a bottom sheet (phones). The cart itself and the actions come in as nodes so
 * BookFlow owns all the state.
 */
export function Picker({
  eyebrow,
  plan,
  eventDays,
  openDays,
  mine,
  picked,
  dayChoice,
  frozen,
  availCount,
  availOn,
  onChooseDays,
  onToggleTable,
  cartBody,
  actions,
  summaryLine,
  summarySub,
  sheetOpen,
  onSheetToggle,
  sheetError,
}: {
  eyebrow: string;
  plan: FloorPlan;
  eventDays: IsoDate[];
  openDays: ReadonlyMap<string, ReadonlySet<IsoDate>>;
  mine: ReadonlyMap<string, IsoDate[]>;
  picked: ReadonlySet<string>;
  dayChoice: 'all' | IsoDate;
  frozen: boolean;
  availCount: number;
  availOn: (d: IsoDate) => number;
  onChooseDays: (choice: 'all' | IsoDate) => void;
  onToggleTable: (id: string) => void;
  /** The cart, with or without its "N tables picked" heading. */
  cartBody: (heading: boolean) => ReactNode;
  actions: (size: 'lg' | 'md') => ReactNode;
  summaryLine: string;
  summarySub: string;
  sheetOpen: boolean;
  onSheetToggle: () => void;
  sheetError: string | null;
}) {
  const multiDay = eventDays.length > 1;
  return (
    <>
      <div className={styles.body}>
        <div className={styles.main}>
          <div className={styles.headRow}>
            <div>
              <span className={styles.eyebrow}>{eyebrow}</span>
              <h1 className={styles.h2}>Pick your tables</h1>
            </div>
            <span className={styles.avail}>
              {dayChoice === 'all'
                ? `${availCount} tables open`
                : `${availOn(dayChoice)} open ${dayOfWeek(dayChoice)}`}
            </span>
          </div>
          {multiDay && (
            <div className={styles.days} role="group" aria-label="Days">
              <span>Days</span>
              <button
                type="button"
                className={styles.dayChip}
                aria-pressed={dayChoice === 'all'}
                disabled={frozen}
                onClick={() => onChooseDays('all')}
              >
                {eventDays.length === 2 ? 'Both days' : 'All days'}
              </button>
              {eventDays.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`${styles.dayChip} ${styles.dayChipMark}`}
                  style={{ backgroundImage: stripeFor(eventDays, d) }}
                  aria-pressed={dayChoice === d}
                  disabled={frozen}
                  onClick={() => onChooseDays(d)}
                >
                  <span>{dayLabel(d)}</span>
                </button>
              ))}
            </div>
          )}
          <FloorPlanMap
            plan={plan}
            eventDays={eventDays}
            openDays={openDays}
            mine={mine}
            picked={picked}
            filterDay={dayChoice === 'all' ? null : dayChoice}
            disabled={frozen}
            onToggle={onToggleTable}
          />
          <div className={styles.legend}>
            <span>
              <span className={styles.swatch} /> Open {multiDay ? 'all days' : ''}
            </span>
            {multiDay && (
              <span>
                <span
                  className={`${styles.swatch} ${styles.swatchStripe}`}
                  style={{ backgroundImage: stripeFor(eventDays, eventDays[0]!) }}
                />{' '}
                Striped · open those days only
              </span>
            )}
            <span>
              <span className={`${styles.swatch} ${styles.swatchPick}`} /> In your cart
            </span>
            {mine.size > 0 && (
              <span>
                <span className={`${styles.swatch} ${styles.swatchMine}`} /> Your tables
              </span>
            )}
            <span>
              <span className={`${styles.swatch} ${styles.swatchTaken}`} /> Taken
            </span>
          </div>
        </div>
        <aside className={styles.panel} aria-label="Your tables">
          {cartBody(true)}
          {actions('lg')}
        </aside>
      </div>
      <div
        className={`${styles.sheet} ${sheetOpen ? styles.sheetOpen : ''}`}
        role="dialog"
        aria-label="Your tables"
      >
        <button
          type="button"
          className={styles.sheetHandle}
          aria-expanded={sheetOpen}
          aria-controls="cart-sheet-body"
          onClick={onSheetToggle}
        >
          <span className={styles.grab} aria-hidden="true" />
          <span className={styles.sheetSel}>
            <span className={styles.sheetTile}>{picked.size || '—'}</span>
            <span className={styles.sheetSelText}>
              <span className={styles.sheetName}>{summaryLine}</span>
              <span className={styles.sheetSub}>
                {summarySub} · {sheetOpen ? 'Hide' : 'Details'}
              </span>
            </span>
          </span>
        </button>
        {sheetOpen && (
          <div id="cart-sheet-body" className={styles.sheetBody}>
            {cartBody(false)}
          </div>
        )}
        {!sheetOpen && sheetError && (
          <div className={styles.errorBox} role="alert">
            {sheetError}
          </div>
        )}
        {actions('md')}
      </div>
    </>
  );
}
