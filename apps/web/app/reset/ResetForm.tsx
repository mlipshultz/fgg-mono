'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { AuthCard, Field, authStyles as styles } from '@/components/auth/AuthCard';
import { confirmResetPassword, friendlyAuthError, passwordProblem } from '@/lib/auth';
import { useQuery } from '@/lib/useQuery';

type Errors = Partial<Record<'email' | 'code' | 'password' | 'confirm', string>>;

export function ResetForm() {
  const q = useQuery();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (q?.get('email')) setEmail(q.get('email') ?? '');
  }, [q]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e: Errors = {};
    if (!email.trim()) e.email = 'Enter your email';
    if (!/^\d{6}$/.test(code.trim())) e.code = 'Enter the 6-digit code from your email';
    const pw = passwordProblem(password);
    if (pw) e.password = pw;
    if (confirm !== password) e.confirm = "Those passwords don't match";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFormError(null);
    try {
      await confirmResetPassword(email, code, password);
      setDone(true);
    } catch (err) {
      setFormError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthCard
        eyebrow="Done"
        tone="aqua"
        title={
          <span className={styles.successHead}>
            <span className={styles.successCheck} aria-hidden="true">
              ✓
            </span>
            Password updated
          </span>
        }
        lead="Log in with your new password."
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
      eyebrow="Almost there"
      title="Set a new password"
      lead={
        <>
          Enter the code we emailed to <b>{email || 'you'}</b> and pick a new password.
        </>
      }
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        {!q?.get('email') && (
          <Field label="Email" error={errors.email}>
            <input
              type="email"
              className={`${styles.input} ${errors.email ? styles.invalid : ''}`}
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>
        )}
        <Field label="Code" error={errors.code}>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            className={`${styles.input} ${styles.code} ${errors.code ? styles.invalid : ''}`}
            placeholder="······"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="one-time-code"
          />
        </Field>
        <Field
          label="New password"
          error={errors.password}
          hint="At least 8 characters, with a lowercase letter and a number."
        >
          <input
            type="password"
            className={`${styles.input} ${errors.password ? styles.invalid : ''}`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          <input
            type="password"
            className={`${styles.input} ${errors.confirm ? styles.invalid : ''}`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {formError && (
          <span className={styles.formError} role="alert">
            {formError}
          </span>
        )}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
