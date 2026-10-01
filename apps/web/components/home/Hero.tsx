import type { PublicEvent, PublicSettings } from '@fgg/types';
import { Button } from '@/components/Button';
import { monthAbbr, parseIsoDate, shortDateLabel } from '@/lib/dates';
import styles from './Hero.module.css';

export function Hero({ events, settings }: { events: PublicEvent[]; settings: PublicSettings }) {
  const next = events[0];
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <span className={`${styles.circle} ${styles.circleAqua}`} aria-hidden="true" />
      <span className={`${styles.circle} ${styles.circlePink}`} aria-hidden="true" />
      {next && (
        <a href={`#event-${next.slug}`} className={styles.nextUp}>
          <span className={styles.nextUpTag}>NEXT UP</span>
          <span>
            {next.name} · {shortDateLabel(next.startDate, next.endDate)} · {next.venue.city},{' '}
            {next.venue.state}
          </span>
        </a>
      )}
      <h1 id="hero-title" className={styles.title}>
        The feel-good card &amp; gaming fest
      </h1>
      <p className={styles.tagline}>
        Family shows across Maryland where kids trade, play, earn XP, and everyone goes home
        smiling.
      </p>
      <div className={styles.ctas}>
        <Button href="/#events" variant="primary" size="lg">
          See Upcoming Events
        </Button>
        <Button href="/vendor/book" variant="secondary" size="lg">
          Become a Vendor
        </Button>
      </div>
      <div className={styles.chips}>
        {events.map((ev) => (
          <a key={ev.id} href={`#event-${ev.slug}`} className={styles.chip}>
            {monthAbbr(ev.startDate).slice(0, 1) + monthAbbr(ev.startDate).slice(1).toLowerCase()}{' '}
            {parseIsoDate(ev.startDate).d} · {ev.name}
          </a>
        ))}
      </div>
      <div className={styles.video}>
        {settings.heroVideoUrl ? (
          <>
            <video
              className={styles.motionOnly}
              autoPlay
              muted
              loop
              playsInline
              poster={settings.heroPosterUrl}
              src={settings.heroVideoUrl}
              aria-label="Event highlights"
            />
            {settings.heroPosterUrl && (
              <img
                className={styles.posterOnly}
                src={settings.heroPosterUrl}
                alt="Event highlights"
              />
            )}
          </>
        ) : settings.heroPosterUrl ? (
          <img src={settings.heroPosterUrl} alt="Event highlights" />
        ) : (
          <span className={styles.videoNote}>▶ event sizzle video coming soon</span>
        )}
      </div>
    </section>
  );
}
