'use client';

import { type FormEvent, useEffect, useState } from 'react';
import type { AdminVendorMember } from '@fgg/types';
import { Button } from '@/components/Button';
import styles from '@/components/admin/admin.module.css';
import { adminAddVendorMember, adminListVendorMembers, adminRemoveVendorMember } from '@/lib/api';
import local from './vendors.module.css';

const joined = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * The people who can sign in for a vendor. Staff add someone by the email of an account they
 * already made on the site (they get the vendor role) and remove people (they lose it).
 */
export function Members({
  vendorId,
  vendorName,
  onCountChange,
}: {
  vendorId: string;
  vendorName: string;
  onCountChange: (count: number) => void;
}) {
  const [members, setMembers] = useState<AdminVendorMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminListVendorMembers(vendorId)
      .then((r) => alive && setMembers(r.items))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Could not load'));
    return () => {
      alive = false;
    };
  }, [vendorId]);

  const update = (items: AdminVendorMember[], message: string) => {
    setMembers(items);
    onCountChange(items.length);
    setError(null);
    setToast(message);
  };

  const add = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(e)) return setError('Enter the email of their account.');
    setBusy('add');
    setToast(null);
    try {
      const r = await adminAddVendorMember(vendorId, e);
      setEmail('');
      update(
        r.items,
        `Added ${e}. They can book for ${vendorName} once they sign in again (or within the hour).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add them');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: AdminVendorMember) => {
    if (!window.confirm(`Remove ${m.email || m.displayName} from ${vendorName}?`)) return;
    setBusy(m.userId);
    setToast(null);
    try {
      const r = await adminRemoveVendorMember(vendorId, m.userId);
      update(r.items, `Removed ${m.email || m.displayName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove them');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="members">
      <span id="members" className={styles.cardTitle}>
        Members
      </span>
      <span className={styles.muted}>
        Everyone here signs in as {vendorName}: they see its bookings and can book for it. One
        vendor per person.
      </span>
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
      {members === null && !error && <span className={styles.muted}>Loading members…</span>}
      {members && (
        <ul className={local.members} aria-label="Members">
          {members.map((m) => (
            <li key={m.userId} className={local.member}>
              <div>
                <span className={styles.name}>{m.displayName}</span>
                <span className={styles.sub}>
                  {m.email || 'Account not found'} · {m.role === 'owner' ? 'Owner' : 'Member'} ·
                  since {joined(m.addedAt)}
                </span>
              </div>
              <button
                type="button"
                className={local.link}
                disabled={busy !== null}
                aria-label={`Remove ${m.email || m.displayName}`}
                onClick={() => void remove(m)}
              >
                {busy === m.userId ? 'Removing…' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className={local.addMember} onSubmit={add} noValidate>
        <label className={local.addField}>
          Add someone by their account email
          <input
            type="email"
            value={email}
            placeholder="name@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <Button type="submit" variant="dark" size="sm" disabled={busy !== null}>
          {busy === 'add' ? 'Adding…' : 'Add member'}
        </Button>
      </form>
    </section>
  );
}
