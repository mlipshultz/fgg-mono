'use client';

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { EventFloorPlan, HoldResponse, IsoDate, TableRate, VendorInfo } from '@fgg/types';
import { Button } from '@/components/Button';
import { Field, authStyles as a } from '@/components/auth/AuthCard';
import { useAuth } from '@/components/Providers';
import { StepPills } from '@/components/vendor/StepPills';
import v from '@/components/vendor/vendor.module.css';
import {
  ApiError,
  checkout,
  createHold,
  getEventFloorPlan,
  getHold,
  getQuote,
  releaseHold,
  updateHold,
} from '@/lib/api';
import {
  RATE_LABEL,
  countdown,
  dayLabel,
  daysLabel,
  fmtCents,
  nearbyText,
  tableById,
  unavailableFor,
} from '@/lib/booking';
import { shortDateLabel } from '@/lib/dates';
import { FloorPlanMap } from './FloorPlanMap';
import styles from './book.module.css';

type Step = 1 | 2 | 3;
const HOLD_KEY = 'fgg.hold';

function useCountdown(expiresAt: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return expiresAt ? countdown(expiresAt, now) : null;
}

export function BookFlow() {
  const { user } = useAuth();
  const [slug, setSlug] = useState<string | null>(null);
  const [data, setData] = useState<EventFloorPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dates, setDates] = useState<IsoDate[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [rate, setRate] = useState<TableRate>('standard');
  const [quoteNearby, setQuoteNearby] = useState<string | null>(null);
  const [hold, setHold] = useState<HoldResponse | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const quoteSeq = useRef(0);

  // Load the event + floor plan, resume a hold from sessionStorage.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get('event');
    setSlug(s);
    if (!s) {
      setError('No event selected. Pick a show from the events list.');
      return;
    }
    let alive = true;
    getEventFloorPlan(s)
      .then(async (d) => {
        if (!alive) return;
        setData(d);
        setDates(d.event.days.map((x) => x.date));
        try {
          const saved = sessionStorage.getItem(HOLD_KEY);
          if (saved) {
            const { holdId, eventId } = JSON.parse(saved) as { holdId: string; eventId: string };
            if (eventId === d.event.id) {
              const h = await getHold(holdId);
              if (!alive) return;
              if (new Date(h.hold.expiresAt).getTime() > Date.now()) {
                setHold(h);
                setDates(h.hold.dates);
                setPicked(h.hold.tableId);
                setRate(h.hold.rate);
                setStep(h.vendorInfo ? 3 : 2);
              } else sessionStorage.removeItem(HOLD_KEY);
            }
          }
        } catch {
          sessionStorage.removeItem(HOLD_KEY);
        }
      })
      .catch(
        (e: unknown) =>
          alive && setError(e instanceof Error ? e.message : 'Could not load the floor plan'),
      );
    return () => {
      alive = false;
    };
  }, []);

  // Poll availability every 20s while picking.
  useEffect(() => {
    if (!slug || step !== 1) return;
    const id = setInterval(() => {
      getEventFloorPlan(slug)
        .then((d) => setData((cur) => (cur ? { ...cur, availability: d.availability } : d)))
        .catch(() => {});
    }, 20_000);
    return () => clearInterval(id);
  }, [slug, step]);

  const unavailable = useMemo(
    () => (data ? unavailableFor(data.availability, dates) : new Set<string>()),
    [data, dates],
  );
  useEffect(() => {
    if (picked && unavailable.has(picked) && !hold) setPicked(null);
  }, [picked, unavailable, hold]);

  const table = data && picked ? tableById(data.floorPlan, picked) : undefined;
  const unit = data
    ? rate === 'poke_bucks'
      ? data.event.pokeBucksRateCents
      : data.event.tableRateCents
    : 0;
  const unitShown = hold?.quote.unitCents ?? unit;
  const total = hold?.quote.totalCents ?? unitShown * dates.length;
  const nearby = quoteNearby ?? (data && table ? nearbyText(data.floorPlan, table) : '');

  // Server quote for the nearby text + exact price (overrides / windows).
  useEffect(() => {
    if (!data || !picked || hold || dates.length === 0) return;
    const seq = ++quoteSeq.current;
    getQuote(data.event.id, { tableId: picked, dates, rate })
      .then((q) => {
        if (seq === quoteSeq.current) setQuoteNearby(q.nearby);
      })
      .catch(() => {});
  }, [data, picked, dates, rate, hold]);

  const cd = useCountdown(hold?.hold.expiresAt);
  useEffect(() => {
    if (cd?.expired && hold && step !== 3) setExpired(true);
  }, [cd?.expired, hold, step]);

  const toggleDate = (d: IsoDate) =>
    setDates((cur) => {
      if (cur.includes(d)) return cur.length > 1 ? cur.filter((x) => x !== d) : cur;
      return data!.event.days.map((x) => x.date).filter((x) => x === d || cur.includes(x));
    });

  const doHold = async () => {
    if (!data || !picked) return;
    setBusy(true);
    setError(null);
    try {
      const h = await createHold(data.event.id, { tableId: picked, dates, rate });
      setHold(h);
      sessionStorage.setItem(
        HOLD_KEY,
        JSON.stringify({ holdId: h.hold.id, eventId: data.event.id }),
      );
      setStep(2);
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'table_unavailable') {
        setError(`Someone just grabbed ${picked}. Pick another table.`);
        if (slug)
          getEventFloorPlan(slug)
            .then((d) => setData(d))
            .catch(() => {});
        setPicked(null);
      } else setError(e instanceof Error ? e.message : 'Could not hold that table');
    } finally {
      setBusy(false);
    }
  };

  const chooseAnother = async () => {
    if (hold) {
      try {
        await releaseHold(hold.hold.id);
      } catch {
        /* expired or gone */
      }
    }
    sessionStorage.removeItem(HOLD_KEY);
    setHold(null);
    setQuoteNearby(null);
    setExpired(false);
    setStep(1);
    if (slug)
      getEventFloorPlan(slug)
        .then((d) => setData(d))
        .catch(() => {});
  };

  const saveInfo = async (info: VendorInfo) => {
    if (!hold) return;
    setBusy(true);
    setError(null);
    try {
      const h = await updateHold(hold.hold.id, info);
      setHold({ ...h, vendorInfo: info });
      setStep(3);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your info');
    } finally {
      setBusy(false);
    }
  };

  const goCheckout = async () => {
    if (!hold) return;
    setBusy(true);
    setError(null);
    try {
      const res = await checkout(hold.hold.id);
      sessionStorage.setItem('fgg.order', res.orderId);
      window.location.href = res.invoiceUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start checkout');
      setBusy(false);
    }
  };

  if (expired) {
    return (
      <main className={styles.page}>
        <div className={`${a.card} ${a.cardPink} ${styles.expired}`}>
          <span className={styles.eyebrow}>Time&apos;s up</span>
          <h1 className={styles.stepTitle}>Your hold expired</h1>
          <p className={a.lead}>
            We held {hold?.hold.tableId} for 10 minutes. It&apos;s back on the map now, so pick it
            again (or a neighbor) and we&apos;ll hold it fresh.
          </p>
          <div>
            <Button type="button" variant="primary" size="md" onClick={() => void chooseAnother()}>
              Pick again
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className={styles.page}>
        <div className={`${a.card} ${a.cardPink} ${styles.expired}`}>
          <span className={styles.eyebrow}>Hmm</span>
          <h1 className={styles.stepTitle}>We couldn&apos;t open the floor plan</h1>
          <p className={a.lead}>{error}</p>
          <div>
            <Button href="/#events" variant="yellow" size="md">
              Back to events
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <div className={a.skeleton} aria-busy="true" aria-label="Loading the floor plan">
        <span />
        <span />
      </div>
    );
  }

  const ev = data.event;
  const eyebrow = `${ev.name} · ${shortDateLabel(ev.startDate, ev.endDate)} · ${ev.venue.name}`;
  const totalTables = data.floorPlan.tables.length;
  const availCount = data.floorPlan.tables.filter((t) => !unavailable.has(t.id)).length;

  const topbar = (
    <div className={styles.topbar}>
      <div className={styles.topbarBrand}>
        <span className={v.tag}>VENDOR SIGN-UP</span>
        <span className={styles.topbarEvent}>{ev.name}</span>
      </div>
      <StepPills current={step} />
    </div>
  );

  const countdownChip = cd && hold && (
    <span
      className={`${styles.countdown} ${!cd.expired && new Date(hold.hold.expiresAt).getTime() - Date.now() < 120_000 ? styles.countdownLow : ''}`}
      aria-live="polite"
    >
      ⏱ Held for {cd.text}
    </span>
  );

  if (step === 2 && hold) {
    return (
      <main className={styles.page}>
        {topbar}
        <div className={styles.body} style={{ gridTemplateColumns: '1fr' }}>
          <VendorInfoForm
            initial={hold.vendorInfo}
            prefill={hold.prefill}
            user={user}
            busy={busy}
            error={error}
            countdown={countdownChip}
            onBack={() => setStep(1)}
            onSubmit={saveInfo}
          />
        </div>
      </main>
    );
  }

  if (step === 3 && hold) {
    const q = hold.quote;
    return (
      <main className={styles.page}>
        {topbar}
        <div className={styles.body} style={{ gridTemplateColumns: '1fr' }}>
          <div className={styles.stepCard}>
            <h1 className={styles.stepTitle}>Payment</h1>
            {countdownChip}
            <div className={styles.summary}>
              <div className={styles.summaryHead}>
                {ev.posterUrl ? (
                  <img src={ev.posterUrl} alt="" className={styles.summaryThumb} />
                ) : (
                  <span className={`${styles.summaryThumb} ${styles.summaryThumbEmpty}`} />
                )}
                <div>
                  <div className={styles.summaryTitle}>
                    {ev.name} · Table {q.tableId}
                  </div>
                  <div className={styles.summarySub}>
                    {daysLabel(q.dates)} · {ev.venue.name}
                  </div>
                </div>
              </div>
              <div className={styles.line}>
                <span>
                  {RATE_LABEL[q.rate]} table × {q.dates.length}{' '}
                  {q.dates.length === 1 ? 'day' : 'days'}
                </span>
                <span>{fmtCents(q.amountCents)}</span>
              </div>
              {q.feeCents > 0 && (
                <div className={`${styles.line} ${styles.lineMuted}`}>
                  <span>Processing fee</span>
                  <span>{fmtCents(q.feeCents)}</span>
                </div>
              )}
              {q.taxCents > 0 && (
                <div className={`${styles.line} ${styles.lineMuted}`}>
                  <span>Tax</span>
                  <span>{fmtCents(q.taxCents)}</span>
                </div>
              )}
              <div className={styles.summaryTotal}>
                <span>Total due today</span>
                <span>{fmtCents(q.totalCents)}</span>
              </div>
            </div>
            {error && (
              <div className={styles.errorBox} role="alert">
                {error}
              </div>
            )}
            <Button
              type="button"
              variant="primary"
              size="lg"
              block
              disabled={busy}
              onClick={() => void goCheckout()}
            >
              {busy ? 'Opening checkout…' : 'Continue to secure checkout →'}
            </Button>
            <span className={styles.policy}>
              Full refund up to 14 days before the show. Secure checkout by Shopify.
            </span>
            <div className={v.footerNav}>
              <button type="button" className={v.back} onClick={() => setStep(2)}>
                ← Back
              </button>
              <button type="button" className={v.back} onClick={() => void chooseAnother()}>
                Choose a different table
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Step 1
  const panelBody = (
    <>
      <div className={styles.selRow}>
        <span className={`${styles.selTile} ${picked ? '' : styles.selTileEmpty}`}>
          {picked ?? '—'}
        </span>
        <div>
          <div className={styles.selName}>{picked ? `Table ${picked}` : 'Pick a table'}</div>
          <div className={styles.selSub}>
            {table ? `Row ${table.row} · Main Hall` : 'Tap any white table on the map'}
          </div>
        </div>
      </div>
      {picked && (
        <div className={styles.nearby}>
          <b>Nearby:</b> {nearby}
        </div>
      )}
      <div className={styles.rates}>
        <span className={styles.rateLabel}>Your rate</span>
        <button
          type="button"
          className={styles.rate}
          aria-pressed={rate === 'standard'}
          onClick={() => setRate('standard')}
          disabled={!!hold}
        >
          <span className={styles.rateHead}>
            <span>Standard</span>
            <span>{fmtCents(ev.tableRateCents)}/day</span>
          </span>
          <span className={styles.rateText}>The table, chairs and 2 passes.</span>
        </button>
        <button
          type="button"
          className={styles.rate}
          aria-pressed={rate === 'poke_bucks'}
          onClick={() => setRate('poke_bucks')}
          disabled={!!hold}
        >
          <span className={styles.rateHead}>
            <span>PokéBucks partner</span>
            <span>{fmtCents(ev.pokeBucksRateCents)}/day</span>
          </span>
          <span className={styles.rateText}>
            Bring a bulk binder and sell cards to kids for the PokéBucks they get at the door.
          </span>
        </button>
      </div>
      <div className={styles.lines}>
        <div className={styles.line}>
          <span>{picked ? `Table ${picked}` : 'Table'}</span>
          <span>
            {fmtCents(unitShown)} × {dates.length} {dates.length === 1 ? 'day' : 'days'}
          </span>
        </div>
        <div className={styles.total}>
          <span>Total</span>
          <span>{fmtCents(total)}</span>
        </div>
      </div>
      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}
      {hold ? (
        <>
          {countdownChip}
          <Button type="button" variant="primary" size="lg" block onClick={() => setStep(2)}>
            Continue with {hold.hold.tableId} →
          </Button>
          <button type="button" className={v.back} onClick={() => void chooseAnother()}>
            Choose a different table
          </button>
        </>
      ) : (
        <Button
          type="button"
          variant="primary"
          size="lg"
          block
          disabled={!picked || busy}
          onClick={() => void doHold()}
        >
          {busy ? 'Holding…' : picked ? `Hold ${picked} & continue →` : 'Pick a table to continue'}
        </Button>
      )}
      <span className={styles.holdNote}>
        We hold your table for 10 minutes while you finish checkout.
      </span>
    </>
  );

  return (
    <main className={styles.page}>
      {topbar}
      <div className={styles.body}>
        <div className={styles.main}>
          <div className={styles.headRow}>
            <div>
              <span className={styles.eyebrow}>{eyebrow}</span>
              <h1 className={styles.h2}>Pick your table</h1>
            </div>
            <span className={styles.avail}>
              {availCount} of {totalTables} available
            </span>
          </div>
          <div className={styles.days} role="group" aria-label="Which days">
            <span>Days</span>
            {ev.days.map((d) => (
              <button
                key={d.date}
                type="button"
                className={styles.dayChip}
                aria-pressed={dates.includes(d.date)}
                onClick={() => toggleDate(d.date)}
                disabled={!!hold}
              >
                {dayLabel(d.date)}
              </button>
            ))}
            {ev.days.length > 1 && (
              <button
                type="button"
                className={styles.dayChip}
                aria-pressed={dates.length === ev.days.length}
                onClick={() => setDates(ev.days.map((d) => d.date))}
                disabled={!!hold}
              >
                {ev.days.length === 2 ? 'Both days' : 'All days'}
              </button>
            )}
          </div>
          <FloorPlanMap
            plan={data.floorPlan}
            unavailable={unavailable}
            picked={picked}
            onPick={(id) => !hold && setPicked(id)}
          />
          <div className={styles.legend}>
            <span>
              <span className={styles.swatch} /> Available
            </span>
            <span>
              <span className={`${styles.swatch} ${styles.swatchPick}`} /> Your pick
            </span>
            <span>
              <span className={`${styles.swatch} ${styles.swatchTaken}`} /> Taken
            </span>
            <span className={styles.legendNote}>
              Every table is the same: 8ft, 2 chairs, 2 vendor passes.
            </span>
          </div>
        </div>
        <aside className={styles.panel} aria-label="Your selection">
          {panelBody}
        </aside>
      </div>
      <div className={styles.sheet} role="dialog" aria-label="Your selection">
        <span className={styles.grab} aria-hidden="true" />
        <div className={styles.sheetSel}>
          <span className={styles.sheetTile}>{picked ?? '—'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={styles.sheetName}>
              {picked && table ? `Table ${picked} · Row ${table.row}` : 'Pick a table'}
            </div>
            <div className={styles.sheetSub}>
              {picked ? nearby : 'Tap any white table on the map.'}
            </div>
          </div>
        </div>
        <div className={styles.sheetRates}>
          <button
            type="button"
            className={styles.sheetRate}
            aria-pressed={rate === 'standard'}
            onClick={() => setRate('standard')}
            disabled={!!hold}
          >
            Standard · {fmtCents(ev.tableRateCents)}
          </button>
          <button
            type="button"
            className={styles.sheetRate}
            aria-pressed={rate === 'poke_bucks'}
            onClick={() => setRate('poke_bucks')}
            disabled={!!hold}
          >
            PokéBucks · {fmtCents(ev.pokeBucksRateCents)}
          </button>
        </div>
        {error && (
          <div className={styles.errorBox} role="alert">
            {error}
          </div>
        )}
        {hold ? (
          <Button type="button" variant="primary" size="md" block onClick={() => setStep(2)}>
            Continue with {hold.hold.tableId} · {fmtCents(total)} →
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="md"
            block
            disabled={!picked || busy}
            onClick={() => void doHold()}
          >
            {picked ? `Hold ${picked} · ${fmtCents(total)} →` : 'Pick a table'}
          </Button>
        )}
      </div>
    </main>
  );
}

function VendorInfoForm({
  initial,
  prefill,
  user,
  busy,
  error,
  countdown: cdChip,
  onBack,
  onSubmit,
}: {
  initial: VendorInfo | undefined;
  /** From the vendor profile when nothing has been saved on this hold yet. */
  prefill: HoldResponse['prefill'];
  user: { name: string; email: string } | null;
  busy: boolean;
  error: string | null;
  countdown: React.ReactNode;
  onBack: () => void;
  onSubmit: (info: VendorInfo) => void;
}) {
  const seed = initial ?? prefill;
  const [tableName, setTableName] = useState(seed?.tableName ?? '');
  const [contactName, setContactName] = useState(seed?.contactName ?? user?.name ?? '');
  const [phone, setPhone] = useState(seed?.phone ?? '');
  const [email, setEmail] = useState(seed?.email ?? user?.email ?? '');
  const [sellsDescription, setSellsDescription] = useState(seed?.sellsDescription ?? '');
  const [agree, setAgree] = useState(!!initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const errs: Record<string, string> = {};
    if (!tableName.trim()) errs.tableName = 'What should we print on your table sign?';
    if (!contactName.trim()) errs.contactName = 'Who is running the table?';
    if (phone.replace(/\D/g, '').length < 7) errs.phone = 'Add a phone number for show day.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      errs.email = "Hmm, that email doesn't look right";
    if (!sellsDescription.trim()) errs.sellsDescription = 'Tell shoppers what you’re bringing.';
    if (!agree) errs.agree = 'Please agree to the code of conduct.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    onSubmit({
      tableName: tableName.trim(),
      contactName: contactName.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      sellsDescription: sellsDescription.trim().slice(0, 1000),
      codeOfConductAccepted: true,
    });
  };

  return (
    <form className={styles.stepCard} onSubmit={submit} noValidate>
      <h1 className={styles.stepTitle}>Vendor info</h1>
      {cdChip}
      <div className={a.form}>
        <Field label="Business / table name" error={errors.tableName}>
          <input
            className={`${a.input} ${errors.tableName ? a.invalid : ''}`}
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="Maya's Card Corner"
          />
        </Field>
        <div className={a.two}>
          <Field label="Contact name" error={errors.contactName}>
            <input
              className={`${a.input} ${errors.contactName ? a.invalid : ''}`}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              autoComplete="name"
            />
          </Field>
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
        </div>
        <Field label="Email (receipt goes here)" error={errors.email}>
          <input
            className={`${a.input} ${errors.email ? a.invalid : ''}`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>
        <Field
          label="What are you bringing?"
          hint="Shown on the event's vendor list. Prefilled from your profile; tweak it per show."
          error={errors.sellsDescription}
        >
          <textarea
            className={`${a.input} ${errors.sellsDescription ? a.invalid : ''}`}
            rows={3}
            value={sellsDescription}
            onChange={(e) => setSellsDescription(e.target.value)}
            placeholder="Mostly modern singles and a $1 bulk bin, some sealed ETBs…"
            maxLength={1000}
          />
        </Field>
        <label className={v.checkCard}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            I agree to the{' '}
            <a href="/vendor/code-of-conduct" target="_blank" rel="noreferrer">
              vendor code of conduct
            </a>
            : family-friendly displays, fair pricing for kids, no counterfeit product.
            {errors.agree && (
              <span className={a.error} role="alert">
                {' '}
                {errors.agree}
              </span>
            )}
          </span>
        </label>
      </div>
      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}
      <div className={v.footerNav}>
        <button type="button" className={v.back} onClick={onBack}>
          ← Back
        </button>
        <Button type="submit" variant="primary" size="md" disabled={busy}>
          {busy ? 'Saving…' : 'Continue to payment →'}
        </Button>
      </div>
    </form>
  );
}
