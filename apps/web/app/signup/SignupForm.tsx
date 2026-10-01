'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { AuthCard, Field, GoogleGlyph, authStyles as styles } from '@/components/auth/AuthCard';
import {
  friendlyAuthError,
  googleSignIn,
  hasAuth,
  hasGoogle,
  isOldEnough,
  MINIMUM_AGE,
  passwordProblem,
  signUp,
} from '@/lib/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Errors = Partial<Record<'name' | 'email' | 'year' | 'password' | 'confirm' | 'terms', string>>;

export function SignupForm() {
  const router = useRouter();
  const thisYear = new Date().getFullYear();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [year, setYear] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tooYoung, setTooYoung] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e: Errors = {};
    const y = Number(year);
    if (!name.trim()) e.name = 'What should we call you?';
    if (!email.trim()) e.email = 'Enter your email';
    else if (!EMAIL_RE.test(email.trim())) e.email = "Hmm, that email doesn't look right";
    if (!/^\d{4}$/.test(year) || y < 1900 || y > thisYear) e.year = 'Enter the year you were born';
    const pw = passwordProblem(password);
    if (pw) e.password = pw;
    if (confirm !== password) e.confirm = "Those passwords don't match";
    if (!terms) e.terms = 'Please agree to the terms to continue';
    setErrors(e);
    if (Object.keys(e).length) return;
    if (!isOldEnough(y)) {
      setTooYoung(true);
      return;
    }
    if (!hasAuth) {
      setFormError('Accounts are not configured for this build.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await signUp({ name, email, birthYear: y, password });
      router.push(`/verify?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    } catch (err) {
      setFormError(friendlyAuthError(err));
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
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => {
              setTooYoung(false);
              setYear('');
            }}
          >
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
      eyebrow="Free account"
      title="Join the fest"
      lead="Earn XP at every show, unlock badges and save the events you're going to."
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="Name" error={errors.name}>
          <input
            className={`${styles.input} ${errors.name ? styles.invalid : ''}`}
            placeholder="How should we call you?"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            aria-invalid={errors.name ? true : undefined}
          />
        </Field>
        <div className={styles.two}>
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
        </div>
        <Field
          label="Password"
          error={errors.password}
          hint="At least 8 characters, with a lowercase letter and a number."
        >
          <input
            type="password"
            className={`${styles.input} ${errors.password ? styles.invalid : ''}`}
            placeholder="Make it a good one"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
          />
        </Field>
        <Field label="Confirm password" error={errors.confirm}>
          <input
            type="password"
            className={`${styles.input} ${errors.confirm ? styles.invalid : ''}`}
            placeholder="One more time"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-invalid={errors.confirm ? true : undefined}
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
        {formError && (
          <span className={styles.formError} role="alert">
            {formError}
          </span>
        )}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? 'Creating your account…' : 'Create my account'}
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
        Already have an account? <Link href="/login">Log in</Link>
      </span>
    </AuthCard>
  );
}
