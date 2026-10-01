'use client';

import { type FormEvent, useState } from 'react';
import type { ContactInterest } from '@fgg/types';
import { Button } from '@/components/Button';
import { sendContact } from '@/lib/api';
import styles from './page.module.css';

const INTERESTS: { label: string; value: ContactInterest }[] = [
  { label: 'Sponsoring', value: 'sponsor' },
  { label: 'Hosting a venue', value: 'partner' },
  { label: 'Running an activity', value: 'volunteer' },
  { label: 'Something else', value: 'other' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Errors = Partial<Record<'name' | 'email' | 'message', string>>;

export function ContactForm({ contactEmail }: { contactEmail: string }) {
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [email, setEmail] = useState('');
  const [interests, setInterests] = useState<ContactInterest[]>([]);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const toggle = (v: ContactInterest) =>
    setInterests((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  const validate = (): Errors => {
    const e: Errors = {};
    if (!name.trim()) e.name = 'Please tell us your name';
    if (!email.trim()) e.email = 'We need an email to reply to';
    else if (!EMAIL_RE.test(email.trim())) e.email = "Hmm, that email doesn't look right";
    if (!message.trim()) e.message = 'Tell us a little about the idea';
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFormError(null);
    try {
      await sendContact({
        name: name.trim(),
        ...(organization.trim() ? { organization: organization.trim() } : {}),
        email: email.trim(),
        interests,
        message: message.trim(),
      });
      setDone(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong. Try again?');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className={styles.success} role="status">
        <div className={styles.successHead}>
          <span className={styles.check} aria-hidden="true">
            ✓
          </span>
          <h2 className={styles.successTitle}>Message sent!</h2>
        </div>
        <p className={styles.successText}>
          Thanks, <b>{name.trim()}</b>. We&apos;ll reply to <b>{email.trim()}</b> within two
          business days.
        </p>
        <Button href="/" variant="yellow" size="sm">
          Back to the fest
        </Button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.two}>
        <label className={styles.field}>
          Name
          <input
            className={`${styles.input} ${errors.name ? styles.invalid : ''}`}
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            aria-invalid={errors.name ? true : undefined}
          />
          {errors.name && <span className={styles.error}>{errors.name}</span>}
        </label>
        <label className={styles.field}>
          Organization
          <input
            className={styles.input}
            placeholder="Company or group"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            autoComplete="organization"
          />
        </label>
      </div>
      <label className={styles.field}>
        Email
        <input
          type="email"
          className={`${styles.input} ${errors.email ? styles.invalid : ''}`}
          placeholder="you@organization.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          aria-invalid={errors.email ? true : undefined}
        />
        {errors.email && <span className={styles.error}>{errors.email}</span>}
      </label>
      <div className={styles.field} role="group" aria-label="I'm interested in">
        <span>I&apos;m interested in</span>
        <span className={styles.chips}>
          {INTERESTS.map((i) => (
            <button
              key={i.value}
              type="button"
              className={styles.chip}
              aria-pressed={interests.includes(i.value)}
              onClick={() => toggle(i.value)}
            >
              {i.label}
            </button>
          ))}
        </span>
      </div>
      <label className={styles.field}>
        Message
        <textarea
          className={`${styles.textarea} ${errors.message ? styles.invalid : ''}`}
          placeholder="What are you hoping to do together?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={errors.message ? true : undefined}
        />
        {errors.message && <span className={styles.error}>{errors.message}</span>}
      </label>
      {formError && (
        <span className={styles.formError} role="alert">
          {formError}
        </span>
      )}
      <Button type="submit" variant="primary" size="md" className={styles.submit} disabled={busy}>
        {busy ? 'Sending…' : 'Send message'}
      </Button>
      <span className={styles.alt}>
        Prefer email? <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
      </span>
    </form>
  );
}
