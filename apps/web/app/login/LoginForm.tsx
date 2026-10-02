'use client';

import { type FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { AuthCard, Field, GoogleGlyph, authStyles as styles } from '@/components/auth/AuthCard';
import { useAuth } from '@/components/Providers';
import { friendlyAuthError, googleSignIn, hasAuth, hasGoogle, signIn } from '@/lib/auth';
import { safeNext, useQuery } from '@/lib/useQuery';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
  const q = useQuery();
  const router = useRouter();
  const { refresh, status } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = safeNext(q, '/dashboard');

  // Already signed in: there is nothing to do here.
  useEffect(() => {
    if (status === 'signed-in') router.replace(next);
  }, [status, next, router]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e: typeof errors = {};
    if (!email.trim()) e.email = 'Enter your email';
    else if (!EMAIL_RE.test(email.trim())) e.email = "Hmm, that email doesn't look right";
    if (!password) e.password = 'Enter your password';
    setErrors(e);
    if (Object.keys(e).length) return;
    if (!hasAuth) {
      setFormError('Accounts are not configured for this build.');
      return;
    }
    setBusy(true);
    setFormError(null);
    setUnconfirmed(false);
    try {
      const result = await signIn(email, password);
      if (result === 'confirm') {
        router.push(`/verify?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      if (result === 'done') {
        await refresh();
        router.push(next);
        return;
      }
      setFormError('This account needs an extra step we don’t support yet. Contact us for help.');
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'UserNotConfirmedException') setUnconfirmed(true);
      setFormError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      eyebrow="Welcome back"
      title="Log in to FGG"
      lead="Your XP, badges and saved events are waiting."
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="Email" error={errors.email}>
          <input
            type="email"
            className={`${styles.input} ${errors.email ? styles.invalid : ''}`}
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
          />
        </Field>
        <Field
          label="Password"
          error={errors.password}
          action={<Link href="/forgot">Forgot it?</Link>}
        >
          <input
            type="password"
            className={`${styles.input} ${errors.password ? styles.invalid : ''}`}
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
          />
        </Field>
        {formError && (
          <span className={styles.formError} role="alert">
            {formError}{' '}
            {unconfirmed && (
              <Link href={`/verify?email=${encodeURIComponent(email.trim())}`}>Verify now →</Link>
            )}
          </span>
        )}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </Button>
          {hasGoogle && (
            <>
              <span className={styles.or}>or</span>
              <Button
                type="button"
                variant="secondary"
                size="md"
                block
                className={styles.google}
                onClick={() => void googleSignIn()}
              >
                <GoogleGlyph /> Continue with Google
              </Button>
            </>
          )}
        </div>
      </form>
      <span className={styles.alt}>
        New here? <Link href="/signup">Create a free account</Link>
      </span>
    </AuthCard>
  );
}
