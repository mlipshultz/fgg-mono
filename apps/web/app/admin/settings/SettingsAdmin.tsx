'use client';

import { type FormEvent, useEffect, useState } from 'react';
import type { AdminSettings } from '@fgg/types';
import { Button } from '@/components/Button';
import styles from '@/components/admin/admin.module.css';
import ui from '@/components/ui.module.css';
import { adminGetSettings, adminUpdateSettings } from '@/lib/api';

/** The form holds text so a field can be empty while it's being typed. */
type Draft = Record<
  | 'processingFeePct'
  | 'taxPct'
  | 'holdMinutes'
  | 'checkoutHoldMinutes'
  | 'refundCutoffDays'
  | 'calendlyUrl',
  string
>;

const toDraft = (s: AdminSettings): Draft => ({
  processingFeePct: String(s.processingFeePct),
  taxPct: String(s.taxPct),
  holdMinutes: String(s.holdMinutes),
  checkoutHoldMinutes: String(s.checkoutHoldMinutes),
  refundCutoffDays: String(s.refundCutoffDays),
  calendlyUrl: s.calendlyUrl ?? '',
});

interface NumberField {
  key: Exclude<keyof Draft, 'calendlyUrl'>;
  label: string;
  hint: string;
  min: number;
  max: number;
  /** Whole numbers only (minutes, days); percentages take decimals. */
  whole: boolean;
}
const CHECKOUT: NumberField[] = [
  {
    key: 'processingFeePct',
    label: 'Processing fee (%)',
    hint: 'Added to the table subtotal at checkout. 0 for none.',
    min: 0,
    max: 100,
    whole: false,
  },
  {
    key: 'taxPct',
    label: 'Sales tax (%)',
    hint: 'Added to the table subtotal at checkout. 0 for none.',
    min: 0,
    max: 100,
    whole: false,
  },
];
const HOLDS: NumberField[] = [
  {
    key: 'holdMinutes',
    label: 'Hold while booking (minutes)',
    hint: 'How long tables are held once a vendor continues to the Pay step.',
    min: 1,
    max: 120,
    whole: true,
  },
  {
    key: 'checkoutHoldMinutes',
    label: 'Hold during checkout (minutes)',
    hint: 'The hold restarts at this length when the vendor opens Shopify checkout.',
    min: 1,
    max: 120,
    whole: true,
  },
  {
    key: 'refundCutoffDays',
    label: 'Refund cutoff (days before the show)',
    hint: 'Cancellations before this are refunded in full; later ones are up to staff.',
    min: 0,
    max: 365,
    whole: true,
  },
];

/** Superadmin settings: checkout amounts, hold lengths, refund cutoff and the Calendly link. */
export function SettingsAdmin() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminGetSettings()
      .then((s) => {
        if (!alive) return;
        setDraft(toDraft(s));
        setSaved(toDraft(s));
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load settings');
      });
    return () => {
      alive = false;
    };
  }, []);

  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!draft) return;
    setToast(null);
    for (const f of [...CHECKOUT, ...HOLDS]) {
      const n = Number(draft[f.key]);
      const ok =
        draft[f.key].trim() !== '' &&
        Number.isFinite(n) &&
        n >= f.min &&
        n <= f.max &&
        (!f.whole || Number.isInteger(n));
      if (!ok) {
        setError(
          `${f.label}: enter a ${f.whole ? 'whole number' : 'number'} from ${f.min} to ${f.max}.`,
        );
        return;
      }
    }
    const calendlyUrl = draft.calendlyUrl.trim();
    if (calendlyUrl && !/^https:\/\/\S+$/.test(calendlyUrl)) {
      setError('Calendly link: enter a full https:// address, or leave it empty.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await adminUpdateSettings({
        processingFeePct: Number(draft.processingFeePct),
        taxPct: Number(draft.taxPct),
        holdMinutes: Number(draft.holdMinutes),
        checkoutHoldMinutes: Number(draft.checkoutHoldMinutes),
        refundCutoffDays: Number(draft.refundCutoffDays),
        calendlyUrl: calendlyUrl || null,
      });
      setDraft(toDraft(next));
      setSaved(toDraft(next));
      setToast('Settings saved. They apply to new bookings straight away.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save settings');
    } finally {
      setBusy(false);
    }
  };

  const numberInput = (f: NumberField) => (
    <label key={f.key}>
      {f.label}
      <input
        type="number"
        inputMode={f.whole ? 'numeric' : 'decimal'}
        min={f.min}
        max={f.max}
        step={f.whole ? 1 : 'any'}
        value={draft?.[f.key] ?? ''}
        onChange={(e) => draft && setDraft({ ...draft, [f.key]: e.target.value })}
      />
      <span className={styles.muted}>{f.hint}</span>
    </label>
  );

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <span className={ui.eyebrow}>Admin</span>
          <h1 className={styles.title}>Settings</h1>
        </div>
      </div>
      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {draft ? (
        <form className={styles.card} onSubmit={submit} noValidate>
          <span className={styles.cardTitle}>Checkout</span>
          <div className={styles.formRow}>{CHECKOUT.map(numberInput)}</div>
          <span className={styles.cardTitle}>Holds and refunds</span>
          <div className={styles.formRow}>{HOLDS.map(numberInput)}</div>
          <span className={styles.cardTitle}>Vendor applications</span>
          <div className={styles.formRow}>
            <label>
              Calendly link
              <input
                type="url"
                value={draft.calendlyUrl}
                onChange={(e) => setDraft({ ...draft, calendlyUrl: e.target.value })}
                placeholder="https://calendly.com/…"
              />
              <span className={styles.muted}>
                Shown to applicants waiting on their intro call. Leave empty to show
                &ldquo;we&apos;ll be in touch&rdquo; instead.
              </span>
            </label>
          </div>
          <div>
            <Button type="submit" variant="dark" size="sm" disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </form>
      ) : (
        !error && <p className={styles.muted}>Loading settings…</p>
      )}
    </main>
  );
}
