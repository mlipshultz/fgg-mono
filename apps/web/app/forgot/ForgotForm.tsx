'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { AuthCard, Field, authStyles as styles } from '@/components/auth/AuthCard';
import { friendlyAuthError, resetPassword } from '@/lib/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError("Hmm, that email doesn't look right");
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email);
      router.push(`/reset?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      eyebrow="Forgot your password?"
      title="No sweat"
      lead="Enter your email and we'll send a code to set a new one."
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="Email" error={error ?? undefined}>
          <input
            type="email"
            className={`${styles.input} ${error ? styles.invalid : ''}`}
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={error ? true : undefined}
          />
        </Field>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? 'Sending…' : 'Send me a code'}
          </Button>
        </div>
      </form>
      <span className={styles.alt}>
        Remembered it? <Link href="/login">Log in</Link>
      </span>
    </AuthCard>
  );
}
