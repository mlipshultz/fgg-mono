import Link from 'next/link';
import { Button } from './Button';
import { MobileMenu, type NavLink } from './MobileMenu';
import { UserMenu } from './UserMenu';
import styles from './Header.module.css';

export const NAV_LINKS: NavLink[] = [
  { href: '/#events', label: 'Events' },
  { href: '/#activities', label: 'Activities' },
  { href: '/past-events', label: 'Past Events' },
  { href: '/#partners', label: 'Partners' },
  { href: '/#get-involved', label: 'Get Involved' },
];

export function Header() {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Feel Good Gaming home">
        <img src="/fgg-logo.png" alt="" className={styles.logo} />
        <span className={styles.brandName}>Feel Good Gaming</span>
        <span className={styles.brandShort}>FGG</span>
      </Link>
      <nav className={styles.nav} aria-label="Primary">
        {NAV_LINKS.map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className={styles.right}>
        <UserMenu />
        <Button href="/#events" variant="yellow" size="md" className={styles.eventsDesktop}>
          Upcoming Events
        </Button>
        <Button href="/#events" variant="yellow" size="sm" className={styles.eventsPhone}>
          Events
        </Button>
        <MobileMenu links={NAV_LINKS} />
      </div>
    </header>
  );
}
