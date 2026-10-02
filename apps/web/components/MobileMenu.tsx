'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from './Button';
import { useAuth } from './Providers';
import { isStaff } from '@/lib/auth';
import styles from './MobileMenu.module.css';

export interface NavLink {
  href: string;
  label: string;
}

export function MobileMenu({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { status, user, logOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={styles.burger}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(true)}
      >
        <span />
        <span />
        <span />
      </button>
      {open && (
        <div id={id} className={styles.overlay} role="dialog" aria-modal="true" aria-label="Menu">
          <div className={styles.top}>
            <span className={styles.brand}>
              <img src="/fgg-logo.png" alt="" />
              FGG
            </span>
            <button
              type="button"
              className={styles.close}
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <ul className={styles.links}>
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)}>
                  {l.label}
                </Link>
              </li>
            ))}
            {status === 'signed-in' && (
              <li>
                <Link href="/dashboard" onClick={() => setOpen(false)}>
                  My Dashboard
                </Link>
              </li>
            )}
            {status === 'signed-in' && isStaff(user) && (
              <li>
                <Link href="/admin/users" onClick={() => setOpen(false)}>
                  Admin
                </Link>
              </li>
            )}
          </ul>
          <div className={styles.actions}>
            {status === 'signed-in' && user && (
              <span className={styles.who}>
                Logged in as <b>{user.name}</b>
              </span>
            )}
            <Button href="/#events" variant="yellow" size="lg" block onClick={() => setOpen(false)}>
              Upcoming Events
            </Button>
            {status === 'signed-in' ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                block
                onClick={async () => {
                  setOpen(false);
                  await logOut();
                  router.push('/');
                }}
              >
                Log out
              </Button>
            ) : (
              <Button
                href="/login"
                variant="secondary"
                size="md"
                block
                onClick={() => setOpen(false)}
              >
                Log In
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
