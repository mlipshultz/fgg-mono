'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Hub } from 'aws-amplify/utils';
import { Button } from '@/components/Button';
import { AuthCard, authStyles as styles } from '@/components/auth/AuthCard';
import { useAuth } from '@/components/Providers';
import { getMe } from '@/lib/api';
import { configureAmplify, hasAuth, takeGoogleNext } from '@/lib/auth';
import { safePath } from '@/lib/useQuery';

/**
 * Google (hosted UI) returns here with ?code=; Amplify finishes the exchange on load. Then on to
 * where the visitor was going (kept across the trip), through the 13+ screen first if the
 * account has never given a birth year.
 */
export function Callback() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const [failed, setFailed] = useState<string | null>(null);
  const done = useRef(false);

  const finish = useCallback(async () => {
    if (done.current) return;
    done.current = true;
    const next = safePath(takeGoogleNext()) ?? '/dashboard';
    try {
      const me = await getMe();
      if (me.needsBirthYear) {
        router.replace(`/auth/age/?next=${encodeURIComponent(next)}`);
        return;
      }
    } catch {
      // The age screen is enforced by the API too; carry on and let it redirect if needed.
    }
    router.replace(next);
  }, [router]);

  useEffect(() => {
    if (!hasAuth) {
      setFailed('Accounts are not configured for this build.');
      return;
    }
    configureAmplify();
    const stop = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect') void refresh().then(finish);
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
  }, [refresh, finish]);

  useEffect(() => {
    if (status === 'signed-in') void finish();
  }, [status, finish]);

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
