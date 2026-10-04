import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getHomeContent } from '@/lib/api';
import { fullDateLabel, year } from '@/lib/dates';
import { EventDetail } from './EventDetail';

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
  const when = fullDateLabel(
    ev.startDate,
    ev.endDate,
    year(ev.startDate) !== new Date().getFullYear(),
  );
  return {
    title: ev.name,
    description: `${when} at ${ev.venue.name}, ${ev.venue.city}. ${ev.blurb}`,
  };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const ev = await eventFor((await params).slug);
  if (!ev) notFound();
  return <EventDetail event={ev} />;
}
