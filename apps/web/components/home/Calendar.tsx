'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PublicEvent } from '@fgg/types';
import ui from '@/components/ui.module.css';
import {
  type IsoDateLike,
  eventDates,
  monthAbbr,
  monthGrid,
  monthLong,
  parseIsoDate,
  stubColor,
  todayIso,
} from '@/lib/dates';
import styles from './Calendar.module.css';

type View = 'month' | 'list';

const STATUS_LABEL: Record<PublicEvent['vendorStatus'], string> = {
  open: 'Open',
  closed: 'Closed',
  coming_soon: 'Coming Soon',
};
const STATUS_CLASS: Record<PublicEvent['vendorStatus'], string> = {
  open: ui.pillOpen ?? '',
  closed: ui.pillClosed ?? '',
  coming_soon: ui.pillSoon ?? '',
};

function scrollToEvent(slug: string) {
  const el = document.getElementById(`event-${slug}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('is-highlighted');
  window.setTimeout(() => el.classList.remove('is-highlighted'), 1800);
}

export function Calendar({ events }: { events: PublicEvent[] }) {
  const first = events[0];
  const start = first ? parseIsoDate(first.startDate) : parseIsoDate(todayIso());
  const [ym, setYm] = useState({ y: start.y, m: start.m });
  const [view, setView] = useState<View>('month');

  // Phone defaults to the list view (handoff §6). Runs after hydration to avoid a mismatch.
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) setView('list');
  }, []);

  const byDate = useMemo(() => {
    const map = new Map<string, { ev: PublicEvent; color: ReturnType<typeof stubColor> }>();
    events.forEach((ev, i) => {
      for (const d of eventDates(ev)) map.set(d, { ev, color: stubColor(i) });
    });
    return map;
  }, [events]);

  const cells = useMemo(() => monthGrid(ym.y, ym.m), [ym]);

  const prev = () => setYm(({ y, m }) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }));
  const next = () => setYm(({ y, m }) => (m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }));

  const colorClass = { pink: styles.cellPink, aqua: styles.cellAqua, yellow: styles.cellYellow };

  return (
    <section id="events" className={styles.section} aria-labelledby="events-title">
      <div className={styles.main}>
        <div className={styles.head}>
          <div className={styles.deskTitle}>
            <span className={ui.eyebrow}>Upcoming events</span>
            <h2 id="events-title" className={ui.h2}>
              What&apos;s coming up
            </h2>
          </div>
          <h2 className={styles.phoneTitle} aria-hidden="true">
            Coming up
          </h2>
          <div className={`${styles.controls} ${view === 'month' ? styles.monthOnly : ''}`}>
            <button
              type="button"
              className={styles.navBtn}
              onClick={prev}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className={styles.monthLabel} aria-live="polite">
              {monthLong(ym.y, ym.m)} {ym.y}
            </span>
            <button type="button" className={styles.navBtn} onClick={next} aria-label="Next month">
              ›
            </button>
            <span className={styles.toggle} role="group" aria-label="Calendar view">
              <button
                type="button"
                aria-pressed={view === 'month'}
                onClick={() => setView('month')}
              >
                Month
              </button>
              <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                List
              </button>
            </span>
          </div>
        </div>

        {view === 'month' ? (
          <div className={styles.card}>
            <div className={styles.weekdays} aria-hidden="true">
              {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div
              className={styles.grid}
              role="grid"
              aria-label={`${monthLong(ym.y, ym.m)} ${ym.y}`}
            >
              {cells.map((c, i) => {
                if (!c.date)
                  return <span key={`e${i}`} className={`${styles.cell} ${styles.cellEmpty}`} />;
                const hit = byDate.get(c.date);
                if (!hit) {
                  return (
                    <span key={c.date} className={styles.cell} role="gridcell">
                      <span>{c.day}</span>
                    </span>
                  );
                }
                return (
                  <button
                    key={c.date}
                    type="button"
                    role="gridcell"
                    className={`${styles.cell} ${styles.cellEvent} ${colorClass[hit.color]}`}
                    onClick={() => scrollToEvent(hit.ev.slug)}
                    aria-label={`${hit.ev.name}, ${c.date}`}
                  >
                    <span>{c.day}</span>
                    <span className={styles.cellLabel}>{hit.ev.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={styles.list}>
            {events.length === 0 && <p className={styles.empty}>More dates soon.</p>}
            {events.map((ev) => (
              <a key={ev.id} href={`#event-${ev.slug}`} className={styles.listRow}>
                <span className={styles.rowDate}>
                  <span className={styles.rowMon}>{monthAbbr(ev.startDate)}</span>
                  <span className={styles.rowDay}>{dayRangeShort(ev.startDate, ev.endDate)}</span>
                </span>
                <span className={styles.listBody}>
                  <span className={styles.listTop}>
                    <span className={styles.listName}>{ev.name}</span>
                    <span
                      className={`${ui.pill} ${styles.listStatus} ${STATUS_CLASS[ev.vendorStatus]}`}
                    >
                      {STATUS_LABEL[ev.vendorStatus]}
                    </span>
                  </span>
                  <span className={styles.rowSub}>
                    {ev.venue.city}, {ev.venue.state}
                  </span>
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      <aside className={styles.rail} aria-label="Next 5 shows">
        <span className={`${ui.eyebrow} ${ui.eyebrowMuted}`}>Next 5 shows</span>
        {events.slice(0, 5).map((ev) => (
          <a key={ev.id} href={`#event-${ev.slug}`} className={styles.row}>
            <span className={styles.rowDate}>
              <span className={styles.rowMon}>{monthAbbr(ev.startDate)}</span>
              <span className={styles.rowDay}>{dayRangeShort(ev.startDate, ev.endDate)}</span>
            </span>
            <span>
              <span className={styles.rowName}>{ev.name}</span>
              <span className={styles.rowSub}>
                {ev.venue.city}, {ev.venue.state} · Vendors: {STATUS_LABEL[ev.vendorStatus]}
              </span>
            </span>
          </a>
        ))}
      </aside>
    </section>
  );
}

function dayRangeShort(start: IsoDateLike, end: IsoDateLike): string {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  return start === end ? String(a.d) : `${a.d}–${b.d}`;
}
