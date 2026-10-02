'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './Providers';
import { initials, isStaff } from '@/lib/auth';

const isVendor = (u: { roles: string[] } | null) => !!u && u.roles.includes('vendor');
import headerStyles from './Header.module.css';
import styles from './UserMenu.module.css';

/** Header slot: "Log In" link when signed out, initials avatar + menu when signed in. */
export function UserMenu() {
  const { status, user, logOut } = useAuth();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (status === 'loading') return <span className={styles.placeholder} aria-hidden="true" />;
  if (status === 'signed-out' || !user) {
    return (
      <Link href="/login" className={headerStyles.login}>
        Log In
      </Link>
    );
  }

  return (
    <div className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={styles.avatar}
        aria-label={`Account menu for ${user.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {initials(user.name)}
      </button>
      {open && (
        <div id={id} className={styles.menu} role="menu">
          <div className={styles.who}>
            <b>{user.name}</b>
            {user.email}
          </div>
          {isVendor(user) && (
            <Link
              href="/vendor"
              className={styles.item}
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              Vendor dashboard
            </Link>
          )}
          <Link
            href="/dashboard"
            className={styles.item}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            My Dashboard
          </Link>
          {isStaff(user) && (
            <>
              <Link
                href="/admin/vendor-applications"
                className={styles.item}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                Admin · Applications
              </Link>
              <Link
                href="/admin/orders"
                className={styles.item}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                Admin · Orders
              </Link>
              <Link
                href="/admin/users"
                className={styles.item}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                Admin · Users
              </Link>
            </>
          )}
          <button
            type="button"
            className={styles.item}
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await logOut();
              router.push('/');
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
