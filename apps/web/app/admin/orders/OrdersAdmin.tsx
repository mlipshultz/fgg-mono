'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { OrderStatus, PublicEvent, VendorOrder } from '@fgg/types';
import { Button } from '@/components/Button';
import { useAuth } from '@/components/Providers';
import ui from '@/components/ui.module.css';
import v from '@/components/vendor/vendor.module.css';
import {
  adminComp,
  adminListOrders,
  adminRefund,
  adminRegisterWebhooks,
  getHomeContent,
  hasApi,
} from '@/lib/api';
import { isSuperAdmin } from '@/lib/auth';
import { daysLabel, fmtCents, orderDates, tableLinesOf, tablesLabel } from '@/lib/booking';
import { shortDateLabel } from '@/lib/dates';
import styles from '@/components/admin/admin.module.css';

const STATUSES: OrderStatus[] = ['pending_payment', 'paid', 'refunded', 'cancelled', 'conflict'];
const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  conflict: 'Conflict',
};
const STATUS_CLASS: Record<OrderStatus, string | undefined> = {
  pending_payment: v.pending,
  paid: v.paid,
  refunded: v.refunded,
  cancelled: v.cancelled,
  conflict: v.conflict,
};

function tableOf(o: VendorOrder) {
  const lines = tableLinesOf(o);
  return lines.length
    ? { tableId: tablesLabel(o), dates: orderDates(o), rate: lines[0]!.rate }
    : null;
}

export function OrdersAdmin() {
  const { user } = useAuth();
  const superAdmin = isSuperAdmin(user) || !hasApi;
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [eventId, setEventId] = useState('');
  const [status, setStatus] = useState<'' | OrderStatus>('');
  const [rows, setRows] = useState<VendorOrder[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [comp, setComp] = useState({ eventId: '', vendorId: '', tableId: '', dates: '', note: '' });
  const [showComp, setShowComp] = useState(false);

  useEffect(() => {
    getHomeContent()
      .then((h) => setEvents(h.events))
      .catch(() => {});
  }, []);

  const load = useCallback(async (ev: string, st: '' | OrderStatus, next?: string) => {
    setBusy(true);
    setError(null);
    try {
      const page = await adminListOrders({
        ...(ev ? { eventId: ev } : {}),
        ...(st ? { status: st } : {}),
        ...(next ? { cursor: next } : {}),
      });
      setRows((cur) => (next ? [...cur, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load orders');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(eventId, status);
  }, [eventId, status, load]);

  const refund = async (o: VendorOrder) => {
    const t = tableOf(o);
    if (
      !window.confirm(
        `Refund ${fmtCents(o.totalCents)} to ${o.vendorInfo?.tableName ?? 'this vendor'} for table ${t?.tableId ?? ''} at ${o.event.name}? This frees the table.`,
      )
    )
      return;
    setActing(o.id);
    setError(null);
    try {
      const updated = await adminRefund(o.id);
      setRows((cur) => cur.map((r) => (r.id === o.id ? updated : r)));
      setToast(`Refunded ${o.passNumber ?? o.id.slice(-6)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refund failed');
    } finally {
      setActing(null);
    }
  };

  const submitComp = async (ev: FormEvent) => {
    ev.preventDefault();
    const dates = comp.dates
      .split(/[,\s]+/)
      .map((d) => d.trim())
      .filter(Boolean);
    if (!comp.eventId || !comp.vendorId || !comp.tableId || dates.length === 0) {
      setError('Comp needs an event, a vendor id, a table and at least one date (YYYY-MM-DD).');
      return;
    }
    setActing('comp');
    setError(null);
    try {
      const created = await adminComp({
        eventId: comp.eventId,
        vendorId: comp.vendorId,
        tableId: comp.tableId.toUpperCase(),
        dates,
        ...(comp.note.trim() ? { note: comp.note.trim() } : {}),
      });
      setRows((cur) => [created, ...cur]);
      setToast(
        `Comped table ${comp.tableId.toUpperCase()} (${created.passNumber ?? 'pass pending'}).`,
      );
      setShowComp(false);
      setComp({ eventId: '', vendorId: '', tableId: '', dates: '', note: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not comp that table');
    } finally {
      setActing(null);
    }
  };

  const registerWebhooks = async () => {
    setActing('webhooks');
    setError(null);
    try {
      const res = await adminRegisterWebhooks();
      setToast(`Shopify webhooks: ${JSON.stringify(res)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Webhook registration failed');
    } finally {
      setActing(null);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <span className={ui.eyebrow}>Admin</span>
          <h1 className={styles.title}>Orders</h1>
        </div>
        <div className={styles.filters}>
          <select
            className={styles.select}
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            aria-label="Filter by event"
          >
            <option value="">All events</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {shortDateLabel(e.startDate, e.endDate)}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | OrderStatus)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <Button type="button" variant="yellow" size="sm" onClick={() => setShowComp((s) => !s)}>
            {showComp ? 'Close comp' : 'Comp a table'}
          </Button>
          {superAdmin && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={acting === 'webhooks'}
              onClick={() => void registerWebhooks()}
            >
              {acting === 'webhooks' ? 'Registering…' : 'Register Shopify webhooks'}
            </Button>
          )}
        </div>
      </div>

      {showComp && (
        <form className={styles.card} onSubmit={submitComp}>
          <span className={styles.cardTitle}>Comp a table</span>
          <span className={styles.muted}>
            Assigns a table without payment. The vendor gets a pass like any paid order.
          </span>
          <div className={styles.formRow}>
            <label>
              Event
              <select
                value={comp.eventId}
                onChange={(e) => setComp({ ...comp, eventId: e.target.value })}
              >
                <option value="">Pick an event</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Vendor id
              <input
                value={comp.vendorId}
                onChange={(e) => setComp({ ...comp, vendorId: e.target.value })}
                placeholder="01J…"
              />
            </label>
            <label>
              Table
              <input
                value={comp.tableId}
                onChange={(e) => setComp({ ...comp, tableId: e.target.value })}
                placeholder="B7"
              />
            </label>
            <label>
              Dates
              <input
                value={comp.dates}
                onChange={(e) => setComp({ ...comp, dates: e.target.value })}
                placeholder="2026-10-24, 2026-10-25"
              />
            </label>
            <label>
              Note
              <input
                value={comp.note}
                onChange={(e) => setComp({ ...comp, note: e.target.value })}
                placeholder="Sponsor table"
              />
            </label>
          </div>
          <div>
            <Button type="submit" variant="dark" size="sm" disabled={acting === 'comp'}>
              {acting === 'comp' ? 'Creating…' : 'Create comped order'}
            </Button>
          </div>
        </form>
      )}

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

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Pass</th>
              <th>Event</th>
              <th>Vendor</th>
              <th>Table</th>
              <th>Total</th>
              <th>Status</th>
              <th>Shopify</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const t = tableOf(o);
              return (
                <tr key={o.id}>
                  <td className={styles.mono}>{o.passNumber ?? '—'}</td>
                  <td>
                    <span className={styles.name}>{o.event.name}</span>
                    <span className={styles.sub}>{t ? daysLabel(t.dates) : ''}</span>
                  </td>
                  <td>
                    <span className={styles.name}>{o.vendorInfo?.tableName ?? '—'}</span>
                    <span className={styles.sub}>{o.vendorInfo?.email ?? ''}</span>
                  </td>
                  <td>
                    <b>{t?.tableId ?? '—'}</b>
                    <span className={styles.sub}>
                      {t?.rate === 'poke_bucks' ? 'PokéBucks' : 'Standard'}
                    </span>
                  </td>
                  <td>{o.source === 'manual' ? 'Comped' : fmtCents(o.totalCents)}</td>
                  <td>
                    <span className={`${v.statusPill} ${STATUS_CLASS[o.status]}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                    {o.cancelRequestedAt && (
                      <span className={styles.sub}>Cancellation requested</span>
                    )}
                  </td>
                  <td className={styles.mono}>
                    {o.shopifyOrderId?.split('/').pop() ?? (o.shopifyDraftOrderId ? 'draft' : '—')}
                  </td>
                  <td>
                    <div className={styles.actions}>
                      {o.status === 'paid' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={acting === o.id}
                          onClick={() => void refund(o)}
                        >
                          {acting === o.id
                            ? 'Refunding…'
                            : o.source === 'manual'
                              ? 'Cancel'
                              : 'Refund'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !busy && (
              <tr>
                <td colSpan={8} className={styles.emptyRow}>
                  No orders match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={styles.foot}>
        {busy && <span className={styles.muted}>Loading…</span>}
        {cursor && !busy && (
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void load(eventId, status, cursor)}
          >
            Load more
          </Button>
        )}
      </div>
    </main>
  );
}
