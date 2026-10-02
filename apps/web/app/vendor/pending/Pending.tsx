'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VendorStanding } from '@fgg/types';
import { Button } from '@/components/Button';
import { AuthCard, authStyles as a } from '@/components/auth/AuthCard';
import { getVendorStanding } from '@/lib/api';
import styles from './pending.module.css';

export function Pending() {
  const router = useRouter();
  const [standing, setStanding] = useState<VendorStanding | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getVendorStanding()
      .then((s) => {
        if (!alive) return;
        if (s.vendor) router.replace('/vendor');
        else if (!s.application) router.replace('/vendor/apply');
        else setStanding(s);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Could not load'));
    return () => {
      alive = false;
    };
  }, [router]);

  if (error) {
    return (
      <AuthCard eyebrow="Hmm" title="We couldn't load your application" tone="pink">
        <p className={a.lead}>{error}</p>
      </AuthCard>
    );
  }
  if (!standing?.application) {
    return (
      <div className={a.skeleton} aria-busy="true" aria-label="Loading">
        <span />
      </div>
    );
  }
  const app = standing.application;

  if (app.status === 'rejected') {
    return (
      <AuthCard eyebrow="Vendor application" title="Not this time" tone="pink">
        <p className={a.lead}>
          We weren&apos;t able to approve <b>{app.businessName}</b> for our shows right now.
          {app.reviewNotes ? ` Notes from the crew: ${app.reviewNotes}` : ''}
        </p>
        <div className={a.actions}>
          <Button href="/vendor/apply" variant="yellow" size="md">
            Apply again
          </Button>
          <Button href="/contact" variant="outline" size="md">
            Ask us a question
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (app.status === 'call_scheduled') {
    return (
      <AuthCard eyebrow="Vendor application" title="Call booked!" tone="aqua">
        <p className={a.lead}>
          Thanks, <b>{app.contactName}</b>. We&apos;ll approve <b>{app.businessName}</b> right after
          we chat, and you&apos;ll get an email the moment table booking opens for you.
        </p>
        <div className={a.actions}>
          <Button href="/#events" variant="outline" size="md">
            Browse upcoming shows
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="Vendor application"
      title="Thanks! Book a quick call with us"
      lead={
        <>
          We got the application for <b>{app.businessName}</b>. Grab a 15-minute slot so we can say
          hi, answer questions and get you approved.
        </>
      }
      tone="aqua"
      wide
    >
      {standing.calendlyUrl ? (
        <div className={styles.calendly}>
          <iframe
            title="Schedule your vendor call"
            src={`${standing.calendlyUrl}${standing.calendlyUrl.includes('?') ? '&' : '?'}hide_gdpr_banner=1&name=${encodeURIComponent(app.contactName)}&email=${encodeURIComponent(app.email)}`}
          />
          <a
            href={standing.calendlyUrl}
            target="_blank"
            rel="noreferrer"
            className={styles.openLink}
          >
            Open the scheduler in a new tab →
          </a>
        </div>
      ) : (
        <p className={a.lead}>
          We&apos;ll be in touch at <b>{app.email}</b> within two business days to set up a call.
        </p>
      )}
      <div className={a.actions}>
        <Button href="/#events" variant="outline" size="md">
          Browse upcoming shows meanwhile
        </Button>
      </div>
    </AuthCard>
  );
}
