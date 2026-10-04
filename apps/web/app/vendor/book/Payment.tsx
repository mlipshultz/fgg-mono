'use client';

import { type FormEvent, type ReactNode, useState } from 'react';
import type { HoldResponse, IsoDate, PublicEvent, VendorInfoInput } from '@fgg/types';
import { Button } from '@/components/Button';
import { Field, authStyles as a } from '@/components/auth/AuthCard';
import v from '@/components/vendor/vendor.module.css';
import { RATE_LABEL, daysLabel, daysShort, fmtCents } from '@/lib/booking';
import styles from './book.module.css';

interface Info {
  tableName: string;
  phone: string;
  sellsDescription: string;
}

function validate(i: Info): Record<keyof Info, string | undefined> {
  return {
    tableName: i.tableName.trim() ? undefined : 'What should we print on your table sign?',
    phone: i.phone.replace(/\D/g, '').length >= 7 ? undefined : 'Add a phone number for show day.',
    sellsDescription: i.sellsDescription.trim() ? undefined : 'Tell shoppers about your store.',
  };
}
const hasErrors = (e: ReturnType<typeof validate>) => Object.values(e).some(Boolean);

/**
 * Payment: the order summary plus the vendor info as a card. Info is prefilled from the hold
 * (saved earlier) or the vendor profile; it only opens as a form when something is missing or
 * the vendor taps Edit. Saved to the hold when they continue to checkout.
 */
export function Payment({
  ev,
  eventDays,
  hold,
  user,
  busy,
  error,
  countdown,
  onCheckout,
  onBack,
  onChangeTables,
}: {
  ev: PublicEvent;
  eventDays: IsoDate[];
  hold: HoldResponse;
  user: { name: string; email: string } | null;
  busy: boolean;
  error: string | null;
  countdown: ReactNode;
  onCheckout: (info: VendorInfoInput) => void;
  onBack: () => void;
  onChangeTables: () => void;
}) {
  const seed = hold.vendorInfo ?? hold.prefill;
  const [info, setInfo] = useState<Info>({
    tableName: seed?.tableName ?? '',
    phone: seed?.phone ?? '',
    sellsDescription: seed?.sellsDescription ?? '',
  });
  const [draft, setDraft] = useState<Info>(info);
  const [editing, setEditing] = useState(() => hasErrors(validate(info)));
  const [errors, setErrors] = useState<ReturnType<typeof validate> | null>(null);
  const multiDay = eventDays.length > 1;
  const q = hold.quote;
  const allDates = [...new Set(q.lines.flatMap((l) => l.dates))].sort();

  const saveDraft = (e?: FormEvent) => {
    e?.preventDefault();
    const errs = validate(draft);
    setErrors(errs);
    if (hasErrors(errs)) return false;
    setInfo(draft);
    setEditing(false);
    return true;
  };
  const cancelDraft = () => {
    setDraft(info);
    setErrors(null);
    setEditing(false);
  };
  const submit = () => {
    const current = editing ? draft : info;
    if (editing && !saveDraft()) return;
    onCheckout({
      tableName: current.tableName.trim(),
      phone: current.phone.trim(),
      sellsDescription: current.sellsDescription.trim().slice(0, 1000),
      codeOfConductAccepted: true,
    });
  };

  const field = (k: keyof Info) => (
    <input
      className={`${a.input} ${errors?.[k] ? a.invalid : ''}`}
      value={draft[k]}
      onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
      type={k === 'phone' ? 'tel' : 'text'}
      autoComplete={k === 'phone' ? 'tel' : undefined}
      placeholder={k === 'phone' ? '(410) 555-0100' : "Maya's Card Corner"}
    />
  );

  return (
    <div className={styles.stepCard}>
      <h1 className={styles.stepTitle}>Payment</h1>
      {countdown}
      <div className={styles.summary}>
        <div className={styles.summaryHead}>
          {ev.posterUrl ? (
            <img src={ev.posterUrl} alt="" className={styles.summaryThumb} />
          ) : (
            <span className={`${styles.summaryThumb} ${styles.summaryThumbEmpty}`} />
          )}
          <div>
            <div className={styles.summaryTitle}>
              {ev.name} · {q.lines.length === 1 ? 'Table' : 'Tables'}{' '}
              {q.lines.map((l) => l.tableId).join(', ')}
            </div>
            <div className={styles.summarySub}>
              {daysLabel(allDates)} · {ev.venue.name}
            </div>
          </div>
        </div>
        {q.lines.map((l) => (
          <div className={styles.line} key={l.tableId}>
            <span>
              Table {l.tableId} · {RATE_LABEL[q.rate]} × {l.dates.length}{' '}
              {l.dates.length === 1 ? 'day' : 'days'}
              {multiDay ? ` (${daysShort(eventDays, l.dates)})` : ''}
            </span>
            <span>{fmtCents(l.lineCents)}</span>
          </div>
        ))}
        {q.feeCents > 0 && (
          <div className={`${styles.line} ${styles.lineMuted}`}>
            <span>Processing fee</span>
            <span>{fmtCents(q.feeCents)}</span>
          </div>
        )}
        {q.taxCents > 0 && (
          <div className={`${styles.line} ${styles.lineMuted}`}>
            <span>Tax</span>
            <span>{fmtCents(q.taxCents)}</span>
          </div>
        )}
        <div className={styles.summaryTotal}>
          <span>Total due today</span>
          <span>{fmtCents(q.totalCents)}</span>
        </div>
      </div>

      <section className={styles.infoCard} aria-labelledby="your-info">
        <div className={styles.infoHead}>
          <h2 id="your-info" className={styles.infoTitle}>
            Your info
          </h2>
          {!editing && (
            <button type="button" className={styles.infoEdit} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
        <p className={a.hint}>
          Booking as <b>{user?.name ?? 'you'}</b>
          {user?.email ? ` · ${user.email}` : ''}. Your receipt and vendor pass go there.
        </p>
        {editing ? (
          <form className={a.form} onSubmit={saveDraft} noValidate>
            <Field label="Business / table name" error={errors?.tableName}>
              {field('tableName')}
            </Field>
            <Field label="Phone" error={errors?.phone}>
              {field('phone')}
            </Field>
            <Field
              label="About your store"
              hint="Shown on the event's vendor list. Prefilled from your profile; tweak it per show."
              error={errors?.sellsDescription}
            >
              <textarea
                className={`${a.input} ${errors?.sellsDescription ? a.invalid : ''}`}
                rows={3}
                value={draft.sellsDescription}
                onChange={(e) => setDraft({ ...draft, sellsDescription: e.target.value })}
                placeholder="Mostly modern singles and a $1 bulk bin, some sealed ETBs…"
                maxLength={1000}
              />
            </Field>
            <div className={styles.infoActions}>
              <Button type="submit" variant="secondary" size="sm">
                Save
              </Button>
              {!hasErrors(validate(info)) && (
                <button type="button" className={v.back} onClick={cancelDraft}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        ) : (
          <dl className={styles.infoList}>
            <div>
              <dt>Table sign</dt>
              <dd>{info.tableName}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{info.phone}</dd>
            </div>
            <div>
              <dt>Your store</dt>
              <dd>{info.sellsDescription}</dd>
            </div>
          </dl>
        )}
      </section>

      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}
      <Button type="button" variant="primary" size="lg" block disabled={busy} onClick={submit}>
        {busy ? 'Opening checkout…' : 'Continue to secure checkout →'}
      </Button>
      <span className={styles.policy}>
        By continuing you agree to the{' '}
        <a href="/vendor/code-of-conduct" target="_blank" rel="noreferrer">
          vendor code of conduct
        </a>
        . Full refund up to 14 days before the show. Secure checkout by Shopify.
      </span>
      <div className={v.footerNav}>
        <button type="button" className={v.back} onClick={onBack}>
          ← Back
        </button>
        <button type="button" className={v.back} onClick={onChangeTables}>
          Change tables
        </button>
      </div>
    </div>
  );
}
