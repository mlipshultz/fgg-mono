import type { Metadata } from 'next';
import ui from '@/components/ui.module.css';
import { getGalleryPage } from '@/lib/api';
import { Gallery } from './Gallery';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Past events',
  description: 'Photos, videos and highlights from every Feel Good Gaming fest so far.',
};

export default async function PastEventsPage() {
  const page = await getGalleryPage();
  return (
    <main className={styles.page}>
      <div>
        <span className={ui.eyebrow}>Past events</span>
        <h1 className={ui.h2}>Every fest so far</h1>
      </div>
      <Gallery initial={page} />
    </main>
  );
}
