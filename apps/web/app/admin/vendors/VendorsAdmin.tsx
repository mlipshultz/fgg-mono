'use client';

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  MAX_VENDOR_TAGS,
  SELLS_LABEL,
  type AdminVendor,
  type AdminVendorInput,
  type LogoContentType,
  type SellsCategory,
  type VendorStatus,
} from '@fgg/types';
import { Button } from '@/components/Button';
import styles from '@/components/admin/admin.module.css';
import ui from '@/components/ui.module.css';
import { adminListVendors, adminUpdateVendor, adminUploadVendorLogo } from '@/lib/api';
import local from './vendors.module.css';

const LOGO_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

/** The form holds text so fields can be empty while they're being typed. */
interface Draft {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  sellsDescription: string;
  sells: SellsCategory[];
  instagram: string;
  tiktok: string;
  website: string;
  status: VendorStatus;
  pokeBucksPartner: boolean;
  logoKey?: string | undefined;
  logoUrl?: string | undefined;
}
const toDraft = (v: AdminVendor): Draft => ({
  businessName: v.businessName,
  contactName: v.contactName,
  email: v.email,
  phone: v.phone,
  sellsDescription: v.sellsDescription,
  sells: v.sells,
  instagram: v.socials.instagram ?? '',
  tiktok: v.socials.tiktok ?? '',
  website: v.socials.website ?? '',
  status: v.status,
  pokeBucksPartner: v.pokeBucksPartner,
  logoKey: v.logoKey,
  logoUrl: v.logoUrl,
});

function toInput(d: Draft): AdminVendorInput | string {
  if (!d.businessName.trim()) return 'The business needs a name.';
  if (!d.contactName.trim()) return 'Add a contact name.';
  if (!/^\S+@\S+\.\S+$/.test(d.email.trim())) return 'Enter a valid email.';
  if (d.phone.replace(/\D/g, '').length < 7) return 'Enter a phone number.';
  if (!d.sellsDescription.trim()) return 'Describe what the store sells.';
  if (d.website.trim() && !/^https?:\/\/\S+$/.test(d.website.trim()))
    return 'The website needs to start with https://';
  return {
    businessName: d.businessName.trim(),
    contactName: d.contactName.trim(),
    email: d.email.trim(),
    phone: d.phone.trim(),
    sellsDescription: d.sellsDescription.trim(),
    sells: d.sells,
    socials: {
      ...(d.instagram.trim() ? { instagram: d.instagram.trim().replace(/^@/, '') } : {}),
      ...(d.tiktok.trim() ? { tiktok: d.tiktok.trim().replace(/^@/, '') } : {}),
      ...(d.website.trim() ? { website: d.website.trim() } : {}),
    },
    status: d.status,
    pokeBucksPartner: d.pokeBucksPartner,
    ...(d.logoKey ? { logoKey: d.logoKey } : {}),
  };
}

/** Every vendor, with an editor to fix details, upload a logo, suspend or mark a PokéBucks partner. */
export function VendorsAdmin() {
  const [vendors, setVendors] = useState<AdminVendor[] | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | VendorStatus>('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminListVendors()
      .then((r) => alive && setVendors(r.items))
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load vendors');
      });
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (vendors ?? []).filter(
      (v) =>
        (!status || v.status === status) &&
        (!q ||
          v.businessName.toLowerCase().includes(q) ||
          v.contactName.toLowerCase().includes(q) ||
          v.email.toLowerCase().includes(q)),
    );
  }, [vendors, query, status]);

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const toggleTag = (t: SellsCategory) =>
    setDraft((d) => {
      if (!d) return d;
      if (d.sells.includes(t)) return { ...d, sells: d.sells.filter((x) => x !== t) };
      if (d.sells.length >= MAX_VENDOR_TAGS) {
        setError(`Up to ${MAX_VENDOR_TAGS} tags.`);
        return d;
      }
      return { ...d, sells: [...d.sells, t] };
    });

  const open = (v: AdminVendor) => {
    setToast(null);
    setError(null);
    setEditing(v.id);
    setDraft(toDraft(v));
  };

  const uploadLogo = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !editing) return;
    if (!LOGO_TYPES.includes(file.type)) return setError('Use a PNG, JPG or WebP image.');
    setBusy('logo');
    setError(null);
    try {
      const up = await adminUploadVendorLogo(editing, file, file.type as LogoContentType);
      patch({ logoKey: up.key, logoUrl: up.logoUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the logo');
    } finally {
      setBusy(null);
    }
  };

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!draft || !editing) return;
    const input = toInput(draft);
    if (typeof input === 'string') return setError(input);
    setBusy('save');
    setError(null);
    try {
      const saved = await adminUpdateVendor(editing, input);
      setVendors((cur) => (cur ?? []).map((v) => (v.id === saved.id ? saved : v)));
      setEditing(null);
      setDraft(null);
      setToast(`Saved ${saved.businessName}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the vendor');
    } finally {
      setBusy(null);
    }
  };

  const field = (k: 'businessName' | 'contactName' | 'email' | 'phone', label: string) => (
    <label>
      {label}
      <input
        value={draft?.[k] ?? ''}
        type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'}
        onChange={(e) => patch({ [k]: e.target.value })}
      />
    </label>
  );

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <span className={ui.eyebrow}>Admin</span>
          <h1 className={styles.title}>Vendors</h1>
        </div>
        {!draft && (
          <div className={styles.filters}>
            <input
              type="search"
              className={styles.input}
              placeholder="Search name or email"
              aria-label="Search vendors"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className={styles.select}
              value={status}
              onChange={(e) => setStatus(e.target.value as '' | VendorStatus)}
              aria-label="Filter by status"
            >
              <option value="">All vendors</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        )}
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
        <form className={styles.card} onSubmit={save} noValidate>
          <span className={styles.cardTitle}>Edit {draft.businessName || 'vendor'}</span>
          <div className={local.logoRow}>
            {draft.logoUrl ? (
              <img src={draft.logoUrl} alt="Logo preview" className={local.logo} />
            ) : (
              <span className={local.logo} />
            )}
            <input
              type="file"
              accept={LOGO_TYPES.join(',')}
              aria-label="Upload logo"
              disabled={busy === 'logo'}
              onChange={(e) => void uploadLogo(e)}
            />
            {busy === 'logo' && <span className={styles.muted}>Uploading…</span>}
          </div>
          <div className={styles.formRow}>
            {field('businessName', 'Business name')}
            {field('contactName', 'Contact name')}
            {field('email', 'Email')}
            {field('phone', 'Phone')}
            <label className={local.wide}>
              About the store
              <textarea
                className={local.textarea}
                rows={3}
                maxLength={1000}
                value={draft.sellsDescription}
                onChange={(e) => patch({ sellsDescription: e.target.value })}
              />
            </label>
          </div>
          <span className={styles.cardTitle}>Tags</span>
          <div className={local.tags} role="group" aria-label="Tags">
            {(Object.keys(SELLS_LABEL) as SellsCategory[]).map((t) => (
              <label key={t} className={local.tag}>
                <input
                  type="checkbox"
                  checked={draft.sells.includes(t)}
                  onChange={() => toggleTag(t)}
                />
                {SELLS_LABEL[t]}
              </label>
            ))}
          </div>
          <span className={styles.cardTitle}>Social</span>
          <div className={styles.formRow}>
            <label>
              Instagram
              <input
                value={draft.instagram}
                placeholder="handle"
                onChange={(e) => patch({ instagram: e.target.value })}
              />
            </label>
            <label>
              TikTok
              <input
                value={draft.tiktok}
                placeholder="handle"
                onChange={(e) => patch({ tiktok: e.target.value })}
              />
            </label>
            <label>
              Website
              <input
                value={draft.website}
                placeholder="https://"
                onChange={(e) => patch({ website: e.target.value })}
              />
            </label>
          </div>
          <span className={styles.cardTitle}>Account</span>
          <div className={`${styles.formRow} ${local.narrow}`}>
            <label>
              Status
              <select
                value={draft.status}
                onChange={(e) => patch({ status: e.target.value as VendorStatus })}
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended (can&apos;t book)</option>
              </select>
            </label>
          </div>
          <label className={local.check}>
            <input
              type="checkbox"
              checked={draft.pokeBucksPartner}
              onChange={(e) => patch({ pokeBucksPartner: e.target.checked })}
            />
            PokéBucks partner (booking defaults to the partner rate)
          </label>
          <div className={local.formActions}>
            <Button type="submit" variant="dark" size="sm" disabled={busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save vendor'}
            </Button>
            <button
              type="button"
              className={local.link}
              onClick={() => {
                setEditing(null);
                setDraft(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Bookings</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr key={v.id}>
                  <td>
                    <span className={styles.name}>{v.businessName}</span>
                    <span className={styles.sub}>
                      {v.memberCount} {v.memberCount === 1 ? 'member' : 'members'}
                      {v.pokeBucksPartner ? ' · PokéBucks partner' : ''}
                    </span>
                  </td>
                  <td>
                    <span className={styles.name}>{v.contactName}</span>
                    <span className={styles.sub}>{v.email}</span>
                  </td>
                  <td>
                    <span
                      className={`${styles.chip} ${v.status === 'suspended' ? local.suspended : ''}`}
                    >
                      {v.status === 'active' ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td>{v.paidOrderCount}</td>
                  <td>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Edit ${v.businessName}`}
                      onClick={() => open(v)}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
              {vendors && shown.length === 0 && (
                <tr>
                  <td colSpan={5} className={styles.emptyRow}>
                    No vendors match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {vendors === null && !error && <p className={styles.muted}>Loading vendors…</p>}
        </div>
      )}
    </main>
  );
}
