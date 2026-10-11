'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_TABLES_PER_ORDER,
  type EventFloorPlan,
  type HoldResponse,
  type IsoDate,
  type Quote,
  type TableRate,
  type VendorInfoInput,
} from '@fgg/types';
import { Button } from '@/components/Button';
import { authStyles as a } from '@/components/auth/AuthCard';
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
  listVendorOrders,
  releaseHold,
  updateHold,
} from '@/lib/api';
import {
  dayLabel,
  daysShort,
  fmtCents,
  orderDates,
  tableCountLabel,
  unassignedTables,
} from '@/lib/booking';
import { shortDateLabel } from '@/lib/dates';
import { RateSwitch } from './Cart';
import { type Info, Payment } from './Payment';
import { HOLD_KEY, useCountdown, useReturnFromCheckout } from './hold';
import styles from './book.module.css';

type Step = 1 | 2;

type Counts = Record<IsoDate, number>;

/** Tables per day that a hold reserved (events that book by number hold counts, not spots). */
function heldCounts(h: HoldResponse | null): Counts {
  const out: Counts = {};
  for (const t of h?.hold.tables ?? []) {
    if ('quantity' in t) for (const d of t.dates) out[d] = (out[d] ?? 0) + t.quantity;
  }
  return out;
}

/** "2026-10-24:2|2026-10-25:1", to tell whether two sets of counts are the same. */
const countsKey = (c: Counts) =>
  Object.entries(c)
    .filter(([, n]) => n > 0)
    .map(([d, n]) => `${d}:${n}`)
    .sort()
    .join('|');

/**
 * Booking for an event whose venue has no floor plan yet: one row per day, each with its own
 * number of tables. The vendor pays and FGG assigns the spots later. Same hold → pay steps as
 * the map flow.
 */
export function CountFlow({
  slug,
  initial,
  initialRate,
}: {
  slug: string;
  initial: EventFloorPlan;
  initialRate: TableRate;
}) {
  const { user } = useAuth();
  const [data, setData] = useState(initial);
  const ev = data.event;
  const eventDays = useMemo(() => ev.days.map((d) => d.date), [ev.days]);
  /** Tables wanted per day; a day at 0 isn't booked. */
  const [counts, setCounts] = useState<Counts>({});
  const [rate, setRate] = useState<TableRate>(initialRate);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [hold, setHold] = useState<HoldResponse | null>(null);
  /** Tables this vendor already paid for at this event. */
  const [mine, setMine] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInfo, setLastInfo] = useState<Info | undefined>(undefined);
  const quoteSeq = useRef(0);
  const holdRef = useRef<HoldResponse | null>(null);
  holdRef.current = hold;
  useEffect(() => {
    if (hold?.vendorInfo) {
      const { tableName, phone, sellsDescription } = hold.vendorInfo;
      setLastInfo({ tableName, phone, sellsDescription });
    }
  }, [hold]);

  const held = useMemo(() => heldCounts(hold), [hold]);
  /** Tables still free on a day. Our own hold counts as taken in availability; hand it back. */
  const leftOn = (d: IsoDate) =>
    (data.availability.days.find((x) => x.date === d)?.left ?? 0) + (held[d] ?? 0);
  /** The most one order can take on a day. */
  const maxOn = (d: IsoDate) => Math.min(MAX_TABLES_PER_ORDER, leftOn(d));

  // Start with one table on every day that still has room; resume a hold from sessionStorage.
  useEffect(() => {
    let alive = true;
    setCounts(Object.fromEntries(eventDays.map((d) => [d, leftOn(d) > 0 ? 1 : 0])));
    listVendorOrders()
      .then((r) => {
        if (!alive) return;
        const paid = r.orders.filter((o) => o.eventId === ev.id && o.status === 'paid');
        const n = paid.reduce((sum, o) => sum + unassignedTables(o), 0);
        const days = [...new Set(paid.flatMap(orderDates))].sort();
        setMine(n ? `${tableCountLabel(n)} · ${daysShort(eventDays, days)}` : null);
      })
      .catch(() => {});
    void (async () => {
      try {
        const saved = sessionStorage.getItem(HOLD_KEY);
        if (!saved) return;
        const { holdId, eventId } = JSON.parse(saved) as { holdId: string; eventId: string };
        if (eventId !== ev.id) return;
        const h = await getHold(holdId);
        const count = heldCounts(h);
        if (!alive) return;
        if (countsKey(count) && new Date(h.hold.expiresAt).getTime() > Date.now()) {
          setHold(h);
          setCounts(count);
          setRate(h.hold.rate);
          setStep(2);
        } else sessionStorage.removeItem(HOLD_KEY);
      } catch {
        sessionStorage.removeItem(HOLD_KEY);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refresh = () => {
    getEventFloorPlan(slug)
      .then((d) => setData((cur) => ({ ...cur, availability: d.availability })))
      .catch(() => {});
  };
  // Poll the counts every 20s while choosing.
  useEffect(() => {
    if (step !== 1) return;
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [slug, step]);

  const soldOut = eventDays.every((d) => leftOn(d) === 0);
  // If tables sell while the vendor is choosing, come down to what's left on each day.
  useEffect(() => {
    setCounts((cur) => {
      const next = Object.fromEntries(eventDays.map((d) => [d, Math.min(cur[d] ?? 0, maxOn(d))]));
      return countsKey(next) === countsKey(cur) ? cur : next;
    });
  }, [data.availability, held]);

  /** The cart: one line per day that has tables. */
  const lines = useMemo(
    () =>
      eventDays.flatMap((d) =>
        (counts[d] ?? 0) > 0 ? [{ quantity: counts[d]!, dates: [d] }] : [],
      ),
    [eventDays, counts],
  );
  const key = countsKey(counts);
  /** Does the choice still match what the hold reserved? Then Continue can reuse it. */
  const holdMatches = !!hold && hold.hold.rate === rate && countsKey(held) === key;
  const ready = lines.length > 0;

  // Server quote for the exact price (price windows, fee, tax); a local estimate fills in meanwhile.
  useEffect(() => {
    if (holdMatches || !ready) {
      setQuote(null);
      return;
    }
    const seq = ++quoteSeq.current;
    const t = setTimeout(() => {
      getQuote(ev.id, { lines, rate })
        .then((q) => {
          if (seq === quoteSeq.current) setQuote(q);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [ev.id, key, rate, holdMatches, ready]);

  const served = holdMatches ? hold.quote : quote;
  const servedCounts: Counts = {};
  for (const l of served?.lines ?? [])
    if ('quantity' in l) for (const d of l.dates) servedCounts[d] = l.quantity;
  const priced = served && served.rate === rate && countsKey(servedCounts) === key ? served : null;
  const unit =
    priced?.lines[0]?.unitCents ??
    (rate === 'poke_bucks' ? ev.pokeBucksRateCents : ev.tableRateCents);
  const tableDays = lines.reduce((n, l) => n + l.quantity, 0);
  const subtotal = priced?.subtotalCents ?? unit * tableDays;
  const total = priced?.totalCents ?? subtotal;

  const cd = useCountdown(hold?.hold.expiresAt);
  useEffect(() => {
    if (!cd?.expired || !hold) return;
    if (step === 2) setExpired(true);
    else {
      setHold(null);
      sessionStorage.removeItem(HOLD_KEY);
    }
  }, [cd?.expired, hold, step]);

  const step1 = (d: IsoDate, by: number) => {
    setError(null);
    setCounts((cur) => ({ ...cur, [d]: Math.max(0, Math.min(maxOn(d), (cur[d] ?? 0) + by)) }));
  };

  const doHold = async () => {
    if (!ready) return;
    if (holdMatches) {
      setStep(2);
      window.scrollTo({ top: 0 });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (hold) {
        releaseHold(hold.hold.id).catch(() => {});
        setHold(null);
      }
      const h = await createHold(ev.id, { lines, rate });
      setHold(h);
      sessionStorage.setItem(HOLD_KEY, JSON.stringify({ holdId: h.hold.id, eventId: ev.id }));
      setStep(2);
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'table_unavailable') {
        setError(`${e.message}. The counts are refreshed; adjust and try again.`);
        refresh();
      } else setError(e instanceof Error ? e.message : 'Could not hold those tables');
    } finally {
      setBusy(false);
    }
  };

  const chooseAgain = async () => {
    if (hold) {
      try {
        await releaseHold(hold.hold.id);
      } catch {
        /* expired or gone */
      }
    }
    sessionStorage.removeItem(HOLD_KEY);
    setHold(null);
    setQuote(null);
    setExpired(false);
    setStep(1);
    refresh();
  };

  useReturnFromCheckout(() => setBusy(false));

  /** Save the vendor info on the hold, then hand off to Shopify checkout. */
  const goCheckout = async (info: VendorInfoInput) => {
    if (!hold) return;
    setBusy(true);
    setError(null);
    try {
      const h = await updateHold(hold.hold.id, info);
      setHold(h);
      const res = await checkout(h.hold.id);
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
            We held your {tableDays === 1 ? 'table' : 'tables'} for 10 minutes. They&apos;re back on
            sale now, so book again and we&apos;ll hold them fresh.
          </p>
          <div>
            <Button type="button" variant="primary" size="md" onClick={() => void chooseAgain()}>
              Book again
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const countdownChip = cd && hold && (
    <span
      className={`${styles.countdown} ${!cd.expired && new Date(hold.hold.expiresAt).getTime() - Date.now() < 120_000 ? styles.countdownLow : ''}`}
      aria-live="polite"
    >
      ⏱ Held for {cd.text}
    </span>
  );

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <div className={styles.topbarBrand}>
          <span className={v.tag}>VENDOR SIGN-UP</span>
          <span className={styles.topbarEvent}>{ev.name}</span>
        </div>
        <StepPills current={step} />
      </div>
      <div className={styles.body} style={{ gridTemplateColumns: '1fr' }}>
        {step === 2 && hold ? (
          <Payment
            key={hold.hold.id}
            ev={ev}
            eventDays={eventDays}
            hold={hold}
            user={user}
            busy={busy}
            error={error}
            countdown={countdownChip}
            onCheckout={(info) => void goCheckout(info)}
            fallbackInfo={lastInfo}
            onInfoChange={setLastInfo}
            onBack={() => setStep(1)}
          />
        ) : (
          <div className={styles.stepCard}>
            <div>
              <span className={styles.eyebrow}>
                {shortDateLabel(ev.startDate, ev.endDate)} · {ev.venue.name}
              </span>
              <h1 className={styles.stepTitle}>How many tables?</h1>
            </div>
            <p className={styles.countNote}>
              We&apos;re still working out the floor plan for {ev.venue.name}, so there&apos;s no
              map to pick from yet. Choose how many tables you want each day and we&apos;ll assign
              your spot before the show. Every table is 8ft with 2 chairs and 2 vendor passes.
            </p>
            {mine && (
              <div className={styles.mineStrip}>
                <b>Already yours</b>
                <span>{mine}</span>
              </div>
            )}
            {soldOut ? (
              <div className={styles.errorBox} role="status">
                Tables are sold out for this show.
              </div>
            ) : (
              <>
                <div className={styles.dayRows}>
                  {eventDays.map((d) => {
                    const n = counts[d] ?? 0;
                    const left = leftOn(d);
                    return (
                      <div
                        key={d}
                        className={styles.dayRow}
                        role="group"
                        aria-label={`Tables for ${dayLabel(d)}`}
                      >
                        <div>
                          <div className={styles.dayRowName}>{dayLabel(d)}</div>
                          <div className={styles.selSub}>
                            {left === 0 ? 'Sold out' : `${left} left · ${fmtCents(unit)} each`}
                          </div>
                        </div>
                        <div className={styles.stepper}>
                          <button
                            type="button"
                            className={styles.stepBtn}
                            aria-label={`Fewer tables for ${dayLabel(d)}`}
                            disabled={busy || n <= 0}
                            onClick={() => step1(d, -1)}
                          >
                            −
                          </button>
                          <output className={styles.stepValue} aria-live="polite">
                            {n}
                          </output>
                          <button
                            type="button"
                            className={styles.stepBtn}
                            aria-label={`More tables for ${dayLabel(d)}`}
                            disabled={busy || n >= maxOn(d)}
                            onClick={() => step1(d, 1)}
                          >
                            +
                          </button>
                        </div>
                        <span className={styles.dayRowPrice}>{fmtCents(unit * n)}</span>
                      </div>
                    );
                  })}
                </div>
                <RateSwitch
                  rate={rate}
                  pokeBucksCents={ev.pokeBucksRateCents}
                  disabled={busy}
                  onChange={setRate}
                />
                <div className={styles.lines}>
                  {priced && priced.feeCents > 0 && (
                    <div className={`${styles.line} ${styles.lineMuted}`}>
                      <span>Processing fee</span>
                      <span>{fmtCents(priced.feeCents)}</span>
                    </div>
                  )}
                  {priced && priced.taxCents > 0 && (
                    <div className={`${styles.line} ${styles.lineMuted}`}>
                      <span>Tax</span>
                      <span>{fmtCents(priced.taxCents)}</span>
                    </div>
                  )}
                  <div className={styles.total}>
                    <span>Total</span>
                    <span>{fmtCents(total)}</span>
                  </div>
                </div>
              </>
            )}
            {error && (
              <div className={styles.errorBox} role="alert">
                {error}
              </div>
            )}
            {holdMatches && countdownChip}
            <Button
              type="button"
              variant="primary"
              size="lg"
              block
              disabled={!ready || busy || soldOut}
              onClick={() => void doHold()}
            >
              {busy
                ? 'One sec…'
                : ready
                  ? `Continue · ${fmtCents(total)} →`
                  : 'Add a table to continue'}
            </Button>
            <span className={styles.holdNote}>
              {holdMatches
                ? 'Still held for you. Change anything here and we hold it fresh when you continue.'
                : 'Your tables are held for 10 minutes once you continue, and 10 more when you open checkout.'}
            </span>
          </div>
        )}
      </div>
    </main>
  );
}
