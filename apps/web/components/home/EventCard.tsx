import Link from 'next/link';
import type { PublicEvent } from '@fgg/types';
import { BookCta } from '@/components/vendor/BookCta';
import ui from '@/components/ui.module.css';
import { dayRange, fullDateLabel, monthAbbr, stubColor, year } from '@/lib/dates';
import styles from './EventCard.module.css';
import { HeartButton } from './HeartButton';
import { TablesLeft } from './TablesLeft';
import { WaitlistButton } from './WaitlistButton';

const TILE = { pink: styles.tilePink, aqua: styles.tileAqua, yellow: styles.tileYellow };

export function EventCard({ ev, index }: { ev: PublicEvent; index: number }) {
  const color = stubColor(index);
  const thisYear = new Date().getFullYear();
  return (
    <article
      id={`event-${ev.slug}`}
      className={styles.card}
      aria-labelledby={`event-${ev.slug}-name`}
    >
      <div className={styles.poster}>
        {ev.posterUrl ? (
          <>
            <img src={ev.posterUrl} alt="" aria-hidden="true" className={styles.posterBlur} />
            <img src={ev.posterUrl} alt={`${ev.name} poster`} className={styles.posterImg} />
          </>
        ) : (
          <span className={styles.posterEmpty}>Poster coming soon</span>
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.titleRow}>
          <h3 id={`event-${ev.slug}-name`} className={styles.name}>
            {ev.name}
          </h3>
          <div className={styles.titleTools}>
            <HeartButton eventId={ev.id} slug={ev.slug} name={ev.name} />
            <div className={styles.tile} aria-hidden="true">
              <div className={`${styles.tileMon} ${TILE[color]}`}>{monthAbbr(ev.startDate)}</div>
              <div className={styles.tileDay}>{dayRange(ev.startDate, ev.endDate)}</div>
              <div className={styles.tileYear}>{year(ev.startDate)}</div>
            </div>
          </div>
        </div>
        <div className={styles.meta}>
          <b>{ev.venue.name}</b> · {ev.venue.city}, {ev.venue.state}
          <br />
          {fullDateLabel(ev.startDate, ev.endDate, year(ev.startDate) !== thisYear)} ·{' '}
          {ev.hoursLabel}
        </div>
        <p className={styles.blurb}>{ev.blurb}</p>
        <Link href={`/events/${ev.slug}/`} className={styles.whoLink}>
          See who&apos;s vending →
        </Link>
        <div className={styles.foot}>
          <span className={styles.vendors}>
            Vendors{' '}
            {ev.vendorStatus === 'open' && (
              <span className={`${ui.pill} ${ui.pillOpen}`}>
                <TablesLeft eventId={ev.id} initial={ev.tablesLeft} />
              </span>
            )}
            {ev.vendorStatus === 'closed' && (
              <span className={`${ui.pill} ${ui.pillClosed}`}>Closed</span>
            )}
            {ev.vendorStatus === 'coming_soon' && (
              <span className={`${ui.pill} ${ui.pillSoon}`}>Coming Soon</span>
            )}
          </span>
          {ev.vendorStatus === 'open' && <BookCta slug={ev.slug} />}
          {ev.vendorStatus === 'closed' && <WaitlistButton eventId={ev.id} kind="waitlist" />}
          {ev.vendorStatus === 'coming_soon' && <WaitlistButton eventId={ev.id} kind="notify_me" />}
        </div>
      </div>
    </article>
  );
}

export function EventCards({ events }: { events: PublicEvent[] }) {
  const nextYear = new Date().getFullYear() + 1;
  return (
    <div className={styles.wrap}>
      {events.map((ev, i) => (
        <EventCard key={ev.id} ev={ev} index={i} />
      ))}
      <div className={styles.more}>
        <span className={styles.moreTitle}>More {nextYear} dates soon</span>
        <span className={styles.moreText}>
          Join the email list below and you&apos;ll hear first.
        </span>
        <a href="#email" className={styles.moreLink}>
          Join the list →
        </a>
      </div>
    </div>
  );
}
