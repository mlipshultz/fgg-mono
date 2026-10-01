'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicGalleryItem } from '@fgg/types';
import styles from './page.module.css';

type Media = Extract<PublicGalleryItem, { type: 'photo' | 'video' }>;

function dateLabel(item: Media): string | null {
  if (item.type !== 'photo' || !item.takenOn) return null;
  const [y, m, d] = item.takenOn.split('-').map(Number) as [number, number, number];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

export function Lightbox({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: Media[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const item = items[index];
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  const prev = useCallback(
    () => onIndex((index - 1 + items.length) % items.length),
    [index, items.length, onIndex],
  );
  const next = useCallback(
    () => onIndex((index + 1) % items.length),
    [index, items.length, onIndex],
  );

  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const focusables = Array.from(
          document.querySelectorAll<HTMLElement>('[data-lightbox] button, [data-lightbox] video'),
        );
        if (!focusables.length) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, prev, next]);

  if (!item) return null;

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${item.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: item.eventLabel, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* user cancelled */
    }
  };

  const when = dateLabel(item);
  const kind = item.type === 'video' ? 'Video' : 'Photo';

  return (
    <div
      className={styles.scrim}
      role="dialog"
      aria-modal="true"
      aria-label={`${item.eventLabel} gallery`}
      data-lightbox
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        ref={closeRef}
        type="button"
        className={styles.lbClose}
        aria-label="Close"
        onClick={onClose}
      >
        ×
      </button>
      {items.length > 1 && (
        <>
          <button type="button" className={styles.lbPrev} aria-label="Previous" onClick={prev}>
            ‹
          </button>
          <button type="button" className={styles.lbNext} aria-label="Next" onClick={next}>
            ›
          </button>
        </>
      )}
      <div className={styles.lbBody}>
        {item.type === 'video' ? (
          <video
            className={styles.lbMedia}
            src={item.url}
            poster={item.posterUrl}
            controls
            autoPlay
            playsInline
          />
        ) : (
          <img className={styles.lbMedia} src={item.url} alt={item.caption ?? item.eventLabel} />
        )}
        <div className={styles.lbCaption}>
          <b className={styles.lbEvent}>{item.eventLabel}</b>
          <span className={styles.lbIndex}>
            {kind} {index + 1} of {items.length}
            {when ? ` · ${when}` : ''}
            {item.caption ? ` · ${item.caption}` : ''}
          </span>
          <button type="button" className={styles.lbShare} onClick={share}>
            {copied ? 'Link copied' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  );
}
