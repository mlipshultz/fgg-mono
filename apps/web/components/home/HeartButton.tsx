'use client';

import Link from 'next/link';
import { useAuth, useSavedEvents } from '@/components/Providers';
import { hasApi } from '@/lib/api';
import styles from './HeartButton.module.css';

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.8 4.5c2 0 3.5 1.1 5.2 3 1.7-1.9 3.2-3 5.2-3 3.8 0 5.9 3.8 4.4 7.2C19.5 16.4 12 21 12 21z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Save / unsave an event. Signed-out users are sent to log in and back to the card. */
export function HeartButton({
  eventId,
  slug,
  name,
  size = 'md',
}: {
  eventId: string;
  slug: string;
  name: string;
  size?: 'sm' | 'md';
}) {
  const { status } = useAuth();
  const saved = useSavedEvents();
  const isSaved = saved.isSaved(eventId);
  const cls = `${styles.heart} ${size === 'sm' ? styles.sm : ''} ${isSaved ? styles.saved : ''}`;

  if (status === 'signed-out' && hasApi) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(`/#event-${slug}`)}`}
        className={cls}
        aria-label={`Log in to save ${name}`}
        title="Log in to save this event"
      >
        <HeartIcon filled={false} />
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      aria-pressed={isSaved}
      aria-label={isSaved ? `Unsave ${name}` : `Save ${name}`}
      title={isSaved ? 'Saved · click to unsave' : 'Save this event'}
      disabled={status === 'loading'}
      onClick={() => void saved.toggle(eventId)}
    >
      <HeartIcon filled={isSaved} />
    </button>
  );
}
