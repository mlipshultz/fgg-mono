'use client';

import { type FormEvent, useId, useState } from 'react';
import { Button } from '@/components/Button';
import { subscribe } from '@/lib/api';
import styles from './EmailBand.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailBand({ discordUrl }: { discordUrl?: string }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const id = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError("Hmm, that email doesn't look right");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await subscribe({ email: value, source: 'email_band' });
      setDone(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="email" className={styles.band} aria-labelledby="email-title">
      {done ? (
        <div className={styles.success} role="status">
          <div className={styles.successHead}>
            <span className={styles.check} aria-hidden="true">
              ✓
            </span>
            <h2 className={styles.successTitle}>You&apos;re on the list!</h2>
          </div>
          <p className={styles.successText}>
            First look at new dates and vendor openings is heading to <b>{done}</b>. Check your
            inbox for a hello.
          </p>
          <div className={styles.successCtas}>
            <Button href="/signup" variant="yellow" size="sm">
              Create a free account · +50 XP
            </Button>
            <Button
              href={discordUrl ?? '#'}
              variant="outline"
              size="sm"
              className={styles.ghostWhite}
            >
              Join the Discord
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div>
            <h2 id="email-title" className={styles.title}>
              Be first in line
            </h2>
            <p className={styles.lead}>
              New event dates, vendor registration openings and announcements — before anyone else.
            </p>
          </div>
          <form className={styles.form} onSubmit={submit} noValidate>
            <div className={styles.row}>
              <label htmlFor={id} style={{ position: 'absolute', left: -9999 }}>
                Email address
              </label>
              <input
                id={id}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@email.com"
                className={`${styles.input} ${error ? styles.inputError : ''}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-err` : undefined}
              />
              <Button
                type="submit"
                variant="yellow"
                size="md"
                className={styles.submit}
                disabled={busy}
              >
                {busy ? 'Joining…' : 'Join the List'}
              </Button>
            </div>
            {error && (
              <span id={`${id}-err`} className={styles.error} role="alert">
                {error}
              </span>
            )}
            <span className={styles.note}>One or two emails a month. Unsubscribe anytime.</span>
          </form>
        </>
      )}
    </section>
  );
}
