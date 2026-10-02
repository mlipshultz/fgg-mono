'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { useAuth } from '@/components/Providers';
import { authStyles } from '@/components/auth/AuthCard';
import ui from '@/components/ui.module.css';
import { getVendorStanding, hasApi } from '@/lib/api';

/**
 * Vendor-only pages: signed-out → login (and back), applicants → /vendor/pending,
 * everyone else → /vendor/apply. `?preview=1` bypasses in fixture mode.
 *
 * Roles live in the ID token, which can lag the server (approval happens between sign-ins),
 * so when the token lacks `vendor` we ask the API first and force a token refresh if the
 * account is in fact an approved vendor. That avoids bouncing between /vendor and /vendor/apply.
 */
export function VendorGate({ children }: { children: ReactNode }) {
  const { status, user, refresh, logOut } = useAuth();
  const router = useRouter();
  const [preview, setPreview] = useState<boolean | null>(null);
  const [stale, setStale] = useState(false);
  const refreshed = useRef(false);

  useEffect(() => {
    setPreview(!hasApi && new URLSearchParams(window.location.search).get('preview') === '1');
  }, []);

  useEffect(() => {
    if (preview === null || preview) return;
    const here = window.location.pathname + window.location.search;
    if (status === 'signed-out') {
      router.replace(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    if (status !== 'signed-in' || !user) return;
    if (user.roles.includes('vendor')) return;
    let alive = true;
    void (async () => {
      let approved = false;
      try {
        approved = !!(await getVendorStanding()).vendor;
      } catch {
        /* fall through to the role-based redirect */
      }
      if (!alive) return;
      if (approved) {
        if (!refreshed.current) {
          refreshed.current = true;
          await refresh(true);
          return; // the new user object re-runs this effect
        }
        setStale(true); // refresh didn't surface the role; ask for a sign-out
        return;
      }
      if (user.roles.includes('vendor_applicant')) router.replace('/vendor/pending');
      else {
        const ev = new URLSearchParams(window.location.search).get('event');
        router.replace(ev ? `/vendor/apply?event=${encodeURIComponent(ev)}` : '/vendor/apply');
      }
    })();
    return () => {
      alive = false;
    };
  }, [status, user, preview, router, refresh]);

  if (preview) return <>{children}</>;
  if (stale) {
    return (
      <div className={authStyles.page}>
        <div className={`${authStyles.card} ${authStyles.cardAqua}`}>
          <span className={ui.eyebrow}>You&apos;re approved</span>
          <h1 className={authStyles.title}>One more sign-in</h1>
          <p className={authStyles.lead}>
            Your vendor access is ready, but this session still has your old permissions. Log out
            and back in to start booking.
          </p>
          <div className={authStyles.actions}>
            <Button type="button" variant="primary" size="md" onClick={() => void logOut()}>
              Log out
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (preview === null || status !== 'signed-in' || !user?.roles.includes('vendor')) {
    return (
      <div className={authStyles.skeleton} aria-busy="true" aria-label="Loading">
        <span />
        <span />
      </div>
    );
  }
  return <>{children}</>;
}
