'use client';

import type { FloorPlan, FloorTable } from '@fgg/types';
import { rowPairs } from '@/lib/booking';
import book from '@/app/vendor/book/book.module.css';
import styles from './page.module.css';

export interface BookedTable {
  vendorId: string;
  name: string;
}

/**
 * Read-only floor plan for attendees: booked tables are ink and carry the vendor's name; the
 * highlighted vendor's tables are pink. Tapping a booked table jumps to that vendor's card.
 */
export function VenueMap({
  plan,
  booked,
  focus,
  flash,
  onPick,
}: {
  plan: FloorPlan;
  booked: ReadonlyMap<string, BookedTable>;
  focus: string | null;
  /** Changes each time the vendor asks to be found; re-runs the flash animation. */
  flash: number;
  onPick: (vendorId: string) => void;
}) {
  const cell = (t: FloorTable) => {
    const b = booked.get(t.id);
    const hot = !!b && b.vendorId === focus;
    return (
      <button
        key={hot ? `${t.id}-${flash}` : t.id}
        type="button"
        data-table={t.id}
        data-hot={hot || undefined}
        className={[
          book.table,
          b
            ? hot
              ? `${book.tablePicked} ${styles.tableFlash}`
              : book.tableMine
            : styles.tableFree,
        ].join(' ')}
        aria-label={b ? `Table ${t.id}, ${b.name}` : `Table ${t.id}, open`}
        title={b ? `${t.id} · ${b.name}` : `${t.id} · open`}
        disabled={!b}
        onClick={() => b && onPick(b.vendorId)}
      >
        <span className={book.tableId}>{t.id}</span>
      </button>
    );
  };
  const line = (row: { row: string; left: FloorTable[]; right: FloorTable[] }) => (
    <div className={book.rowLine} key={row.row}>
      <span className={book.rowLabel} aria-hidden="true">
        {row.row}
      </span>
      {row.left.map(cell)}
      <span className={book.aisle} aria-hidden="true" />
      {row.right.map(cell)}
    </div>
  );
  return (
    <div className={book.plan}>
      <div className={`${book.bar} ${book.barStage}`}>
        Stage · Tournaments &amp; Costume Contest
      </div>
      <div className={book.hall}>
        <div className={book.sideZones}>
          <div className={`${book.zone} ${book.zonePink}`}>
            Art
            <br />
            Station
          </div>
          <div className={`${book.zone} ${book.zoneDashed}`}>PokéPets</div>
        </div>
        <div className={book.rows} role="group" aria-label="Tables">
          {rowPairs(plan).map(([top, bot]) => (
            <div className={book.pair} key={top.row}>
              {line(top)}
              {bot && line(bot)}
            </div>
          ))}
        </div>
        <div className={book.sideZones}>
          <div className={`${book.zone} ${book.zoneAqua}`}>
            Kids
            <br />
            Trading
            <br />
            Tables
          </div>
          <div className={`${book.zone} ${book.zoneDashed}`}>
            Find &apos;Em All
            <br />
            Start
          </div>
        </div>
      </div>
      <div className={book.bottomRow}>
        <div className={`${book.bar} ${book.barDashed}`}>Cards for Cans</div>
        <div className={`${book.bar} ${book.barEntrance}`}>Entrance · Check-in</div>
        <div className={`${book.bar} ${book.barDashed}`}>Restrooms</div>
      </div>
    </div>
  );
}
