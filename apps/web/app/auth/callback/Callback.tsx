'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Hub } from 'aws-amplify/utils';
import { Button } from '@/components/Button';
import { AuthCard, authStyles as styles } from '@/components/auth/AuthCard';
import { useAuth } from '@/components/Providers';
import { configureAmplify, hasAuth } from '@/lib/auth';

/** Google (hosted UI) returns here with ?code=; Amplify finishes the exchange on load. */
export function Callback() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!hasAuth) {
      setFailed('Accounts are not configured for this build.');
      return;
    }
    configureAmplify();
    const stop = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect')
        void refresh().then(() => router.replace('/dashboard'));
      if (payload.event === 'signInWithRedirect_failure')
        setFailed('Google sign-in was cancelled or failed.');
    });
    const timer = setTimeout(
      () => setFailed((f) => f ?? 'That took too long. Try logging in again.'),
      15000,
    );
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [refresh, router]);

  useEffect(() => {
    if (status === 'signed-in') router.replace('/dashboard');
  }, [status, router]);

  if (failed) {
    return (
      <AuthCard eyebrow="Hmm" title="We couldn't finish signing you in" tone="pink" lead={failed}>
        <div className={styles.actions}>
          <Button href="/login" variant="primary" size="md">
            Back to log in
          </Button>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard eyebrow="One sec" title="Signing you in…" lead="Finishing up with Google.">
      <span className={styles.spinner} role="status" aria-label="Loading" />
    </AuthCard>
  );
}
