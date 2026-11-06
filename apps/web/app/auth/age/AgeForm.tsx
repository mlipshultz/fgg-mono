'use client';

import { type FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { AuthCard, Field, authStyles as styles } from '@/components/auth/AuthCard';
import { useAuth } from '@/components/Providers';
import { ApiError, setBirthYear } from '@/lib/api';
import { MINIMUM_AGE } from '@/lib/auth';
import { safeNext, useQuery } from '@/lib/useQuery';

/**
 * "One more step" for accounts made with Google, which arrive without a birthdate and haven't
 * seen the sign-up form's terms: birth year (13+) and the terms, once. Under 13, the server
 * removes the account and we sign out.
 */
export function AgeForm() {
  const q = useQuery();
  const router = useRouter();
  const { status, logOut } = useAuth();
  const [year, setYear] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<{ year?: string; terms?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [tooYoung, setTooYoung] = useState(false);
  const thisYear = new Date().getFullYear();
  const next = safeNext(q, '/dashboard');

  useEffect(() => {
    if (status === 'signed-out' && !tooYoung) router.replace('/login');
  }, [status, tooYoung, router]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const y = Number(year);
    const e: typeof errors = {};
    if (!/^\d{4}$/.test(year) || y < 1900 || y > thisYear) e.year = 'Enter the year you were born';
    if (!terms) e.terms = 'Please agree to the terms to continue';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      // Under 13 goes to the server too: it removes the account the Google sign-in created.
      await setBirthYear({ birthYear: y });
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'under_age') {
        setTooYoung(true);
        await logOut().catch(() => undefined);
      } else {
        setErrors({
          form: err instanceof Error ? err.message : 'Something went wrong. Try again.',
        });
      }
    } finally {
      setBusy(false);
    }
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
      title="Finish setting up your account"
      lead={`FGG accounts are for fans ${MINIMUM_AGE} and up. We only ask once.`}
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="Birth year" error={errors.year} hint={`Fans ${MINIMUM_AGE}+ only`}>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            className={`${styles.input} ${errors.year ? styles.invalid : ''}`}
            placeholder="YYYY"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            autoComplete="bday-year"
            aria-invalid={errors.year ? true : undefined}
          />
        </Field>
        <label className={styles.check}>
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>
            I agree to the <Link href="/terms">terms</Link> and{' '}
            <Link href="/privacy">privacy policy</Link>.
          </span>
        </label>
        {errors.terms && (
          <span className={styles.error} role="alert">
            {errors.terms}
          </span>
        )}
        {errors.form && (
          <span className={styles.formError} role="alert">
            {errors.form}
          </span>
        )}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
