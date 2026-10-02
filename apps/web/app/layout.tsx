import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Fredoka, Nunito } from 'next/font/google';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Providers } from '@/components/Providers';
import { getHomeContent } from '@/lib/api';
import './globals.css';

const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-fredoka',
  display: 'swap',
});

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800', '900'],
  variable: '--font-nunito',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Feel Good Gaming', template: '%s · Feel Good Gaming' },
  description:
    'The feel-good card & gaming fest. Family shows across Maryland where kids trade, play and earn XP.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { settings } = await getHomeContent();
  return (
    <html lang="en" className={`${fredoka.variable} ${nunito.variable}`}>
      <body>
        <Providers>
          <Header />
          {children}
          <Footer settings={settings} />
        </Providers>
      </body>
    </html>
  );
}
