'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Attribution, VendorApplicationInput } from '@fgg/types';
import { Button } from '@/components/Button';
import { AuthCard, Field, authStyles as a } from '@/components/auth/AuthCard';
import { useAuth } from '@/components/Providers';
import { getVendorStanding, submitVendorApplication, hasApi } from '@/lib/api';
import v from '@/components/vendor/vendor.module.css';

function readAttribution(): Attribution {
  const q = new URLSearchParams(window.location.search);
  const pick = (k: string) => q.get(k)?.slice(0, 100) || undefined;
  const out: Attribution = {};
  const utmSource = pick('utm_source');
  const utmMedium = pick('utm_medium');
  const utmCampaign = pick('utm_campaign');
  const utmContent = pick('utm_content');
  const adName = q.get('ad_name')?.slice(0, 200) || undefined;
  if (utmSource) out.utmSource = utmSource;
  if (utmMedium) out.utmMedium = utmMedium;
  if (utmCampaign) out.utmCampaign = utmCampaign;
  if (utmContent) out.utmContent = utmContent;
  if (adName) out.adName = adName;
  if (document.referrer) out.referrer = document.referrer.slice(0, 500);
  out.landingPath = (window.location.pathname + window.location.search).slice(0, 300);
  return out;
}

export function ApplyForm() {
  const { user } = useAuth();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [eventSlug, setEventSlug] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [website, setWebsite] = useState('');
  const [sellsDescription, setSellsDescription] = useState('');
  const [pokeBucks, setPokeBucks] = useState<boolean | null>(null);
  const [conduct, setConduct] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEventSlug(new URLSearchParams(window.location.search).get('event'));
    const preview = !hasApi && new URLSearchParams(window.location.search).get('preview') === '1';
    if (preview) {
      setChecking(false);
      return;
    }
    let alive = true;
    getVendorStanding()
      .then((s) => {
        if (!alive) return;
        if (s.vendor) router.replace('/vendor');
        else if (s.application && s.application.status !== 'rejected')
          router.replace('/vendor/pending');
        else setChecking(false);
      })
      .catch(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [user, router]);

  const attribution = useMemo(() => (typeof window === 'undefined' ? {} : readAttribution()), []);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const errs: Record<string, string> = {};
    if (!businessName.trim()) errs.businessName = 'Tell us your business or table name.';
    if (phone.replace(/\D/g, '').length < 7) errs.phone = 'Add a phone number we can reach you at.';
    if (!sellsDescription.trim()) errs.sellsDescription = 'Tell us about your store.';
    if (pokeBucks === null) errs.pokeBucks = 'Let us know either way.';
    if (!conduct) errs.conduct = 'Please agree to the code of conduct.';
    if (!sealed) errs.sealed = 'Please agree to the sealed product policy.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFormError(null);
    const socials: VendorApplicationInput['socials'] = {};
    if (instagram.trim()) socials.instagram = instagram.trim().replace(/^@/, '');
    if (tiktok.trim()) socials.tiktok = tiktok.trim().replace(/^@/, '');
    if (website.trim())
      socials.website = /^https?:/.test(website.trim())
        ? website.trim()
        : `https://${website.trim()}`;
    const input: VendorApplicationInput = {
      businessName: businessName.trim(),
      phone: phone.trim(),
      sellsDescription: sellsDescription.trim().slice(0, 1000),
      socials,
      pokeBucksInterest: pokeBucks === true,
      codeOfConductAccepted: true,
      sealedPolicyAccepted: true,
      attribution,
    };
    try {
      await submitVendorApplication(input);
      router.push(
        eventSlug ? `/vendor/pending?event=${encodeURIComponent(eventSlug)}` : '/vendor/pending',
      );
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not send your application');
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div className={a.skeleton} aria-busy="true" aria-label="Loading">
        <span />
      </div>
    );
  }

  return (
    <AuthCard
      eyebrow="Become a vendor"
      title="Tell us about your table"
      lead="We approve vendors after a quick call so every show stays family-friendly. Takes two minutes."
      tone="aqua"
      wide
    >
      <form className={a.form} onSubmit={submit} noValidate>
        <Field label="Business / table name" error={errors.businessName}>
          <input
            className={`${a.input} ${errors.businessName ? a.invalid : ''}`}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Maya's Card Corner"
            autoComplete="organization"
          />
        </Field>
        <p className={a.hint}>
          Applying as <b>{user?.name ?? 'you'}</b>
          {user?.email ? ` · ${user.email}` : ''}. We&apos;ll use your account for contact.
        </p>
        <Field label="Phone" error={errors.phone}>
          <input
            className={`${a.input} ${errors.phone ? a.invalid : ''}`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(410) 555-0100"
            autoComplete="tel"
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
        <Field
          label="Want 50% off your table with PokéBucks?"
          error={errors.pokeBucks}
          hint="Partners bring a bulk binder and accept the PokéBucks kids earn at the door. Tables are $100/day instead of $200."
        >
          <div className={v.chips} role="group" aria-label="PokéBucks interest">
            <button
              type="button"
              className={`${v.chip} ${v.chipPink}`}
              aria-pressed={pokeBucks === true}
              onClick={() => setPokeBucks(true)}
            >
              Yes, I&apos;m in
            </button>
            <button
              type="button"
              className={`${v.chip} ${v.chipPink}`}
              aria-pressed={pokeBucks === false}
              onClick={() => setPokeBucks(false)}
            >
              Not this time
            </button>
          </div>
        </Field>
        <Field
          label="About your store"
          hint="What you sell and what makes your table worth a stop: singles, sealed, graded, plush, price range."
          error={errors.sellsDescription}
        >
          <textarea
            className={a.input}
            rows={4}
            value={sellsDescription}
            onChange={(e) => setSellsDescription(e.target.value)}
            placeholder="Mostly modern singles and a $1 bulk bin, some sealed ETBs…"
            maxLength={1000}
          />
        </Field>
        <label className={v.checkCard}>
          <input type="checkbox" checked={conduct} onChange={(e) => setConduct(e.target.checked)} />
          <span>
            I agree to the{' '}
            <a href="/vendor/code-of-conduct" target="_blank" rel="noreferrer">
              vendor code of conduct
            </a>
            : family-friendly displays, fair pricing for kids, no counterfeit product.
            {errors.conduct && (
              <span className={a.error} role="alert">
                {' '}
                {errors.conduct}
              </span>
            )}
          </span>
        </label>
        <label className={v.checkCard}>
          <input type="checkbox" checked={sealed} onChange={(e) => setSealed(e.target.checked)} />
          <span>
            I agree to the{' '}
            <a href="/vendor/sealed-policy" target="_blank" rel="noreferrer">
              sealed product policy
            </a>
            .
            {errors.sealed && (
              <span className={a.error} role="alert">
                {' '}
                {errors.sealed}
              </span>
            )}
          </span>
        </label>
        {formError && (
          <div className={a.formError} role="alert">
            {formError}
          </div>
        )}
        <div className={a.actions}>
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? 'Sending…' : 'Send my application'}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
