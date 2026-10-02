'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { AuthCard, Field, authStyles as styles } from '@/components/auth/AuthCard';
import { confirmSignUp, friendlyAuthError, resendCode } from '@/lib/auth';
import { useQuery } from '@/lib/useQuery';

export function VerifyForm() {
  const q = useQuery();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (q?.get('email')) setEmail(q.get('email') ?? '');
  }, [q]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!email.trim()) return setError('Enter the email you signed up with');
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from your email');
    setBusy(true);
    setError(null);
    try {
      await confirmSignUp(email, code);
      setDone(true);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!email.trim()) return setError('Enter the email you signed up with');
    setError(null);
    try {
      await resendCode(email);
      setNotice('A fresh code is on its way.');
    } catch (err) {
      setError(friendlyAuthError(err));
    }
  };

  if (done) {
    return (
      <AuthCard
        eyebrow="All set"
        tone="aqua"
        title={
          <span className={styles.successHead}>
            <span className={styles.successCheck} aria-hidden="true">
              ✓
            </span>
            You&apos;re verified!
          </span>
        }
        lead="Log in to see your dashboard and start earning XP at the next show."
      >
        <div className={styles.actions}>
          <Button href="/login" variant="primary" size="lg" block>
            Log in
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="Check your email"
      title="Enter your code"
      lead={
        <>
          We sent a 6-digit code to <b>{email || 'your email'}</b>. It can take a minute to arrive.
        </>
      }
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        {!q?.get('email') && (
          <Field label="Email">
            <input
              type="email"
              className={styles.input}
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>
        )}
        <Field label="Verification code">
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            className={`${styles.input} ${styles.code} ${error ? styles.invalid : ''}`}
            placeholder="······"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="one-time-code"
            aria-invalid={error ? true : undefined}
          />
        </Field>
        {error && (
          <span className={styles.formError} role="alert">
            {error}
          </span>
        )}
        {notice && (
          <span className={styles.hint} role="status">
            {notice}
          </span>
        )}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? 'Checking…' : 'Verify my email'}
          </Button>
        </div>
      </form>
      <span className={styles.alt}>
        Didn&apos;t get it?{' '}
        <button type="button" className={styles.linkBtn} onClick={() => void resend()}>
          Send a new code
        </button>
      </span>
    </AuthCard>
  );
}
