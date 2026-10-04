'use client';

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FloorPlan, IsoDate } from '@fgg/types';
import { dayLabel, daysShort, stripeFor } from '@/lib/booking';
import { dayOfWeek } from '@/lib/dates';
import { FloorPlanMap } from './FloorPlanMap';
import styles from './book.module.css';

const PHONE = '(max-width: 767px)';

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return phone;
}

/** Where to put the popover: under the tapped cell, centred, kept inside the plan card. */
function placePopover(cell: HTMLElement, plan: HTMLElement, pop: HTMLElement) {
  const c = cell.getBoundingClientRect();
  const p = plan.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const gap = 8;
  let left = c.left - p.left + c.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, p.width - w - 8));
  let top = c.bottom - p.top + gap;
  if (top + h > p.height - 8 && c.top - p.top - gap - h > 8) top = c.top - p.top - gap - h;
  return { left, top };
}

/**
 * Step 1 layout: title row, day checkboxes, "Already yours", the map with its legend and the
 * table popover, then the cart in a side panel (desktop) or a bottom sheet (phones). The cart,
 * the confirm card and the actions come in as nodes so BookFlow owns all the state.
 */
export function Picker({
  eyebrow,
  plan,
  eventDays,
  openDays,
  mine,
  picked,
  shownDays,
  frozen,
  availCount,
  availOn,
  onToggleShownDay,
  onPickTable,
  pendingTable,
  confirm,
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
  shownDays: ReadonlySet<IsoDate>;
  frozen: boolean;
  availCount: number;
  availOn: (d: IsoDate) => number;
  onToggleShownDay: (d: IsoDate) => void;
  onPickTable: (id: string, el: HTMLButtonElement) => void;
  /** Table whose days are being chosen; `confirm` is the card for it. */
  pendingTable: string | null;
  confirm: ReactNode;
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
  const phone = useIsPhone();
  const planRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Anchor the popover to the pending table's cell; follow resizes.
  useLayoutEffect(() => {
    if (!pendingTable || phone) {
      setPos(null);
      return;
    }
    const place = () => {
      const cell = planRef.current?.querySelector<HTMLElement>(`[data-table="${pendingTable}"]`);
      if (cell && planRef.current && popRef.current)
        setPos(placePopover(cell, planRef.current, popRef.current));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [pendingTable, phone]);

  const allShown = shownDays.size === eventDays.length;
  const shownLabel = allShown ? null : eventDays.find((d) => shownDays.has(d));
  const mineLine = [...mine.entries()]
    .sort(([x], [y]) => x.localeCompare(y, 'en', { numeric: true }))
    .map(([id, dates]) => `${id} · ${daysShort(eventDays, dates)}`)
    .join(', ');

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
              {shownLabel
                ? `${availOn(shownLabel)} open ${dayOfWeek(shownLabel)}`
                : `${availCount} tables open`}
            </span>
          </div>
          {multiDay && (
            <div className={styles.days} role="group" aria-label="Available days">
              <span>Available</span>
              {eventDays.map((d) => (
                <label
                  key={d}
                  className={`${styles.dayCheck} ${shownDays.has(d) ? styles.dayCheckOn : ''}`}
                  style={{ backgroundImage: stripeFor(eventDays, d) }}
                >
                  <input
                    type="checkbox"
                    checked={shownDays.has(d)}
                    disabled={frozen}
                    onChange={() => onToggleShownDay(d)}
                  />
                  <span>{dayLabel(d)}</span>
                </label>
              ))}
            </div>
          )}
          {mine.size > 0 && (
            <div className={styles.mineStrip}>
              <b>Already yours</b>
              <span>{mineLine}</span>
            </div>
          )}
          <div className={styles.planWrap} ref={planRef}>
            <FloorPlanMap
              plan={plan}
              eventDays={eventDays}
              openDays={openDays}
              mine={mine}
              picked={picked}
              shownDays={shownDays}
              disabled={frozen}
              onToggle={onPickTable}
            />
            {pendingTable && !phone && (
              <div
                ref={popRef}
                className={styles.popover}
                style={pos ? { left: pos.left, top: pos.top, visibility: 'visible' } : undefined}
              >
                {confirm}
              </div>
            )}
          </div>
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
        className={`${styles.sheet} ${sheetOpen || pendingTable ? styles.sheetOpen : ''}`}
        role="dialog"
        aria-label="Your tables"
      >
        {pendingTable && phone ? (
          <div className={styles.sheetConfirm}>{confirm}</div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </>
  );
}
