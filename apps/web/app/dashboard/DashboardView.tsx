'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Dashboard, PublicEvent } from '@fgg/types';
import { Button } from '@/components/Button';
import { HeartButton } from '@/components/home/HeartButton';
import { useSavedEvents } from '@/components/Providers';
import ui from '@/components/ui.module.css';
import { authStyles } from '@/components/auth/AuthCard';
import { getDashboard } from '@/lib/api';
import { initials } from '@/lib/auth';
import { countdownLabel, dayRange, monthAbbr, stubColor } from '@/lib/dates';
import styles from './page.module.css';

const BADGE_FILL = [styles.badgeYellow, styles.badgePink, styles.badgeAqua];
const BADGE_GLYPHS: Record<string, string> = {
  'first-fest': '1',
  trader: '⇄',
  artist: '◆',
  'good-neighbor': '▲',
  'harbor-2026': '⚓',
  'raffle-regular': '●',
  'found-em-all': '★',
  'bracket-buster': '⚑',
  'summer-2026': '☼',
};
const STUB = { pink: styles.stubPink, aqua: styles.stubAqua, yellow: styles.stubYellow };

function memberSinceLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function DashboardView() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useSavedEvents();

  useEffect(() => {
    let alive = true;
    getDashboard()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Could not load'));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <main className={styles.page}>
        <div className={styles.errorCard} role="alert">
          <span className={ui.eyebrow}>Hmm</span>
          <h1 className={styles.errorTitle}>We couldn&apos;t load your dashboard</h1>
          <p>{error}</p>
          <Button href="/login" variant="yellow" size="sm">
            Log in again
          </Button>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <div className={authStyles.skeleton} aria-busy="true" aria-label="Loading your dashboard">
        <span />
        <span />
        <span />
      </div>
    );
  }

  const { me, progress, stats, badges } = data;
  const firstName = me.displayName.split(' ')[0] ?? me.displayName;
  // Hide events the user unsaved since load (optimistic) without refetching.
  const savedEvents: PublicEvent[] = saved.loaded
    ? data.savedEvents.filter((e) => saved.isSaved(e.id))
    : data.savedEvents;
  const pct = Math.round(progress.pct * 100);

  return (
    <main className={styles.page}>
      <nav className={styles.tabs} aria-label="Dashboard">
        <Link href="/dashboard" className={styles.tabActive} aria-current="page">
          My Dashboard
        </Link>
        <Link href="/#events">Events</Link>
        <a href="#badges">Badges</a>
        <span className={styles.tabAvatar} aria-hidden="true">
          {initials(me.displayName)}
        </span>
      </nav>

      <section className={styles.hero} aria-labelledby="level-heading">
        <div
          className={styles.ring}
          style={{ ['--pct' as string]: `${pct}%` }}
          role="img"
          aria-label={`Level ${progress.level}, ${pct}% to level ${progress.nextLevel ?? progress.level + 1}`}
        >
          <div className={styles.ringInner}>
            <span className={styles.ringLabel}>Level</span>
            <span className={styles.ringNumber}>{progress.level}</span>
          </div>
          <span className={styles.ringTag}>{progress.title}</span>
        </div>
        <div className={styles.heroBody}>
          <span className={ui.eyebrow}>Welcome back, {firstName}</span>
          <h1 id="level-heading" className={styles.heroTitle}>
            {progress.nextLevel
              ? `${progress.xpToNext.toLocaleString()} XP to Level ${progress.nextLevel}`
              : `Level ${progress.level} · max level!`}
          </h1>
          <div className={styles.bar} aria-hidden="true">
            <div className={styles.barFill} style={{ width: `${pct}%` }} />
            <span className={styles.barText}>
              {progress.xpIntoLevel.toLocaleString()} / {progress.xpForLevel.toLocaleString()} XP
            </span>
          </div>
          <div className={styles.stats}>
            <span>
              {stats.fests} {stats.fests === 1 ? 'fest' : 'fests'}
            </span>
            <span>·</span>
            <span>
              {stats.badgesEarned} {stats.badgesEarned === 1 ? 'badge' : 'badges'}
            </span>
            <span>·</span>
            <span>Member since {memberSinceLabel(stats.memberSince)}</span>
          </div>
        </div>
        <div className={styles.unlocks}>
          <span className={styles.unlocksEyebrow}>
            {progress.nextLevel ? `Level ${progress.nextLevel} unlocks` : 'You did it'}
          </span>
          <span className={styles.unlocksTitle}>
            {progress.nextUnlocks ??
              (progress.nextTitle ? `"${progress.nextTitle}" title` : 'Every perk there is')}
          </span>
          <span className={styles.unlocksText}>
            Earn XP at your next fest by checking in, finishing challenges and entering raffles.
          </span>
        </div>
      </section>

      <section id="badges" className={styles.card} aria-labelledby="badges-heading">
        <div className={styles.cardHead}>
          <h2 id="badges-heading" className={styles.cardTitle}>
            Badges
          </h2>
          <span className={styles.cardMeta}>
            {stats.badgesEarned} of {stats.badgesTotal} earned
          </span>
        </div>
        <ul className={styles.badges}>
          {badges.map((b, i) => (
            <li key={b.id} className={styles.badge}>
              <div
                className={`${styles.badgeCircle} ${b.earned ? BADGE_FILL[i % 3] : styles.badgeLocked}`}
                title={b.earned ? b.description : `Locked · ${b.description}`}
              >
                {b.earned ? (
                  b.artUrl ? (
                    <img src={b.artUrl} alt="" />
                  ) : (
                    (BADGE_GLYPHS[b.id] ?? b.title[0])
                  )
                ) : (
                  '?'
                )}
              </div>
              <span className={styles.badgeName}>{b.title}</span>
              <span className="sr-only">{b.earned ? 'Earned' : 'Locked'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.saved} aria-labelledby="saved-heading">
        <div className={styles.cardHead}>
          <h2 id="saved-heading" className={styles.cardTitle}>
            Saved upcoming events
          </h2>
          <Link href="/#events" className={styles.browse}>
            Browse all events →
          </Link>
        </div>
        {savedEvents.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Nothing saved yet</span>
            <span>Tap the heart on any event and it&apos;ll show up here with a countdown.</span>
            <Button href="/#events" variant="dark" size="sm">
              Find your next fest
            </Button>
          </div>
        ) : (
          <ul className={styles.savedGrid}>
            {savedEvents.map((ev, i) => {
              const color = stubColor(i);
              const count = countdownLabel(ev.startDate);
              return (
                <li key={ev.id} className={styles.mini}>
                  <div className={`${styles.stub} ${STUB[color]}`} aria-hidden="true">
                    <span className={styles.stubMon}>{monthAbbr(ev.startDate)}</span>
                    <span className={styles.stubDay}>{dayRange(ev.startDate, ev.endDate)}</span>
                  </div>
                  <div className={styles.miniBody}>
                    <div className={styles.miniRow}>
                      <a href={`/#event-${ev.slug}`} className={styles.miniName}>
                        {ev.name}
                      </a>
                      <HeartButton eventId={ev.id} slug={ev.slug} name={ev.name} size="sm" />
                    </div>
                    <span className={styles.miniCity}>
                      {ev.venue.city}, {ev.venue.state}
                    </span>
                    <span
                      className={`${styles.countdown} ${count.startsWith('In') || count === 'Today' || count === 'Tomorrow' ? styles.countdownSoon : ''}`}
                    >
                      {count}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className={styles.sync}>
        <span className={styles.phone} aria-hidden="true" />
        Coming soon: your level and badges sync with the FGG mobile app.
      </div>
    </main>
  );
}
