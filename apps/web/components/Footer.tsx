import Link from 'next/link';
import type { PublicSettings } from '@fgg/types';
import { SOCIAL_LABELS, SOCIAL_NAMES, SocialIcon } from './SocialIcons';
import styles from './Footer.module.css';

export function Footer({ settings }: { settings?: PublicSettings }) {
  const email = settings?.contactEmail ?? 'hello@feelgoodgaming.com';
  return (
    <footer className={styles.footer}>
      <div className={styles.brandCol}>
        <Link href="/" className={styles.brand}>
          <img src="/fgg-logo.png" alt="" />
          <span>Feel Good Gaming</span>
        </Link>
        <span className={styles.blurb}>
          Family-friendly gaming and trading card events across Maryland.
        </span>
        <a href={`mailto:${email}`} className={styles.email}>
          {email}
        </a>
        <div className={styles.social}>
          {SOCIAL_NAMES.map((name) => (
            <a key={name} href={settings?.social[name] ?? '#'} aria-label={SOCIAL_LABELS[name]}>
              <SocialIcon name={name} />
            </a>
          ))}
        </div>
      </div>
      <div className={styles.col}>
        <b>Events</b>
        <Link href="/#events">Upcoming Events</Link>
        <Link href="/past-events">Past Events</Link>
        <Link href="/#activities">Activities</Link>
      </div>
      <div className={styles.col}>
        <b>Vendors &amp; Partners</b>
        <Link href="/vendor/book">Book a Table</Link>
        <Link href="/vendor/book">PokéBucks Program</Link>
        <Link href="/contact">Partner With Us</Link>
      </div>
      <div className={styles.col}>
        <b>Account</b>
        <Link href="/login">Log In</Link>
        <Link href="/signup">Attendee Sign Up</Link>
        <Link href="/vendor/apply">Vendor Sign Up</Link>
      </div>
      <div className={styles.legal}>
        © {new Date().getFullYear()} Feel Good Gaming LLC. All artwork and characters are original.
      </div>
    </footer>
  );
}
