'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VendorApplication, VendorApplicationStatus } from '@fgg/types';
import { Button } from '@/components/Button';
import ui from '@/components/ui.module.css';
import { adminApprove, adminCallScheduled, adminListApplications, adminReject } from '@/lib/api';
import styles from '@/components/admin/admin.module.css';

const TABS: { status: VendorApplicationStatus; label: string }[] = [
  { status: 'submitted', label: 'Submitted' },
  { status: 'call_scheduled', label: 'Call scheduled' },
  { status: 'approved', label: 'Approved' },
  { status: 'rejected', label: 'Rejected' },
];

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ApplicationsAdmin() {
  const [status, setStatus] = useState<VendorApplicationStatus>('submitted');
  const [rows, setRows] = useState<VendorApplication[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [notes, setNotes] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async (s: VendorApplicationStatus, next?: string) => {
    setBusy(true);
    setError(null);
    try {
      const page = await adminListApplications({ status: s, ...(next ? { cursor: next } : {}) });
      setRows((cur) => (next ? [...cur, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load applications');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status, load]);

  const run = async (app: VendorApplication, action: 'call' | 'approve' | 'reject') => {
    setActing(app.id);
    setError(null);
    try {
      const updated =
        action === 'call'
          ? await adminCallScheduled(app.id)
          : action === 'approve'
            ? await adminApprove(app.id, notes.trim() ? { notes: notes.trim() } : {})
            : await adminReject(app.id, notes.trim() ? { notes: notes.trim() } : {});
      setRows((cur) => cur.filter((r) => r.id !== app.id || updated.status === status));
      setToast(
        action === 'call'
          ? `${app.businessName}: call marked as scheduled.`
          : action === 'approve'
            ? `${app.businessName} is now an approved vendor.`
            : `${app.businessName} was rejected.`,
      );
      setPanel(null);
      setNotes('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the application');
    } finally {
      setActing(null);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <span className={ui.eyebrow}>Admin</span>
          <h1 className={styles.title}>Vendor applications</h1>
        </div>
        <div className={styles.tabs} role="group" aria-label="Status">
          {TABS.map((t) => (
            <button
              key={t.status}
              type="button"
              className={styles.tab}
              aria-pressed={status === t.status}
              onClick={() => setStatus(t.status)}
            >
              {t.label}
            </button>
          ))}
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
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Business</th>
              <th>Contact</th>
              <th>Sells</th>
              <th>History</th>
              <th>Applied</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((app) => (
              <tr key={app.id}>
                <td>
                  <span className={styles.name}>{app.businessName}</span>
                  <span className={styles.sub}>
                    {[
                      app.socials.instagram ? `IG @${app.socials.instagram}` : null,
                      app.socials.tiktok ? `TT @${app.socials.tiktok}` : null,
                      app.socials.website ?? null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No socials'}
                  </span>
                </td>
                <td>
                  <span className={styles.name}>{app.contactName}</span>
                  <span className={styles.sub}>{app.email}</span>
                  <span className={styles.sub}>{app.phone}</span>
                </td>
                <td>
                  <span className={styles.sub}>{app.sellsDescription || '—'}</span>
                </td>
                <td>
                  <span className={styles.sub}>
                    PokéBucks: {app.pokeBucksInterest ? 'yes' : 'no'}
                  </span>
                  {app.attribution.utmSource && (
                    <span className={styles.sub}>
                      via {app.attribution.utmSource}
                      {app.attribution.adName ? ` · ${app.attribution.adName}` : ''}
                    </span>
                  )}
                  {app.reviewNotes && <span className={styles.sub}>Notes: {app.reviewNotes}</span>}
                </td>
                <td>
                  <span className={styles.sub}>{when(app.createdAt)}</span>
                  {app.callScheduledAt && (
                    <span className={styles.sub}>Call: {when(app.callScheduledAt)}</span>
                  )}
                </td>
                <td>
                  <div className={styles.actions}>
                    {app.status === 'submitted' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={acting === app.id}
                        onClick={() => void run(app, 'call')}
                      >
                        Mark call scheduled
                      </Button>
                    )}
                    {(app.status === 'submitted' || app.status === 'call_scheduled') && (
                      <>
                        <Button
                          type="button"
                          variant="dark"
                          size="sm"
                          disabled={acting === app.id}
                          onClick={() => {
                            setPanel({ id: app.id, action: 'approve' });
                            setNotes('');
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={acting === app.id}
                          onClick={() => {
                            setPanel({ id: app.id, action: 'reject' });
                            setNotes('');
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {app.status === 'rejected' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={acting === app.id}
                        onClick={() => {
                          setPanel({ id: app.id, action: 'approve' });
                          setNotes('');
                        }}
                      >
                        Approve after all
                      </Button>
                    )}
                    {panel?.id === app.id && (
                      <div className={styles.panel}>
                        <label className={styles.sub} htmlFor={`notes-${app.id}`}>
                          Notes for the record{' '}
                          {panel.action === 'reject' ? '(shown to the applicant)' : '(optional)'}
                        </label>
                        <textarea
                          id={`notes-${app.id}`}
                          rows={3}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                        <div className={styles.panelRow}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setPanel(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant={panel.action === 'approve' ? 'primary' : 'yellow'}
                            size="sm"
                            disabled={acting === app.id}
                            onClick={() => void run(app, panel.action)}
                          >
                            {acting === app.id
                              ? 'Working…'
                              : panel.action === 'approve'
                                ? 'Confirm approve'
                                : 'Confirm reject'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !busy && (
              <tr>
                <td colSpan={6} className={styles.emptyRow}>
                  Nothing {TABS.find((t) => t.status === status)?.label.toLowerCase()} right now.
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
            onClick={() => void load(status, cursor)}
          >
            Load more
          </Button>
        )}
      </div>
    </main>
  );
}
