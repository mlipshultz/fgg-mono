import type { Metadata } from 'next';
import { Hero } from '@/components/home/Hero';
import { Calendar } from '@/components/home/Calendar';
import { EventCards } from '@/components/home/EventCard';
import { Activities } from '@/components/home/Activities';
import { AccountsTeaser } from '@/components/home/AccountsTeaser';
import { Partners } from '@/components/home/Partners';
import { GetInvolved } from '@/components/home/GetInvolved';
import { PastEventsTeaser } from '@/components/home/PastEventsTeaser';
import { EmailBand } from '@/components/home/EmailBand';
import { getHomeContent } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Feel Good Gaming · The feel-good card & gaming fest',
  description:
    'Family-friendly card and gaming fests across Maryland. See upcoming events, book a vendor table, and earn XP at every show.',
};

export default async function HomePage() {
  const home = await getHomeContent();
  const discordUrl = home.settings.discordInviteUrl ?? home.settings.social.discord;
  return (
    <main>
      <Hero events={home.events} settings={home.settings} />
      <Calendar events={home.events} />
      <EventCards events={home.events} />
      <Activities activities={home.activities} />
      <AccountsTeaser />
      <Partners partners={home.partners} />
      <GetInvolved settings={home.settings} />
      <PastEventsTeaser items={home.galleryTeaser} pastEvents={home.pastEvents} />
      <EmailBand discordUrl={discordUrl} />
    </main>
  );
}
