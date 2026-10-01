'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GalleryPage, PublicGalleryItem } from '@fgg/types';
import { Button } from '@/components/Button';
import { fetchGallery, hasApi } from '@/lib/api';
import { Lightbox } from './Lightbox';
import styles from './page.module.css';

type Media = Extract<PublicGalleryItem, { type: 'photo' | 'video' }>;

function duration(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Gallery({ initial }: { initial: GalleryPage }) {
  const [eventId, setEventId] = useState<string | null>(null);
  const [videosOnly, setVideosOnly] = useState(false);
  const [items, setItems] = useState<PublicGalleryItem[]>(initial.items);
  const [cursor, setCursor] = useState<string | undefined>(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  // Re-query whenever filters change. Without an API, the helper filters the fixture.
  useEffect(() => {
    let alive = true;
    const isDefault = eventId === null && !videosOnly;
    if (isDefault && !hasApi) {
      setItems(initial.items);
      setCursor(initial.nextCursor);
      return;
    }
    setBusy(true);
    fetchGallery({ ...(eventId ? { eventId } : {}), videosOnly })
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [eventId, videosOnly, initial]);

  const loadMore = async () => {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await fetchGallery({ ...(eventId ? { eventId } : {}), videosOnly, cursor });
      setItems((cur) => [...cur, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setBusy(false);
    }
  };

  const media = useMemo(
    () => items.filter((i): i is Media => i.type === 'photo' || i.type === 'video'),
    [items],
  );
  const mediaIndex = (item: PublicGalleryItem) => media.findIndex((m) => m.id === item.id);

  return (
    <>
      <div className={styles.filters} role="group" aria-label="Filter gallery">
        <button
          type="button"
          className={styles.chip}
          aria-pressed={eventId === null}
          onClick={() => setEventId(null)}
        >
          All
        </button>
        {initial.events.map((ev) => (
          <button
            key={ev.id}
            type="button"
            className={styles.chip}
            aria-pressed={eventId === ev.id}
            onClick={() => setEventId(ev.id)}
          >
            {ev.label}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.chip} ${styles.videosOnly}`}
          aria-pressed={videosOnly}
          onClick={() => setVideosOnly((v) => !v)}
        >
          Videos only
        </button>
      </div>

      {items.length === 0 && !busy && (
        <p className={styles.empty}>Nothing here yet. Check back after the next fest.</p>
      )}

      <div className={styles.grid} aria-busy={busy}>
        {items.map((item) => {
          switch (item.type) {
            case 'photo':
              return (
                <button
                  key={item.id}
                  id={item.id}
                  type="button"
                  className={`${styles.tile} ${item.featured ? styles.featured : ''}`}
                  onClick={() => setOpen(mediaIndex(item))}
                  aria-label={`Open ${item.caption ?? item.eventLabel}`}
                >
                  <img src={item.thumbUrl} alt={item.caption ?? item.eventLabel} loading="lazy" />
                  {item.featured ? (
                    <span className={styles.featuredCaption}>
                      <span>
                        <span className={styles.featuredName}>{item.eventName}</span>
                        <br />
                        <span className={styles.featuredSub}>
                          {item.caption ?? item.eventLabel}
                        </span>
                      </span>
                      <span className={styles.featuredPill}>{item.eventLabel}</span>
                    </span>
                  ) : (
                    <span className={styles.caption}>{item.caption ?? item.eventLabel}</span>
                  )}
                </button>
              );
            case 'video':
              return (
                <button
                  key={item.id}
                  id={item.id}
                  type="button"
                  className={`${styles.tile} ${styles.video}`}
                  onClick={() => setOpen(mediaIndex(item))}
                  aria-label={`Play ${item.caption ?? item.eventLabel}`}
                >
                  <img src={item.posterUrl} alt="" loading="lazy" />
                  <span className={styles.play} aria-hidden="true">
                    ▶
                  </span>
                  <span className={styles.caption}>
                    {item.caption ?? 'Video'} · {duration(item.durationSeconds)}
                  </span>
                </button>
              );
            case 'stat':
              return (
                <div key={item.id} className={`${styles.tile} ${styles.stat}`}>
                  <span className={styles.statValue}>{item.value}</span>
                  <span className={styles.statLabel}>{item.label}</span>
                </div>
              );
            case 'quote':
              return (
                <div key={item.id} className={`${styles.tile} ${styles.quote}`}>
                  <span className={styles.quoteText}>{item.text}</span>
                  {item.attribution && <span className={styles.quoteBy}>— {item.attribution}</span>}
                </div>
              );
          }
        })}
      </div>

      {cursor && (
        <Button
          variant="secondary"
          size="md"
          className={styles.more}
          onClick={loadMore}
          disabled={busy}
        >
          {busy ? 'Loading…' : 'Load more'}
        </Button>
      )}

      {open !== null && media[open] && (
        <Lightbox items={media} index={open} onClose={() => setOpen(null)} onIndex={setOpen} />
      )}
    </>
  );
}
