import Link from 'next/link';
import type { HomeContent, PublicGalleryItem } from '@fgg/types';
import ui from '@/components/ui.module.css';
import { monthYearLabel } from '@/lib/dates';
import styles from './Sections.module.css';

type Past = HomeContent['pastEvents'][number];

function label(item: PublicGalleryItem, past: Past[]): string {
  const ev = past.find((p) => p.id === item.eventId);
  return ev ? `${ev.name} · ${monthYearLabel(ev.startDate)}` : item.eventLabel;
}

export function PastEventsTeaser({
  items,
  pastEvents,
}: {
  items: PublicGalleryItem[];
  pastEvents: Past[];
}) {
  const featured =
    items.find((i) => i.type === 'photo' && i.featured) ?? items.find((i) => i.type === 'photo');
  const rest = items.filter((i) => i !== featured);
  const photos = rest.filter(
    (i): i is Extract<PublicGalleryItem, { type: 'photo' }> => i.type === 'photo',
  );
  const video = rest.find(
    (i): i is Extract<PublicGalleryItem, { type: 'video' }> => i.type === 'video',
  );
  const quote = rest.find(
    (i): i is Extract<PublicGalleryItem, { type: 'quote' }> => i.type === 'quote',
  );
  if (!featured || featured.type !== 'photo') return null;

  return (
    <section className={styles.past} aria-labelledby="past-title">
      <div className={styles.pastHead}>
        <div>
          <span className={ui.eyebrow}>Past events</span>
          <h2 id="past-title" className={ui.h2}>
            Look what you missed
          </h2>
        </div>
        <Link href="/past-events" className={styles.pastLink}>
          See the full gallery →
        </Link>
      </div>
      <div className={styles.mosaic}>
        <Link href="/past-events" className={`${styles.tile} ${styles.tileFeatured}`}>
          <img src={featured.url} alt={featured.caption ?? featured.eventLabel} />
          <span className={styles.caption}>
            {label(featured, pastEvents)}
            {featured.caption && (
              <>
                {' · '}
                <em>{featured.caption}</em>
              </>
            )}
          </span>
        </Link>
        {photos.slice(0, 2).map((p) => (
          <Link key={p.id} href="/past-events" className={styles.tile}>
            <img src={p.url} alt={p.caption ?? p.eventLabel} />
            <span className={`${styles.caption} ${styles.captionSm}`}>{label(p, pastEvents)}</span>
          </Link>
        ))}
        <Link
          href="/past-events"
          className={`${styles.tile} ${styles.videoTile}`}
          aria-label="Recap video"
        >
          {video ? <img src={video.posterUrl} alt="" /> : null}
          <span className={styles.play} aria-hidden="true">
            ▶
          </span>
          <span className={`${styles.caption} ${styles.captionSm}`}>
            {video?.caption ?? 'Recap video'}
          </span>
        </Link>
        <div className={`${styles.tile} ${styles.quoteTile}`}>
          <span className={styles.quoteText}>
            {quote?.text ?? '"My son traded his first card here and hasn\'t stopped smiling."'}
          </span>
          <span className={styles.quoteBy}>— {quote?.attribution ?? 'Parent, Summer Fest'}</span>
        </div>
      </div>
    </section>
  );
}
