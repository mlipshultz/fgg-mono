'use client';

import type { FloorPlan, FloorTable } from '@fgg/types';
import { rowPairs } from '@/lib/booking';
import styles from './book.module.css';

function TableButton({
  t,
  taken,
  picked,
  onPick,
}: {
  t: FloorTable;
  taken: boolean;
  picked: boolean;
  onPick: (id: string) => void;
}) {
  const state = picked ? 'your pick' : taken ? 'taken' : 'available';
  return (
    <button
      type="button"
      className={`${styles.table} ${taken ? styles.tableTaken : ''} ${picked ? styles.tablePicked : ''}`}
      aria-pressed={picked}
      aria-label={`Table ${t.id}, ${state}`}
      title={`${t.id} · ${state}`}
      disabled={taken}
      onClick={() => onPick(t.id)}
    >
      {t.id}
    </button>
  );
}

/** Floor plan from mock 4a: stage, side zones, rows in back-to-back pairs, entrance row. */
export function FloorPlanMap({
  plan,
  unavailable,
  picked,
  onPick,
}: {
  plan: FloorPlan;
  unavailable: ReadonlySet<string>;
  picked: string | null;
  onPick: (id: string) => void;
}) {
  const pairs = rowPairs(plan);
  const line = (row: { row: string; left: FloorTable[]; right: FloorTable[] }) => (
    <div className={styles.rowLine} key={row.row}>
      <span className={styles.rowLabel} aria-hidden="true">
        {row.row}
      </span>
      {row.left.map((t) => (
        <TableButton
          key={t.id}
          t={t}
          taken={unavailable.has(t.id)}
          picked={picked === t.id}
          onPick={onPick}
        />
      ))}
      <span className={styles.aisle} aria-hidden="true" />
      {row.right.map((t) => (
        <TableButton
          key={t.id}
          t={t}
          taken={unavailable.has(t.id)}
          picked={picked === t.id}
          onPick={onPick}
        />
      ))}
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
