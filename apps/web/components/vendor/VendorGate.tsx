'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/Providers';
import { authStyles } from '@/components/auth/AuthCard';
import { hasApi } from '@/lib/api';

/**
 * Vendor-only pages: signed-out → login (and back), applicants → /vendor/pending,
 * everyone else → /vendor/apply. `?preview=1` bypasses in fixture mode.
 */
export function VendorGate({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const [preview, setPreview] = useState<boolean | null>(null);

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
    if (user.roles.includes('vendor_applicant')) router.replace('/vendor/pending');
    else {
      const ev = new URLSearchParams(window.location.search).get('event');
      router.replace(ev ? `/vendor/apply?event=${encodeURIComponent(ev)}` : '/vendor/apply');
    }
  }, [status, user, preview, router]);

  if (preview) return <>{children}</>;
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
