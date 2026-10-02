import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Providers } from '@/components/Providers';
import { getHomeContent } from '@/lib/api';
import './globals.css';

// Self-hosted (handoff §9): variable latin subsets, OFL. Avoids fetching Google Fonts at build.
const fredoka = localFont({
  src: [{ path: './fonts/fredoka-normal-latin.woff2', weight: '300 700', style: 'normal' }],
  variable: '--font-fredoka',
  display: 'swap',
});

const nunito = localFont({
  src: [
    { path: './fonts/nunito-normal-latin.woff2', weight: '200 1000', style: 'normal' },
    { path: './fonts/nunito-italic-latin.woff2', weight: '200 1000', style: 'italic' },
  ],
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
