'use client';

import { useEffect, useState } from 'react';
import type { EventVendor, PublicEvent } from '@fgg/types';
import ui from '@/components/ui.module.css';
import { getEventVendors } from '@/lib/api';
import { initials } from '@/lib/auth';
import { dayLabel } from '@/lib/booking';
import styles from './page.module.css';

function daysText(ev: PublicEvent, dates: string[]): string {
  if (dates.length === ev.days.length) return 'All days';
  return dates.map((d) => dayLabel(d).split(' ')[0]).join(' + ');
}

/** Runtime list so new bookings show up without a site rebuild. */
export function EventVendors({ event }: { event: PublicEvent }) {
  const [vendors, setVendors] = useState<EventVendor[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    getEventVendors(event.id)
      .then((r) => alive && setVendors(r.vendors))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [event.id]);

  if (error) {
    return (
      <p className={styles.empty}>We couldn&apos;t load the vendor list. Try again in a bit.</p>
    );
  }
  if (!vendors) {
    return (
      <div className={styles.grid} aria-busy="true" aria-label="Loading vendors">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${styles.card} ${styles.skeleton}`} />
        ))}
      </div>
    );
  }
  if (vendors.length === 0) {
    return (
      <div className={styles.emptyCard}>
        <span className={styles.emptyTitle}>The vendor list is coming together</span>
        <span className={styles.empty}>
          Vendors appear here as soon as their table is booked. Check back closer to the show.
        </span>
      </div>
    );
  }
  const multiDay = event.days.length > 1;
  return (
    <>
      <p className={styles.count}>
        {vendors.length} {vendors.length === 1 ? 'vendor' : 'vendors'} so far
      </p>
      <div className={styles.grid}>
        {vendors.map((v) => (
          <article key={`${v.vendorId}-${v.tableId}`} className={styles.card}>
            <div className={styles.cardHead}>
              {v.logoUrl ? (
                <img src={v.logoUrl} alt="" className={styles.logo} />
              ) : (
                <span className={`${styles.logo} ${styles.logoEmpty}`} aria-hidden="true">
                  {initials(v.name)}
                </span>
              )}
              <div className={styles.cardTitle}>
                <h2 className={styles.name}>{v.name}</h2>
                <span className={`${ui.pill} ${styles.tablePill}`}>
                  Table {v.tableId}
                  {multiDay ? ` · ${daysText(event, v.dates)}` : ''}
                </span>
              </div>
            </div>
            <p className={styles.sells}>{v.sellsDescription || 'Details coming soon.'}</p>
            {(v.socials.instagram || v.socials.tiktok || v.socials.website) && (
              <div className={styles.socials}>
                {v.socials.instagram && (
                  <a
                    href={`https://instagram.com/${v.socials.instagram}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Instagram
                  </a>
                )}
                {v.socials.tiktok && (
                  <a
                    href={`https://tiktok.com/@${v.socials.tiktok}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    TikTok
                  </a>
                )}
                {v.socials.website && (
                  <a href={v.socials.website} target="_blank" rel="noreferrer">
                    Website
                  </a>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
