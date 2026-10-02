'use client';

import type { FloorPlan, FloorTable, IsoDate } from '@fgg/types';
import { daysShort, rowPairs, stripesFor } from '@/lib/booking';
import styles from './book.module.css';

function TableButton({
  t,
  eventDays,
  openDays,
  mineDays,
  picked,
  dimmed,
  disabled,
  onToggle,
}: {
  t: FloorTable;
  eventDays: IsoDate[];
  openDays: ReadonlySet<IsoDate>;
  /** Days this vendor already booked the table for (paid). */
  mineDays: IsoDate[];
  picked: boolean;
  dimmed: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  const taken = openDays.size === 0;
  const mine = mineDays.length > 0;
  const partial = !taken && openDays.size < eventDays.length;
  const state = picked
    ? 'in your cart'
    : mine
      ? `yours ${daysShort(eventDays, mineDays)}${openDays.size ? ` · open ${daysShort(eventDays, [...openDays])}` : ''}`
      : taken
        ? 'taken'
        : partial
          ? `open ${daysShort(eventDays, [...openDays])} only`
          : 'open all days';
  const stripes = picked || mine ? undefined : stripesFor(eventDays, openDays);
  return (
    <button
      type="button"
      className={[
        styles.table,
        taken && !mine ? styles.tableTaken : '',
        mine && !picked ? styles.tableMine : '',
        picked ? styles.tablePicked : '',
        partial && !picked && !mine ? styles.tablePartial : '',
        dimmed ? styles.tableDim : '',
      ].join(' ')}
      style={stripes ? { backgroundImage: stripes } : undefined}
      aria-pressed={picked}
      aria-label={`Table ${t.id}, ${state}`}
      title={`${t.id} · ${state}`}
      disabled={taken || disabled || (dimmed && !picked)}
      onClick={() => onToggle(t.id)}
    >
      <span className={styles.tableId}>{t.id}</span>
    </button>
  );
}

/**
 * Floor plan from mock 4a: stage, side zones, rows in back-to-back pairs, entrance row.
 * Cells show per-day availability: plain = open every day, grey = taken, striped = open on the
 * striped days only (one colour and direction per day). Tapping toggles the table in the cart.
 */
export function FloorPlanMap({
  plan,
  eventDays,
  openDays,
  mine,
  picked,
  filterDay,
  disabled = false,
  onToggle,
}: {
  plan: FloorPlan;
  eventDays: IsoDate[];
  openDays: ReadonlyMap<string, ReadonlySet<IsoDate>>;
  /** Tables this vendor already holds a paid order for, with the booked days. */
  mine: ReadonlyMap<string, IsoDate[]>;
  picked: ReadonlySet<string>;
  /** When set, tables not open on this day are dimmed. */
  filterDay: IsoDate | null;
  disabled?: boolean;
  onToggle: (id: string) => void;
}) {
  const pairs = rowPairs(plan);
  const cell = (t: FloorTable) => {
    const open = openDays.get(t.id) ?? new Set<IsoDate>();
    return (
      <TableButton
        key={t.id}
        t={t}
        eventDays={eventDays}
        openDays={open}
        mineDays={mine.get(t.id) ?? []}
        picked={picked.has(t.id)}
        dimmed={filterDay !== null && open.size > 0 && !open.has(filterDay)}
        disabled={disabled}
        onToggle={onToggle}
      />
    );
  };
  const line = (row: { row: string; left: FloorTable[]; right: FloorTable[] }) => (
    <div className={styles.rowLine} key={row.row}>
      <span className={styles.rowLabel} aria-hidden="true">
        {row.row}
      </span>
      {row.left.map(cell)}
      <span className={styles.aisle} aria-hidden="true" />
      {row.right.map(cell)}
    </div>
  );
  return (
    <div className={styles.plan}>
      <div className={`${styles.bar} ${styles.barStage}`}>
        Stage · Tournaments &amp; Costume Contest
      </div>
      <div className={styles.hall}>
        <div className={styles.sideZones}>
          <div className={`${styles.zone} ${styles.zonePink}`}>
            Art
            <br />
            Station
          </div>
          <div className={`${styles.zone} ${styles.zoneDashed}`}>PokéPets</div>
        </div>
        <div className={styles.rows} role="group" aria-label="Tables">
          {pairs.map(([top, bot]) => (
            <div className={styles.pair} key={top.row}>
              {line(top)}
              {bot && line(bot)}
            </div>
          ))}
        </div>
        <div className={styles.sideZones}>
          <div className={`${styles.zone} ${styles.zoneAqua}`}>
            Kids
            <br />
            Trading
            <br />
            Tables
          </div>
          <div className={`${styles.zone} ${styles.zoneDashed}`}>
            Find &apos;Em All
            <br />
            Start
          </div>
        </div>
      </div>
      <div className={styles.bottomRow}>
        <div className={`${styles.bar} ${styles.barDashed}`}>Cards for Cans</div>
        <div className={`${styles.bar} ${styles.barEntrance}`}>
          Entrance · Check-in · Vendor load-in
        </div>
        <div className={`${styles.bar} ${styles.barDashed}`}>Restrooms</div>
      </div>
    </div>
  );
}
