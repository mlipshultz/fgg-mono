import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ui from '@/components/ui.module.css';
import { BookCta } from '@/components/vendor/BookCta';
import { getHomeContent } from '@/lib/api';
import { fullDateLabel, year } from '@/lib/dates';
import { EventVendors } from './EventVendors';
import styles from './page.module.css';

// Static export: one page per upcoming event, built from the same content as the homepage.
export const dynamicParams = false;

export async function generateStaticParams() {
  const home = await getHomeContent();
  return home.events.map((e) => ({ slug: e.slug }));
}

async function eventFor(slug: string) {
  const home = await getHomeContent();
  return home.events.find((e) => e.slug === slug);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const ev = await eventFor((await params).slug);
  if (!ev) return {};
  return {
    title: `Who's vending at ${ev.name}`,
    description: `Every vendor with a table at ${ev.name} and what they're bringing.`,
  };
}

export default async function EventVendorsPage({ params }: { params: Promise<{ slug: string }> }) {
  const ev = await eventFor((await params).slug);
  if (!ev) notFound();
  const thisYear = new Date().getFullYear();
  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <span className={ui.eyebrow}>Who&apos;s vending</span>
          <h1 className={ui.h2}>{ev.name}</h1>
          <p className={styles.meta}>
            <b>{ev.venue.name}</b> · {ev.venue.city}, {ev.venue.state}
            <br />
            {fullDateLabel(ev.startDate, ev.endDate, year(ev.startDate) !== thisYear)} ·{' '}
            {ev.hoursLabel}
          </p>
        </div>
        <div className={styles.headActions}>
          {ev.vendorStatus === 'open' && <BookCta slug={ev.slug} />}
          <Link href={`/#event-${ev.slug}`} className={styles.backLink}>
            ← Event details
          </Link>
        </div>
      </div>
      <EventVendors event={ev} />
    </main>
  );
}
