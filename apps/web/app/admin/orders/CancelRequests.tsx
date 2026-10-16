'use client';

import { useEffect, useState } from 'react';
import type { VendorOrder } from '@fgg/types';
import { Button } from '@/components/Button';
import styles from '@/components/admin/admin.module.css';
import { adminApproveCancel, adminDeclineCancel, adminListCancelRequests } from '@/lib/api';
import { fmtCents, tableDaysSummary } from '@/lib/booking';
import { daysUntil } from '@/lib/dates';
import local from './orders.module.css';

const requested = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/**
 * Vendors' cancellation requests, oldest first. Approve refunds (in full by default; less is
 * allowed inside the refund window) and frees the tables; decline keeps the booking and shows
 * the vendor the note. Approving is superadmin only because it moves money.
 */
export function CancelRequests({
  superAdmin,
  onResolved,
}: {
  superAdmin: boolean;
  /** An order changed (refunded or declined); the orders table should show the new state. */
  onResolved: (order: VendorOrder, message: string) => void;
}) {
  const [items, setItems] = useState<VendorOrder[] | null>(null);
  const [cutoff, setCutoff] = useState(14);
  /** Per order: refund amount in dollars, and the decline note. */
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminListCancelRequests()
      .then((q) => {
        if (!alive) return;
        setItems(q.items);
        setCutoff(q.refundCutoffDays);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Could not load'));
    return () => {
      alive = false;
    };
  }, []);

  if (items === null && !error) return null;

  const done = (o: VendorOrder, message: string) => {
    setItems((cur) => (cur ?? []).filter((x) => x.id !== o.id));
    onResolved(o, message);
  };

  const approve = async (o: VendorOrder) => {
    const typed = amount[o.id];
    const cents = typed === undefined ? o.totalCents : Math.round(Number(typed) * 100);
    if (!(cents >= 0 && cents <= o.totalCents))
      return setError(`Refund between $0 and ${fmtCents(o.totalCents)}.`);
    setActing(o.id);
    setError(null);
    try {
      const updated = await adminApproveCancel(o.id, {
        amountCents: cents,
        ...(note[o.id]?.trim() ? { note: note[o.id]!.trim() } : {}),
      });
      done(
        updated,
        o.source === 'manual'
          ? `Cancelled ${o.passNumber ?? 'the order'} and freed its tables.`
          : `Refunded ${fmtCents(cents)} for ${o.passNumber ?? 'the order'} and freed its tables.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve');
    } finally {
      setActing(null);
    }
  };

  const decline = async (o: VendorOrder) => {
    setActing(o.id);
    setError(null);
    try {
      const updated = await adminDeclineCancel(o.id, {
        ...(note[o.id]?.trim() ? { note: note[o.id]!.trim() } : {}),
      });
      done(
        updated,
        `Declined the cancellation for ${o.passNumber ?? 'the order'}; it stays booked.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not decline');
    } finally {
      setActing(null);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="cancel-requests">
      <span id="cancel-requests" className={styles.cardTitle}>
        Cancellation requests{items?.length ? ` · ${items.length}` : ''}
      </span>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {items?.length === 0 && <span className={styles.muted}>Nothing waiting.</span>}
      {items?.map((o) => {
        const days = daysUntil(o.event.startDate);
        const inside = days < cutoff;
        const manual = o.source === 'manual';
        return (
          <article
            key={o.id}
            className={local.request}
            aria-label={`Cancellation request from ${o.vendorInfo?.tableName ?? 'a vendor'}`}
          >
            <div>
              <span className={styles.name}>
                {o.vendorInfo?.tableName ?? '—'} · {o.event.name}
              </span>
              <span className={styles.sub}>
                {o.passNumber ?? o.id.slice(-6)} ·{' '}
                {tableDaysSummary(
                  o,
                  o.event.days.map((d) => d.date),
                )}{' '}
                · {manual ? 'Comped' : `paid ${fmtCents(o.totalCents)}`} · asked{' '}
                {requested(o.cancelRequestedAt!)}
              </span>
              <p className={local.reason}>
                {o.cancelReason ? `“${o.cancelReason}”` : 'No reason given.'}
              </p>
              <span className={`${styles.chip} ${inside ? local.inside : ''}`}>
                {days < 0
                  ? 'Show has passed'
                  : inside
                    ? `Show in ${days} days: inside the ${cutoff}-day window, refund is your call`
                    : `Show in ${days} days: refund in full`}
              </span>
            </div>
            <div className={local.requestActions}>
              <label className={local.field}>
                Note (optional)
                <input
                  value={note[o.id] ?? ''}
                  onChange={(e) => setNote({ ...note, [o.id]: e.target.value })}
                  placeholder={inside ? 'Why a partial refund, or why not' : ''}
                />
              </label>
              {superAdmin ? (
                <div className={local.buttons}>
                  {!manual && (
                    <label className={local.field}>
                      Refund $
                      <input
                        type="number"
                        min={0}
                        max={o.totalCents / 100}
                        step="any"
                        value={amount[o.id] ?? String(o.totalCents / 100)}
                        onChange={(e) => setAmount({ ...amount, [o.id]: e.target.value })}
                      />
                    </label>
                  )}
                  <Button
                    type="button"
                    variant="dark"
                    size="sm"
                    disabled={acting === o.id}
                    onClick={() => void approve(o)}
                  >
                    {manual
                      ? 'Approve and cancel'
                      : `Approve and refund ${fmtCents(
                          amount[o.id] === undefined
                            ? o.totalCents
                            : Math.round(Number(amount[o.id]) * 100) || 0,
                        )}`}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={acting === o.id}
                    onClick={() => void decline(o)}
                  >
                    Decline
                  </Button>
                </div>
              ) : (
                <div className={local.buttons}>
                  <span className={styles.muted}>A superadmin approves refunds.</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={acting === o.id}
                    onClick={() => void decline(o)}
                  >
                    Decline
                  </Button>
                </div>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
