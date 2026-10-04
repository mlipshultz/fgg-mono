'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  type EventFloorPlan,
  type EventVendor,
  type PublicEvent,
  SELLS_LABEL,
  type SellsCategory,
} from '@fgg/types';
import { HeartButton } from '@/components/home/HeartButton';
import { TablesLeft } from '@/components/home/TablesLeft';
import { WaitlistButton } from '@/components/home/WaitlistButton';
import ui from '@/components/ui.module.css';
import { BookCta } from '@/components/vendor/BookCta';
import { getEventFloorPlan, getEventVendors } from '@/lib/api';
import { initials } from '@/lib/auth';
import { dayLabel, fmtCents, fmtTime } from '@/lib/booking';
import { fullDateLabel, year } from '@/lib/dates';
import { type BookedTable, VenueMap } from './VenueMap';
import styles from './page.module.css';

const HERO_TAGS = 5;

function mapsHref(name: string, address: string | undefined, city: string, state: string) {
  const q = [name, address, `${city}, ${state}`].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function Logo({ v, className }: { v: EventVendor; className: string | undefined }) {
  return v.logoUrl ? (
    <img src={v.logoUrl} alt="" className={className} />
  ) : (
    <span className={`${className} ${styles.logoEmpty}`} aria-hidden="true">
      {initials(v.name)}
    </span>
  );
}

/** Event page: poster and facts up top, then about, the venue map and a filterable vendor list. */
export function EventDetail({ event: ev }: { event: PublicEvent }) {
  const [vendors, setVendors] = useState<EventVendor[] | null>(null);
  const [vendorsError, setVendorsError] = useState(false);
  const [plan, setPlan] = useState<EventFloorPlan | null>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<'all' | SellsCategory>('all');
  const [focus, setFocus] = useState<string | null>(null);
  /** Bumped on every Find on map so the highlighted tables flash again. */
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    let alive = true;
    getEventVendors(ev.id)
      .then((r) => alive && setVendors(r.vendors))
      .catch(() => alive && setVendorsError(true));
    getEventFloorPlan(ev.slug)
      .then((p) => alive && setPlan(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ev.id, ev.slug]);

  // Tags across every vendor, most common first; drives the hero chips and the filter row.
  const tagCounts = useMemo(() => {
    const m = new Map<SellsCategory, number>();
    for (const v of vendors ?? []) for (const t of v.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [vendors]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (vendors ?? []).filter(
      (v) =>
        (tag === 'all' || v.tags.includes(tag)) &&
        (!q || v.name.toLowerCase().includes(q) || v.sellsDescription.toLowerCase().includes(q)),
    );
  }, [vendors, query, tag]);

  const booked = useMemo(() => {
    const m = new Map<string, BookedTable>();
    for (const v of vendors ?? [])
      for (const t of v.tables) m.set(t.tableId, { vendorId: v.vendorId, name: v.name });
    return m;
  }, [vendors]);

  const thisYear = new Date().getFullYear();
  const dates = fullDateLabel(ev.startDate, ev.endDate, year(ev.startDate) !== thisYear);
  const count = vendors?.length ?? 0;

  const jumpToVendor = (vendorId: string) => {
    setFocus(vendorId);
    setTag('all');
    setQuery('');
    document
      .getElementById(`vendor-${vendorId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const findOnMap = (vendorId: string) => {
    setFocus(vendorId);
    setFlash((n) => n + 1);
    // Only move the page when the map isn't already on screen.
    const map = document.getElementById('venue-map');
    const r = map?.getBoundingClientRect();
    if (r && (r.bottom < 120 || r.top > window.innerHeight - 160))
      map?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="event-title">
        <div className={styles.poster}>
          {ev.posterUrl ? (
            <img src={ev.posterUrl} alt={`${ev.name} poster`} className={styles.posterImg} />
          ) : (
            <span className={styles.posterEmpty}>Poster coming soon</span>
          )}
        </div>
        <div className={styles.info}>
          <span className={ui.eyebrow}>{dates}</span>
          <h1 id="event-title" className={styles.title}>
            {ev.name}
          </h1>
          {tagCounts.length > 0 && (
            <div className={styles.heroTags} aria-label="What vendors are bringing">
              {tagCounts.slice(0, HERO_TAGS).map(([t]) => (
                <span key={t} className={styles.tag}>
                  {SELLS_LABEL[t]}
                </span>
              ))}
              {tagCounts.length > HERO_TAGS && (
                <a href="#vendors" className={`${styles.tag} ${styles.tagMore}`}>
                  +{tagCounts.length - HERO_TAGS}
                </a>
              )}
            </div>
          )}
          <div className={styles.facts}>
            <div className={styles.fact}>
              <span className={styles.factIcon} aria-hidden="true">
                ◎
              </span>
              <div>
                <a
                  className={styles.factTitle}
                  href={mapsHref(ev.venue.name, plan?.venue.address, ev.venue.city, ev.venue.state)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {ev.venue.name} ↗
                </a>
                <span className={styles.factSub}>
                  {plan?.venue.address ? `${plan.venue.address}, ` : ''}
                  {ev.venue.city}, {ev.venue.state}
                </span>
              </div>
            </div>
            <div className={styles.fact}>
              <span className={styles.factIcon} aria-hidden="true">
                ▦
              </span>
              <div>
                <span className={styles.factTitle}>{dates}</span>
                <span className={styles.factSub}>
                  {ev.days.map((d) => (
                    <span key={d.date} className={styles.hoursLine}>
                      {ev.days.length > 1 ? `${dayLabel(d.date)} · ` : ''}
                      {fmtTime(d.opens)}–{fmtTime(d.closes)}
                    </span>
                  ))}
                </span>
              </div>
              {ev.days.length > 1 && (
                <span className={`${ui.pill} ${styles.daysPill}`}>{ev.days.length} days</span>
              )}
            </div>
            <a href="#vendors" className={styles.vendorsRow}>
              <span className={styles.avatars} aria-hidden="true">
                {(vendors ?? []).slice(0, 5).map((v) => (
                  <Logo key={v.vendorId} v={v} className={styles.avatar} />
                ))}
                {count > 5 && (
                  <span className={`${styles.avatar} ${styles.avatarMore}`}>+{count - 5}</span>
                )}
              </span>
              <span className={styles.vendorsText}>
                {vendors === null
                  ? 'Vendors'
                  : count === 0
                    ? 'Vendor list coming together'
                    : `${count} ${count === 1 ? 'vendor' : 'vendors'} so far`}
              </span>
              <span className={styles.chev} aria-hidden="true">
                →
              </span>
            </a>
          </div>
          <div className={styles.ctaCard}>
            <div className={styles.ctaRow}>
              <div>
                <span className={styles.ctaLabel}>
                  Tables from {fmtCents(ev.tablesFromCents ?? ev.tableRateCents)}/day
                </span>
                <span className={styles.ctaSub}>
                  {ev.vendorStatus === 'open' && (
                    <>
                      Open · <TablesLeft eventId={ev.id} initial={ev.tablesLeft} />
                    </>
                  )}
                  {ev.vendorStatus === 'closed' && 'Sold out · join the waitlist'}
                  {ev.vendorStatus === 'coming_soon' && 'Booking opens soon'}
                </span>
              </div>
              {ev.vendorStatus === 'open' && <BookCta slug={ev.slug} />}
              {ev.vendorStatus === 'closed' && <WaitlistButton eventId={ev.id} kind="waitlist" />}
              {ev.vendorStatus === 'coming_soon' && (
                <WaitlistButton eventId={ev.id} kind="notify_me" />
              )}
            </div>
            <div className={styles.ctaRow}>
              <div>
                <span className={styles.ctaLabel}>Going?</span>
                <span className={styles.ctaSub}>Save it to your dashboard.</span>
              </div>
              <HeartButton eventId={ev.id} slug={ev.slug} name={ev.name} />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="about-title">
        <h2 id="about-title" className={styles.h2}>
          About
        </h2>
        <p className={styles.about}>{ev.blurb}</p>
      </section>

      {plan && (
        <section className={styles.section} id="venue-map" aria-labelledby="map-title">
          <div className={styles.sectionHead}>
            <h2 id="map-title" className={styles.h2}>
              Venue map
            </h2>
            <span className={styles.sectionNote}>Tap a booked table to see who&apos;s there.</span>
          </div>
          <VenueMap
            plan={plan.floorPlan}
            booked={booked}
            focus={focus}
            flash={flash}
            onPick={jumpToVendor}
          />
        </section>
      )}

      <section className={styles.section} id="vendors" aria-labelledby="vendors-title">
        <div className={styles.sectionHead}>
          <h2 id="vendors-title" className={styles.h2}>
            Vendors{vendors && count > 0 ? ` · ${count}` : ''}
          </h2>
          <input
            type="search"
            className={styles.search}
            placeholder="Search vendors"
            aria-label="Search vendors"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {tagCounts.length > 0 && (
          <div className={styles.filters} role="group" aria-label="Filter by tag">
            <button
              type="button"
              className={styles.filter}
              aria-pressed={tag === 'all'}
              onClick={() => setTag('all')}
            >
              All
            </button>
            {tagCounts.map(([t, n]) => (
              <button
                key={t}
                type="button"
                className={styles.filter}
                aria-pressed={tag === t}
                onClick={() => setTag((cur) => (cur === t ? 'all' : t))}
              >
                {SELLS_LABEL[t]} <span className={styles.filterCount}>{n}</span>
              </button>
            ))}
          </div>
        )}
        {vendorsError ? (
          <p className={styles.empty}>We couldn&apos;t load the vendor list. Try again in a bit.</p>
        ) : vendors === null ? (
          <div className={styles.grid} aria-busy="true" aria-label="Loading vendors">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`${styles.card} ${styles.skeleton}`} />
            ))}
          </div>
        ) : vendors.length === 0 ? (
          <div className={styles.emptyCard}>
            <span className={styles.emptyTitle}>The vendor list is coming together</span>
            <span className={styles.empty}>
              Vendors appear here as soon as their table is booked. Check back closer to the show.
            </span>
          </div>
        ) : shown.length === 0 ? (
          <div className={styles.emptyCard}>
            <span className={styles.emptyTitle}>No vendors match</span>
            <span className={styles.empty}>Try another tag or clear the search.</span>
          </div>
        ) : (
          <div className={styles.grid}>
            {shown.map((v) => (
              <article
                key={v.vendorId}
                id={`vendor-${v.vendorId}`}
                className={`${styles.card} ${focus === v.vendorId ? styles.cardHot : ''}`}
              >
                <div className={styles.cardHead}>
                  <Logo v={v} className={styles.logo} />
                  <h3 className={styles.name}>{v.name}</h3>
                </div>
                {v.tags.length > 0 && (
                  <div className={styles.cardTags}>
                    {v.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`${styles.tag} ${styles.tagSmall}`}
                        onClick={() => setTag(t)}
                      >
                        {SELLS_LABEL[t]}
                      </button>
                    ))}
                  </div>
                )}
                <p className={styles.sells}>{v.sellsDescription || 'Details coming soon.'}</p>
                <div className={styles.cardFoot}>
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
                  {plan && (
                    <button
                      type="button"
                      className={styles.findLink}
                      onClick={() => findOnMap(v.vendorId)}
                    >
                      Find on map
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        <p className={styles.backRow}>
          <Link href="/#events" className={styles.backLink}>
            ← All events
          </Link>
        </p>
      </section>
    </main>
  );
}
