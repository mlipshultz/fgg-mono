'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { VendorDashboard, VendorOrder } from '@fgg/types';
import { Button } from '@/components/Button';
import { useAuth } from '@/components/Providers';
import { authStyles } from '@/components/auth/AuthCard';
import ui from '@/components/ui.module.css';
import v from '@/components/vendor/vendor.module.css';
import { bookHref } from '@/components/vendor/BookCta';
import { downloadVendorFile, getVendorDashboard, requestCancel } from '@/lib/api';
import { initials } from '@/lib/auth';
import { fmtCents, orderDates, tableLinesOf, tablesLabel } from '@/lib/booking';
import { daysUntil, fullDateLabel, shortDateLabel, year } from '@/lib/dates';
import { ProfileCard } from './ProfileCard';
import styles from './vendor.module.css';

const STATUS_LABEL: Record<VendorOrder['status'], string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  conflict: 'Refunded · conflict',
};
const STATUS_CLASS: Record<VendorOrder['status'], string | undefined> = {
  pending_payment: v.pending,
  paid: v.paid,
  refunded: v.refunded,
  cancelled: v.cancelled,
  conflict: v.conflict,
};

function tableOf(o: VendorOrder): string {
  return tablesLabel(o) || '—';
}
function tablesWord(o: VendorOrder): string {
  return tableLinesOf(o).length === 1 ? 'Table' : 'Tables';
}
function datesOf(o: VendorOrder): string[] {
  return orderDates(o);
}
function passesOf(o: VendorOrder): number {
  return 2 * Math.max(1, tableLinesOf(o).length);
}
function rateOf(o: VendorOrder): string {
  const l = tableLinesOf(o)[0];
  return l?.rate === 'poke_bucks' ? ' · PokéBucks' : '';
}

export function VendorDashboardView() {
  const { user, status } = useAuth();
  const [data, setData] = useState<VendorDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getVendorDashboard()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Could not load'));
    return () => {
      alive = false;
    };
  }, []);

  const download = (o: VendorOrder, kind: 'pass.ics' | 'receipt.pdf') => {
    const base = `${o.event.slug}-table-${tableOf(o).replace(/, /g, '-')}`;
    void downloadVendorFile(
      o.id,
      kind,
      kind === 'pass.ics' ? `${base}.ics` : `${base}-receipt.pdf`,
    ).catch(() => {});
  };

  const cancel = async (o: VendorOrder) => {
    const cutoff = data?.refundCutoffDays ?? 14;
    const days = daysUntil(o.event.startDate);
    const msg =
      days >= cutoff
        ? `Request a cancellation for ${tablesWord(o)} ${tableOf(o)} at ${o.event.name}? You're ${days} days out, so the refund is in full once staff approve it.`
        : `Request a cancellation for ${tablesWord(o)} ${tableOf(o)} at ${o.event.name}? The show is in ${days} days, inside the ${cutoff}-day refund window, so staff decide the refund.`;
    if (!window.confirm(msg)) return;
    setBusyId(o.id);
    try {
      const updated = await requestCancel(o.id, {});
      setData((cur) =>
        cur
          ? {
              ...cur,
              upcoming: cur.upcoming.map((x) => (x.id === o.id ? updated : x)),
              history: cur.history.map((x) => (x.id === o.id ? updated : x)),
            }
          : cur,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the request');
    } finally {
      setBusyId(null);
    }
  };

  if (error) {
    return (
      <main className={styles.page}>
        <div className={styles.errorCard} role="alert">
          <span className={ui.eyebrow}>Hmm</span>
          <h1 className={styles.h2}>We couldn&apos;t load your vendor dashboard</h1>
          <p>{error}</p>
          <div>
            <Button href="/login" variant="yellow" size="sm">
              Log in again
            </Button>
          </div>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <div
        className={authStyles.skeleton}
        aria-busy="true"
        aria-label="Loading your vendor dashboard"
      >
        <span />
        <span />
      </div>
    );
  }

  const { vendor, upcoming, history, events } = data;
  const next = upcoming[0];
  const nextIn = next ? daysUntil(next.event.startDate) : null;
  const thisYear = new Date().getFullYear();
  const headline =
    nextIn === null
      ? 'No shows booked yet'
      : nextIn <= 0
        ? 'Your next show is today!'
        : nextIn === 1
          ? 'Your next show is tomorrow'
          : `Your next show is in ${nextIn} days`;
  const bookedIds = new Set(upcoming.map((o) => o.eventId));
  const quick = events.filter((e) => !bookedIds.has(e.id)).slice(0, 4);

  return (
    <main className={styles.page}>
      <nav className={styles.tabs} aria-label="Vendor">
        <Link href="/vendor" className={styles.tabActive} aria-current="page">
          Dashboard
        </Link>
        <Link href="/#events">Book a show</Link>
        <a href="#history">Receipts</a>
        <a href="#profile">Profile</a>
        <span className={styles.tabAvatar} aria-hidden="true">
          {initials(user?.name ?? vendor.contactName)}
        </span>
      </nav>

      <div className={styles.head}>
        <div>
          <span className={ui.eyebrow}>{vendor.businessName}</span>
          <h1 className={styles.h2}>{headline}</h1>
        </div>
        <div className={`${styles.poke} ${vendor.pokeBucksPartner ? styles.pokeOn : ''}`}>
          <span className={styles.pokeDollar} aria-hidden="true">
            $
          </span>
          <span>
            PokéBucks partner: <b>{vendor.pokeBucksPartner ? 'On' : 'Off'}</b>.{' '}
            {vendor.pokeBucksPartner
              ? 'Pick the $100 rate when you book.'
              : 'Turn it on to book tables for $100.'}
          </span>
          <a href="/vendor/code-of-conduct" className={styles.pokeLink}>
            Learn more →
          </a>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={`${styles.card} ${styles.cardAqua}`}>
          <span className={styles.cardTitle}>Upcoming booked shows</span>
          {upcoming.map((o) => (
            <div className={styles.show} key={o.id}>
              {o.event.posterUrl ? (
                <img src={o.event.posterUrl} alt="" className={styles.thumb} />
              ) : (
                <span className={styles.thumb} />
              )}
              <div>
                <div className={styles.showName}>{o.event.name}</div>
                <div className={styles.showMeta}>
                  {shortDateLabel(o.event.startDate, o.event.endDate)} · {tablesWord(o)}{' '}
                  {tableOf(o)}, Main Hall
                  {o.loadInLabel ? ` · Load-in ${o.loadInLabel}` : ''}
                </div>
                <div className={styles.pills}>
                  <span className={`${v.statusPill} ${STATUS_CLASS[o.status]}`}>
                    {STATUS_LABEL[o.status]}
                  </span>
                  <span className={v.statusPill}>{passesOf(o)} vendor passes</span>
                  <span className={v.statusPill}>
                    {datesOf(o).length} {datesOf(o).length === 1 ? 'day' : 'days'}
                  </span>
                  {o.cancelRequestedAt && (
                    <span className={`${v.statusPill} ${v.pending}`}>Cancellation requested</span>
                  )}
                </div>
              </div>
              <div className={styles.showLinks}>
                <Link href={`/vendor/orders/pass?id=${o.id}`} className={styles.primaryLink}>
                  View pass
                </Link>
                <button type="button" onClick={() => download(o, 'receipt.pdf')}>
                  Receipt
                </button>
                {!o.cancelRequestedAt && (
                  <button type="button" onClick={() => void cancel(o)} disabled={busyId === o.id}>
                    {busyId === o.id ? 'Sending…' : 'Request cancellation'}
                  </button>
                )}
              </div>
            </div>
          ))}
          <Link href="/#events" className={styles.dashed}>
            <span>
              {upcoming.length === 0
                ? 'Nothing booked yet. Grab a table for the next show →'
                : upcoming.length === 1
                  ? "That's your only upcoming show. Grab a table for the next one →"
                  : 'Add another show →'}
            </span>
          </Link>
          <span className={styles.cardSub}>Quick register</span>
          <div className={styles.quick}>
            {quick.map((e) => (
              <div className={styles.mini} key={e.id}>
                <div className={styles.miniHead}>
                  <span className={styles.miniName}>{e.name}</span>
                  {e.vendorStatus === 'open' && (
                    <span className={`${ui.pill} ${ui.pillOpen}`}>Open</span>
                  )}
                  {e.vendorStatus === 'closed' && (
                    <span className={`${ui.pill} ${ui.pillClosed}`}>Closed</span>
                  )}
                  {e.vendorStatus === 'coming_soon' && (
                    <span className={`${ui.pill} ${ui.pillSoon}`}>Coming soon</span>
                  )}
                </div>
                <span className={styles.miniMeta}>
                  {fullDateLabel(e.startDate, e.endDate, year(e.startDate) !== thisYear)} ·{' '}
                  {e.venue.city}, {e.venue.state}
                </span>
                {e.vendorStatus === 'open' && (
                  <Link href={bookHref(e.slug, status, user?.roles)} className={styles.miniLink}>
                    Book a table →
                  </Link>
                )}
                {e.vendorStatus === 'closed' && (
                  <a href={`/#event-${e.slug}`} className={styles.miniLink}>
                    Join waitlist →
                  </a>
                )}
                {e.vendorStatus === 'coming_soon' && (
                  <a href={`/#event-${e.slug}`} className={styles.miniLink}>
                    Notify me →
                  </a>
                )}
              </div>
            ))}
            {quick.length === 0 && (
              <span className={styles.miniMeta}>No other shows open right now.</span>
            )}
          </div>
        </div>

        <div className={styles.col}>
          <ProfileCard
            profile={vendor}
            onChange={(p) => setData((cur) => (cur ? { ...cur, vendor: p } : cur))}
          />
          <div className={styles.card}>
            <span className={styles.cardTitle}>Payments</span>
            <div className={styles.payRow}>
              <span>Balance due</span>
              <b className={styles.payBig}>{fmtCents(data.balanceDueCents)}</b>
            </div>
            <div className={`${styles.payRow} ${styles.payRowMuted}`}>
              <span>Paid in {thisYear}</span>
              <span>{fmtCents(data.paidThisYearCents)}</span>
            </div>
            <div className={`${styles.payRow} ${styles.payRowMuted}`}>
              <span>Payments</span>
              <span>via Shopify</span>
            </div>
          </div>
          <div className={styles.tips}>
            <span className={styles.tipsTitle}>Vendor tips</span>
            <span className={styles.tipsText}>
              Kids-eye-level displays sell 2× better. Bring a $1–5 bulk bin — it&apos;s what the
              PokéBucks crowd is looking for.
            </span>
            <a href="/vendor/code-of-conduct" className={styles.tipsLink}>
              Read the vendor guide →
            </a>
          </div>
          <div className={styles.appNote}>
            <span aria-hidden="true" />
            Passes and receipts will also live in the FGG mobile app.
          </div>
        </div>
      </div>

      <div className={styles.card} id="history">
        <div className={styles.historyHead}>
          <span className={styles.cardTitle}>Booking history</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Event</th>
                <th>Date</th>
                <th>Table</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {history.map((o) => (
                <tr key={o.id}>
                  <td>
                    <b>{o.event.name}</b>
                  </td>
                  <td>
                    {shortDateLabel(o.event.startDate, o.event.endDate)}, {year(o.event.startDate)}
                  </td>
                  <td>{tableOf(o)}</td>
                  <td>{o.source === 'manual' ? 'Comped' : fmtCents(o.totalCents)}</td>
                  <td>
                    <span className={`${v.statusPill} ${STATUS_CLASS[o.status]}`}>
                      {STATUS_LABEL[o.status]}
                      {rateOf(o)}
                    </span>
                  </td>
                  <td>
                    {(o.status === 'paid' || o.status === 'refunded') && (
                      <button
                        type="button"
                        className={styles.historyLink}
                        onClick={() => download(o, 'receipt.pdf')}
                      >
                        PDF ↓
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    Your bookings will show up here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
