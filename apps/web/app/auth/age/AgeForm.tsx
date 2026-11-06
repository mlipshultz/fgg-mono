'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { AuthCard, Field, authStyles as styles } from '@/components/auth/AuthCard';
import { useAuth } from '@/components/Providers';
import { ApiError, setBirthYear } from '@/lib/api';
import { MINIMUM_AGE, takeStashedBirthYear } from '@/lib/auth';
import { safeNext, useQuery } from '@/lib/useQuery';

/**
 * The 13+ screen for accounts made with Google, which arrive without a birthdate. A year typed
 * on the sign-up page before choosing Google is sent straight away. Under 13, the server removes
 * the account and we sign out.
 */
export function AgeForm() {
  const q = useQuery();
  const router = useRouter();
  const { status, logOut } = useAuth();
  const [year, setYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tooYoung, setTooYoung] = useState(false);
  const autoSent = useRef(false);
  const thisYear = new Date().getFullYear();
  const next = safeNext(q, '/dashboard');

  const send = useCallback(
    async (y: number) => {
      setBusy(true);
      setError(null);
      try {
        await setBirthYear({ birthYear: y });
        router.replace(next);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'under_age') {
          setTooYoung(true);
          await logOut().catch(() => undefined);
        } else {
          setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
        }
      } finally {
        setBusy(false);
      }
    },
    [logOut, next, router],
  );

  useEffect(() => {
    if (status === 'signed-out' && !tooYoung) router.replace('/login');
  }, [status, tooYoung, router]);

  useEffect(() => {
    if (status !== 'signed-in' || !q || autoSent.current) return;
    autoSent.current = true;
    const stashed = takeStashedBirthYear();
    if (stashed) {
      setYear(String(stashed));
      void send(stashed);
    }
  }, [status, q, send]);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const y = Number(year);
    if (!/^\d{4}$/.test(year) || y < 1900 || y > thisYear) {
      setError('Enter the year you were born');
      return;
    }
    // Under 13 goes to the server too: it removes the account the Google sign-in created.
    void send(y);
  };

  if (tooYoung) {
    return (
      <AuthCard
        eyebrow="Ask a parent"
        title="Let's sign up together"
        tone="pink"
        lead={
          <>
            FGG accounts are for fans {MINIMUM_AGE} and up. Kids can still earn XP and badges at
            every show on a parent&apos;s account, so grab a grown-up and sign up together.
          </>
        }
      >
        <div className={styles.actions}>
          <Button href="/signup" variant="primary" size="md">
            Sign up as a parent
          </Button>
          <Button href="/" variant="secondary" size="md">
            Back to the fest
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="One more step"
      title="What year were you born?"
      lead={`FGG accounts are for fans ${MINIMUM_AGE} and up. We only ask once.`}
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="Birth year" error={error ?? undefined} hint={`Fans ${MINIMUM_AGE}+ only`}>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            className={`${styles.input} ${error ? styles.invalid : ''}`}
            placeholder="YYYY"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            autoComplete="bday-year"
            aria-invalid={error ? true : undefined}
          />
        </Field>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
