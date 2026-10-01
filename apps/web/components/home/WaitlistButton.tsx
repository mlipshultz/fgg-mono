'use client';

import { type FormEvent, useId, useState } from 'react';
import { Button } from '@/components/Button';
import { joinWaitlist } from '@/lib/api';
import styles from './EventCard.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WaitlistButton({
  eventId,
  kind,
}: {
  eventId: string;
  kind: 'waitlist' | 'notify_me';
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const id = useId();
  const label = kind === 'waitlist' ? 'Join waitlist' : 'Notify me';

  if (done) {
    return (
      <span className={styles.wlDone} role="status">
        ✓ {kind === 'waitlist' ? "You're on the waitlist." : "We'll let you know."}
      </span>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email)) {
      setError("Hmm, that email doesn't look right");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await joinWaitlist(eventId, { email, kind });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.wl} onSubmit={submit} noValidate>
      <div className={styles.wlForm}>
        <label htmlFor={id} className="sr-only" style={{ position: 'absolute', left: -9999 }}>
          Email for {label.toLowerCase()}
        </label>
        <input
          id={id}
          type="email"
          className={styles.wlInput}
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" variant="dark" size="sm" disabled={busy}>
          {busy ? 'Saving…' : label}
        </Button>
      </div>
      {error && (
        <span className={styles.wlError} role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
