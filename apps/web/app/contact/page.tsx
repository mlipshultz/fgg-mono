import type { Metadata } from 'next';
import ui from '@/components/ui.module.css';
import { getHomeContent } from '@/lib/api';
import { ContactForm } from './ContactForm';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Partner with us',
  description:
    'Sponsorships, venue hosting, activity partners and school groups. Tell us the idea.',
};

export default async function ContactPage() {
  const { settings } = await getHomeContent();
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div>
          <span className={ui.eyebrow}>Partner with us</span>
          <h1 className={styles.title}>Let&apos;s make something fun</h1>
          <p className={styles.lead}>
            Sponsorships, venue hosting, activity partners, school groups — tell us the idea and
            we&apos;ll reply within two business days.
          </p>
        </div>
        <ContactForm contactEmail={settings.contactEmail} />
      </div>
    </main>
  );
}
