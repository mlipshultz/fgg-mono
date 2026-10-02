'use client';

import { type FormEvent, useRef, useState } from 'react';
import type { VendorProfile, VendorProfileInput } from '@fgg/types';
import { Button } from '@/components/Button';
import { Field, authStyles as a } from '@/components/auth/AuthCard';
import { updateVendorProfile, uploadVendorLogo } from '@/lib/api';
import { initials } from '@/lib/auth';
import { resizeImage } from '@/lib/image';
import styles from './vendor.module.css';

function socialHref(kind: 'instagram' | 'tiktok', handle: string): string {
  return kind === 'instagram' ? `https://instagram.com/${handle}` : `https://tiktok.com/@${handle}`;
}

/** The vendor's public face: logo, business name, what they sell, socials. Editable inline. */
export function ProfileCard({
  profile,
  onChange,
}: {
  profile: VendorProfile;
  onChange: (p: VendorProfile) => void;
}) {
  const [editing, setEditing] = useState(false);
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
          <span className={styles.brandLabel}>What you sell</span>
          <p className={styles.brandSells}>
            {profile.sellsDescription || (
              <em>Not set yet. Shoppers see this on every event you book.</em>
            )}
          </p>
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
            <Button type="button" variant="primary" size="sm" onClick={() => setEditing(true)}>
              Upload a logo
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <ProfileForm
      profile={profile}
      onCancel={() => setEditing(false)}
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
  onSaved,
}: {
  profile: VendorProfile;
  onCancel: () => void;
  onSaved: (p: VendorProfile) => void;
}) {
  const [businessName, setBusinessName] = useState(profile.businessName);
  const [phone, setPhone] = useState(profile.phone);
  const [sellsDescription, setSellsDescription] = useState(profile.sellsDescription);
  const [instagram, setInstagram] = useState(profile.socials.instagram ?? '');
  const [tiktok, setTiktok] = useState(profile.socials.tiktok ?? '');
  const [website, setWebsite] = useState(profile.socials.website ?? '');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | undefined>(profile.logoUrl);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const errs: Record<string, string> = {};
    if (!businessName.trim()) errs.businessName = 'Your business or table name.';
    if (phone.replace(/\D/g, '').length < 7) errs.phone = 'A phone number we can reach you at.';
    if (!sellsDescription.trim()) errs.sellsDescription = 'Tell shoppers what you sell.';
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
        socials,
      };
      if (logoFile) {
        const { blob, contentType } = await resizeImage(logoFile, 512);
        const up = await uploadVendorLogo(blob, contentType);
        input.logoKey = up.key;
      }
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
              onChange={(e) => pickLogo(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              {logoPreview ? 'Change logo' : 'Upload a logo'}
            </Button>
            <span className={styles.brandMeta}>Square works best. PNG, JPG or WebP.</span>
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
          label="What do you sell?"
          hint="Prefills every booking and shows on the event's vendor list."
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
        <button type="button" className={styles.historyLink} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
}
