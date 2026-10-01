'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@fgg/types';
import { Button } from '@/components/Button';
import { useAuth } from '@/components/Providers';
import { hasApi } from '@/lib/api';
import { AuthCard, authStyles as styles } from './AuthCard';

/**
 * Renders children for signed-in users (optionally with one of `roles`),
 * redirects signed-out users to /login?next=..., shows a skeleton while loading.
 * Fixture preview: without an API, `?preview=1` bypasses the gate so screens can be checked.
 */
export function AuthGate({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const [preview, setPreview] = useState<boolean | null>(null);

  useEffect(() => {
    setPreview(!hasApi && new URLSearchParams(window.location.search).get('preview') === '1');
  }, []);

  useEffect(() => {
    if (preview === null || preview) return;
    if (status === 'signed-out') {
      const next = window.location.pathname + window.location.hash;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [status, preview, router]);

  if (preview) return <>{children}</>;
  if (preview === null || status === 'loading' || status === 'signed-out') {
    return (
      <div className={styles.skeleton} aria-busy="true" aria-label="Loading">
        <span />
        <span />
      </div>
    );
  }
  if (roles && !roles.some((r) => user?.roles.includes(r))) {
    return (
      <AuthCard eyebrow="Staff only" title="This page is for the FGG crew" tone="pink">
        <p className={styles.lead}>
          Your account doesn&apos;t have staff access. If it should, ask an admin to update your
          role.
        </p>
        <div>
          <Button href="/dashboard" variant="yellow" size="sm">
            Go to my dashboard
          </Button>
        </div>
      </AuthCard>
    );
  }
  return <>{children}</>;
}
