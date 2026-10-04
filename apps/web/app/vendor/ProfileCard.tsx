'use client';

import { type FormEvent, useRef, useState } from 'react';
import {
  MAX_VENDOR_TAGS,
  SELLS_LABEL,
  type SellsCategory,
  type VendorProfile,
  type VendorProfileInput,
} from '@fgg/types';
import { Button } from '@/components/Button';
import { Field, authStyles as a } from '@/components/auth/AuthCard';
import { updateVendorProfile, uploadVendorLogo } from '@/lib/api';
import { initials } from '@/lib/auth';
import { resizeImage } from '@/lib/image';
import { UNSAVED_MESSAGE, useUnsavedChanges } from '@/lib/useUnsavedChanges';
import styles from './vendor.module.css';

function socialHref(kind: 'instagram' | 'tiktok', handle: string): string {
  return kind === 'instagram' ? `https://instagram.com/${handle}` : `https://tiktok.com/@${handle}`;
}

/** The vendor's public face: logo, business name, about the store, socials. Editable inline. */
export function ProfileCard({
  profile,
  onChange,
}: {
  profile: VendorProfile;
  onChange: (p: VendorProfile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const quickRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /** The "Add your logo" prompt goes straight to the file picker; no form in between. */
  const quickUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { blob, contentType } = await resizeImage(file, 512);
      const up = await uploadVendorLogo(blob, contentType);
      onChange(await updateVendorProfile({ logoKey: up.key }));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Could not upload that image');
    } finally {
      setUploading(false);
      if (quickRef.current) quickRef.current.value = '';
    }
  };

  if (!editing) {
    return (
      <div className={`${styles.card} ${styles.cardYellow}`} id="profile">
        <div className={styles.brandHead}>
          <span className={styles.cardTitle}>Your Brand</span>
          <button type="button" className={styles.historyLink} onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
        <div className={styles.brand}>
          {profile.logoUrl ? (
            <img src={profile.logoUrl} alt="" className={`${styles.logo} ${styles.logoLarge}`} />
          ) : (
            <span
              className={`${styles.logo} ${styles.logoLarge} ${styles.logoEmpty}`}
              aria-hidden="true"
            >
              {initials(profile.businessName)}
            </span>
          )}
          <div className={styles.brandText}>
            <span className={styles.brandName}>{profile.businessName}</span>
            <span className={styles.brandMeta}>
              {profile.contactName} · {profile.email} · {profile.phone}
            </span>
          </div>
        </div>
        <div>
          <span className={styles.brandLabel}>About your store</span>
          <p className={styles.brandSells}>
            {profile.sellsDescription || (
              <em>Not set yet. Shoppers see this on every event you book.</em>
            )}
          </p>
          <div className={styles.tags}>
            {(profile.sells ?? []).map((t) => (
              <span key={t} className={styles.tag}>
                {SELLS_LABEL[t]}
              </span>
            ))}
            {!profile.sells?.length && (
              <span className={styles.brandMeta}>
                No tags yet. Tags help shoppers find you on the event page.
              </span>
            )}
          </div>
        </div>
        {(profile.socials.instagram || profile.socials.tiktok || profile.socials.website) && (
          <div className={styles.socials}>
            {profile.socials.instagram && (
              <a
                href={socialHref('instagram', profile.socials.instagram)}
                target="_blank"
                rel="noreferrer"
              >
                Instagram
              </a>
            )}
            {profile.socials.tiktok && (
              <a
                href={socialHref('tiktok', profile.socials.tiktok)}
                target="_blank"
                rel="noreferrer"
              >
                TikTok
              </a>
            )}
            {profile.socials.website && (
              <a href={profile.socials.website} target="_blank" rel="noreferrer">
                Website
              </a>
            )}
          </div>
        )}
        {!profile.logoUrl && (
          <div className={styles.logoPrompt}>
            <div>
              <b>Add your logo</b>
              <span>
                Recommended. Shoppers see it next to your table on every event&apos;s vendor list.
              </span>
            </div>
            <input
              ref={quickRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              aria-label="Choose a logo image"
              onChange={(e) => void quickUpload(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={uploading}
              onClick={() => quickRef.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Upload a logo'}
            </Button>
            {uploadError && (
              <span className={a.error} role="alert">
                {uploadError}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <ProfileForm
      profile={profile}
      onCancel={() => setEditing(false)}
      onLogoSaved={onChange}
      onSaved={(p) => {
        onChange(p);
        setEditing(false);
      }}
    />
  );
}

function ProfileForm({
  profile,
  onCancel,
  onLogoSaved,
  onSaved,
}: {
  profile: VendorProfile;
  onCancel: () => void;
  /** The logo saves the moment it's picked; the rest of the form stays open. */
  onLogoSaved: (p: VendorProfile) => void;
  onSaved: (p: VendorProfile) => void;
}) {
  const [businessName, setBusinessName] = useState(profile.businessName);
  const [phone, setPhone] = useState(profile.phone);
  const [sellsDescription, setSellsDescription] = useState(profile.sellsDescription);
  const [sells, setSells] = useState<SellsCategory[]>(profile.sells ?? []);
  const [instagram, setInstagram] = useState(profile.socials.instagram ?? '');
  const [tiktok, setTiktok] = useState(profile.socials.tiktok ?? '');
  const [website, setWebsite] = useState(profile.socials.website ?? '');
  const [logoPreview, setLogoPreview] = useState<string | undefined>(profile.logoUrl);
  const [logoState, setLogoState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Picking a logo uploads and saves it right away, matching the dashboard's quick upload.
  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    setLogoPreview(URL.createObjectURL(file));
    setLogoState('saving');
    try {
      const { blob, contentType } = await resizeImage(file, 512);
      const up = await uploadVendorLogo(blob, contentType);
      onLogoSaved(await updateVendorProfile({ logoKey: up.key }));
      setLogoState('saved');
    } catch {
      setLogoPreview(profile.logoUrl);
      setLogoState('error');
    }
  };

  const norm = (v: string) => v.trim();
  const sameTags =
    sells.length === (profile.sells ?? []).length &&
    sells.every((t) => (profile.sells ?? []).includes(t));
  const dirty =
    norm(businessName) !== profile.businessName ||
    norm(phone) !== profile.phone ||
    norm(sellsDescription) !== profile.sellsDescription ||
    !sameTags ||
    norm(instagram) !== (profile.socials.instagram ?? '') ||
    norm(tiktok) !== (profile.socials.tiktok ?? '') ||
    norm(website) !== (profile.socials.website ?? '');
  useUnsavedChanges(dirty && !busy);
  const cancel = () => {
    if (dirty && !window.confirm(UNSAVED_MESSAGE)) return;
    onCancel();
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const errs: Record<string, string> = {};
    if (!businessName.trim()) errs.businessName = 'Your business or table name.';
    if (phone.replace(/\D/g, '').length < 7) errs.phone = 'A phone number we can reach you at.';
    if (!sellsDescription.trim()) errs.sellsDescription = 'Tell shoppers about your store.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const socials: VendorProfileInput['socials'] = {};
      if (instagram.trim()) socials.instagram = instagram.trim().replace(/^@/, '');
      if (tiktok.trim()) socials.tiktok = tiktok.trim().replace(/^@/, '');
      if (website.trim())
        socials.website = /^https?:/.test(website.trim())
          ? website.trim()
          : `https://${website.trim()}`;
      const input: VendorProfileInput = {
        businessName: businessName.trim(),
        phone: phone.trim(),
        sellsDescription: sellsDescription.trim().slice(0, 1000),
        sells,
        socials,
      };
      onSaved(await updateVendorProfile(input));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save your profile');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={`${styles.card} ${styles.cardYellow}`}
      id="profile"
      onSubmit={submit}
      noValidate
    >
      <span className={styles.cardTitle}>Your Brand</span>
      <div className={a.form}>
        <div className={styles.logoRow}>
          {logoPreview ? (
            <img src={logoPreview} alt="" className={styles.logo} />
          ) : (
            <span className={`${styles.logo} ${styles.logoEmpty}`} aria-hidden="true">
              {initials(businessName || profile.businessName)}
            </span>
          )}
          <div className={styles.logoActions}>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => void pickLogo(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={logoState === 'saving'}
              onClick={() => fileRef.current?.click()}
            >
              {logoState === 'saving'
                ? 'Uploading…'
                : logoPreview
                  ? 'Change logo'
                  : 'Upload a logo'}
            </Button>
            <span className={styles.brandMeta}>
              {logoState === 'saved'
                ? 'Logo saved.'
                : logoState === 'error'
                  ? 'That image didn’t upload. Try another file.'
                  : 'Square works best. PNG, JPG or WebP. Saves as soon as you pick it.'}
            </span>
          </div>
        </div>
        <Field label="Business / table name" error={errors.businessName}>
          <input
            className={`${a.input} ${errors.businessName ? a.invalid : ''}`}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </Field>
        <p className={a.hint}>
          Contact: <b>{profile.contactName}</b> · {profile.email}. This follows the account that
          applied; phone is yours to set.
        </p>
        <Field label="Phone" error={errors.phone}>
          <input
            className={`${a.input} ${errors.phone ? a.invalid : ''}`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />
        </Field>
        <Field
          label="About your store"
          hint="What you sell and what makes your table worth a stop. Prefills every booking and shows on the event's vendor list."
          error={errors.sellsDescription}
        >
          <textarea
            className={`${a.input} ${errors.sellsDescription ? a.invalid : ''}`}
            rows={4}
            value={sellsDescription}
            onChange={(e) => setSellsDescription(e.target.value)}
            placeholder="Mostly modern singles and a $1 bulk bin, some sealed ETBs…"
            maxLength={1000}
          />
        </Field>
        <Field
          label="Tags"
          hint={`Pick up to ${MAX_VENDOR_TAGS}. Attendees filter the event's vendor list by these.`}
        >
          <div className={styles.tagPicks} role="group" aria-label="Tags">
            {(Object.keys(SELLS_LABEL) as SellsCategory[]).map((t) => {
              const on = sells.includes(t);
              return (
                <label key={t} className={`${styles.tagPick} ${on ? styles.tagPickOn : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && sells.length >= MAX_VENDOR_TAGS}
                    onChange={() =>
                      setSells((cur) => (on ? cur.filter((x) => x !== t) : [...cur, t]))
                    }
                  />
                  {SELLS_LABEL[t]}
                </label>
              );
            })}
          </div>
        </Field>
        <div className={a.two}>
          <Field label="Instagram" hint="Optional">
            <input
              className={a.input}
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="yourhandle"
            />
          </Field>
          <Field label="TikTok" hint="Optional">
            <input
              className={a.input}
              value={tiktok}
              onChange={(e) => setTiktok(e.target.value)}
              placeholder="yourhandle"
            />
          </Field>
        </div>
        <Field label="Website" hint="Optional">
          <input
            className={a.input}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="yourshop.com"
            inputMode="url"
          />
        </Field>
      </div>
      {formError && (
        <div className={a.error} role="alert">
          {formError}
        </div>
      )}
      <div className={styles.formNav}>
        <button type="button" className={styles.historyLink} onClick={cancel} disabled={busy}>
          Cancel
        </button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
}
