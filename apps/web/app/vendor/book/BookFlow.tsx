'use client';

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MAX_TABLES_PER_ORDER,
  type EventFloorPlan,
  type HoldResponse,
  type IsoDate,
  type Quote,
  type TableRate,
  type VendorInfo,
  type VendorInfoInput,
} from '@fgg/types';
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
  getVendorProfile,
  listVendorOrders,
  releaseHold,
  updateHold,
} from '@/lib/api';
import {
  RATE_LABEL,
  countdown,
  dayLabel,
  daysLabel,
  daysShort,
  fmtCents,
  openDaysByTable,
  stripeFor,
} from '@/lib/booking';
import { dayOfWeek, shortDateLabel } from '@/lib/dates';
import { type CartLine, CartBody } from './Cart';
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

const byTable = (a: CartLine, b: CartLine) =>
  a.tableId.localeCompare(b.tableId, 'en', { numeric: true });

export function BookFlow() {
  const { user } = useAuth();
  const router = useRouter();
  const [slug, setSlug] = useState<string | null>(null);
  const [data, setData] = useState<EventFloorPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  /** Order-level days: every table gets all its open days, or just this one. */
  const [dayChoice, setDayChoice] = useState<'all' | IsoDate>('all');
  /** The exception path: per-table day toggles in the cart. */
  const [perTable, setPerTable] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rate, setRate] = useState<TableRate>('standard');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [hold, setHold] = useState<HoldResponse | null>(null);
  /** Tables this vendor already paid for at this event → booked days. */
  const [mine, setMine] = useState<Map<string, IsoDate[]>>(new Map());
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const quoteSeq = useRef(0);
  const holdRef = useRef<HoldResponse | null>(null);
  holdRef.current = hold;

  // Load the event + floor plan, resume a hold from sessionStorage.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get('event');
    setSlug(s);
    if (!s) {
      // No show chosen: the dashboard's quick-register list is the place to pick one.
      router.replace('/vendor');
      return;
    }
    let alive = true;
    getEventFloorPlan(s)
      .then(async (d) => {
        if (!alive) return;
        setData(d);
        // PokéBucks partners default to their rate; the switch can still flip it.
        getVendorProfile()
          .then((p) => {
            if (alive && p.pokeBucksPartner) setRate((r) => (holdRef.current ? r : 'poke_bucks'));
          })
          .catch(() => {});
        // Mark what this vendor already owns here (best effort; the map works without it).
        listVendorOrders()
          .then((r) => {
            if (!alive) return;
            const m = new Map<string, IsoDate[]>();
            for (const o of r.orders) {
              if (o.eventId !== d.event.id || o.status !== 'paid') continue;
              for (const l of o.lines) {
                if (l.type !== 'table') continue;
                m.set(l.tableId, [...new Set([...(m.get(l.tableId) ?? []), ...l.dates])].sort());
              }
            }
            setMine(m);
          })
          .catch(() => {});
        try {
          const saved = sessionStorage.getItem(HOLD_KEY);
          if (saved) {
            const { holdId, eventId } = JSON.parse(saved) as { holdId: string; eventId: string };
            if (eventId === d.event.id) {
              const h = await getHold(holdId);
              if (!alive) return;
              if (new Date(h.hold.expiresAt).getTime() > Date.now()) {
                setHold(h);
                setCart(h.hold.tables.map((t) => ({ tableId: t.tableId, dates: t.dates })));
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

  const eventDays = useMemo(() => (data ? data.event.days.map((d) => d.date) : []), [data]);
  const openDays = useMemo(
    () => (data ? openDaysByTable(data.floorPlan, data.availability) : new Map()),
    [data],
  );

  // If availability moves under the cart, drop the days (or tables) that went away.
  useEffect(() => {
    if (hold || !data) return;
    setCart((cur) => {
      let changed = false;
      const next = cur.flatMap((l) => {
        const open = openDays.get(l.tableId) ?? new Set<IsoDate>();
        const dates = l.dates.filter((d) => open.has(d));
        if (dates.length === l.dates.length) return [l];
        changed = true;
        return dates.length ? [{ ...l, dates }] : [];
      });
      return changed ? next : cur;
    });
  }, [openDays, hold, data]);

  // Server quote for exact prices (overrides / windows); a local estimate fills in meanwhile.
  useEffect(() => {
    if (!data || hold || cart.length === 0) {
      setQuote(null);
      return;
    }
    const seq = ++quoteSeq.current;
    const t = setTimeout(() => {
      getQuote(data.event.id, { lines: cart, rate })
        .then((q) => {
          if (seq === quoteSeq.current) setQuote(q);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [data, cart, rate, hold]);

  const unit = data
    ? rate === 'poke_bucks'
      ? data.event.pokeBucksRateCents
      : data.event.tableRateCents
    : 0;
  const served = hold?.quote ?? quote;
  const priced =
    served &&
    served.rate === rate &&
    served.lines.length === cart.length &&
    cart.every((l) =>
      served.lines.some(
        (x) => x.tableId === l.tableId && x.dates.join() === [...l.dates].sort().join(),
      ),
    )
      ? served
      : null;
  const lineCents = (l: CartLine) =>
    priced?.lines.find((x) => x.tableId === l.tableId)?.lineCents ?? unit * l.dates.length;
  const lineUnit = (l: CartLine) =>
    priced?.lines.find((x) => x.tableId === l.tableId)?.unitCents ?? unit;
  const subtotal = priced?.subtotalCents ?? cart.reduce((n, l) => n + lineCents(l), 0);
  const total = priced?.totalCents ?? subtotal;

  const cd = useCountdown(hold?.hold.expiresAt);
  useEffect(() => {
    if (cd?.expired && hold && step !== 3) setExpired(true);
  }, [cd?.expired, hold, step]);

  const toggleTable = (id: string) => {
    if (hold) return;
    setCart((cur) => {
      if (cur.some((l) => l.tableId === id)) return cur.filter((l) => l.tableId !== id);
      if (cur.length >= MAX_TABLES_PER_ORDER) {
        setError(`You can book up to ${MAX_TABLES_PER_ORDER} tables in one order.`);
        return cur;
      }
      const open = openDays.get(id) ?? new Set<IsoDate>();
      const dates = eventDays.filter(
        (d) => open.has(d) && (dayChoice === 'all' || d === dayChoice),
      );
      if (!dates.length) return cur;
      setError(null);
      return [...cur, { tableId: id, dates }].sort(byTable);
    });
  };
  /** Apply an order-level day choice to every table in the cart (drops tables not open then). */
  const chooseDays = (choice: 'all' | IsoDate) => {
    setDayChoice(choice);
    setPerTable(false);
    setCart((cur) =>
      cur.flatMap((l) => {
        const open = openDays.get(l.tableId) ?? new Set<IsoDate>();
        const dates = eventDays.filter((d) => open.has(d) && (choice === 'all' || d === choice));
        return dates.length ? [{ ...l, dates }] : [];
      }),
    );
  };
  const availOn = (d: IsoDate) =>
    data ? data.floorPlan.tables.filter((t) => openDays.get(t.id)?.has(d)).length : 0;
  const toggleLineDay = (id: string, d: IsoDate) =>
    setCart((cur) =>
      cur.map((l) => {
        if (l.tableId !== id) return l;
        const has = l.dates.includes(d);
        if (has && l.dates.length === 1) return l;
        const dates = has
          ? l.dates.filter((x) => x !== d)
          : eventDays.filter((x) => x === d || l.dates.includes(x));
        return { ...l, dates };
      }),
    );
  const removeLine = (id: string) => setCart((cur) => cur.filter((l) => l.tableId !== id));

  const doHold = async () => {
    if (!data || cart.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const h = await createHold(data.event.id, { lines: cart, rate });
      setHold(h);
      sessionStorage.setItem(
        HOLD_KEY,
        JSON.stringify({ holdId: h.hold.id, eventId: data.event.id }),
      );
      setStep(2);
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'table_unavailable') {
        setError(`${e.message}. The map is refreshed; check your cart and try again.`);
        if (slug)
          getEventFloorPlan(slug)
            .then((d) => setData(d))
            .catch(() => {});
      } else setError(e instanceof Error ? e.message : 'Could not hold those tables');
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
    setQuote(null);
    setExpired(false);
    setStep(1);
    if (slug)
      getEventFloorPlan(slug)
        .then((d) => setData(d))
        .catch(() => {});
  };

  const saveInfo = async (info: VendorInfoInput) => {
    if (!hold) return;
    setBusy(true);
    setError(null);
    try {
      setHold(await updateHold(hold.hold.id, info));
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

  const cartLabel = cart.map((l) => l.tableId).join(', ');
  const tablesWord = cart.length === 1 ? 'table' : 'tables';

  if (expired) {
    return (
      <main className={styles.page}>
        <div className={`${a.card} ${a.cardPink} ${styles.expired}`}>
          <span className={styles.eyebrow}>Time&apos;s up</span>
          <h1 className={styles.stepTitle}>Your hold expired</h1>
          <p className={a.lead}>
            We held {cartLabel || 'your tables'} for 10 minutes. They&apos;re back on the map now,
            so pick again and we&apos;ll hold them fresh.
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
  const availCount = data.floorPlan.tables.filter(
    (t) => (openDays.get(t.id)?.size ?? 0) > 0,
  ).length;
  const multiDay = eventDays.length > 1;

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
    const allDates = [...new Set(q.lines.flatMap((l) => l.dates))].sort();
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
                    {ev.name} · {q.lines.length === 1 ? 'Table' : 'Tables'}{' '}
                    {q.lines.map((l) => l.tableId).join(', ')}
                  </div>
                  <div className={styles.summarySub}>
                    {daysLabel(allDates)} · {ev.venue.name}
                  </div>
                </div>
              </div>
              {q.lines.map((l) => (
                <div className={styles.line} key={l.tableId}>
                  <span>
                    Table {l.tableId} · {RATE_LABEL[q.rate]} × {l.dates.length}{' '}
                    {l.dates.length === 1 ? 'day' : 'days'}
                    {multiDay ? ` (${daysShort(eventDays, l.dates)})` : ''}
                  </span>
                  <span>{fmtCents(l.lineCents)}</span>
                </div>
              ))}
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
                Change tables
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Step 1
  const frozen = !!hold;
  const pokeBucksCents = ev.pokeBucksRateCents;
  const summaryLine = cart.length
    ? `${cart.length} ${tablesWord} · ${cartLabel}`
    : 'Nothing picked yet';
  const summarySub = cart.length
    ? `${fmtCents(total)} total · ${rate === 'poke_bucks' ? 'PokéBucks rate' : 'Standard rate'}`
    : 'Tap any open table on the map.';

  const cartBody = (heading: boolean) => (
    <CartBody
      heading={heading}
      cart={cart}
      plan={data.floorPlan}
      eventDays={eventDays}
      openDays={openDays}
      mine={mine}
      perTable={perTable}
      rate={rate}
      pokeBucksCents={pokeBucksCents}
      priced={priced}
      lineUnit={lineUnit}
      lineCents={lineCents}
      subtotal={subtotal}
      total={total}
      frozen={frozen}
      onRate={setRate}
      onToggleLineDay={toggleLineDay}
      onRemove={removeLine}
      onPerTable={() => setPerTable(true)}
      onSameDays={() => chooseDays(dayChoice)}
    >
      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}
    </CartBody>
  );

  const actions = (size: 'lg' | 'md') =>
    hold ? (
      <>
        {size === 'lg' && countdownChip}
        <Button type="button" variant="primary" size={size} block onClick={() => setStep(2)}>
          Continue · {fmtCents(total)} →
        </Button>
        <button type="button" className={v.back} onClick={() => void chooseAnother()}>
          Change tables
        </button>
      </>
    ) : (
      <>
        <Button
          type="button"
          variant="primary"
          size={size}
          block
          disabled={cart.length === 0 || busy}
          onClick={() => void doHold()}
        >
          {busy
            ? 'One sec…'
            : cart.length
              ? `Continue · ${fmtCents(total)} →`
              : 'Pick a table to continue'}
        </Button>
        <span className={styles.holdNote}>
          Your tables are held for 10 minutes once you continue.
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
              <h1 className={styles.h2}>Pick your tables</h1>
            </div>
            <span className={styles.avail}>
              {dayChoice === 'all'
                ? `${availCount} tables open`
                : `${availOn(dayChoice)} open ${dayOfWeek(dayChoice)}`}
            </span>
          </div>
          {multiDay && (
            <div className={styles.days} role="group" aria-label="Days">
              <span>Days</span>
              <button
                type="button"
                className={styles.dayChip}
                aria-pressed={dayChoice === 'all'}
                disabled={frozen}
                onClick={() => chooseDays('all')}
              >
                {eventDays.length === 2 ? 'Both days' : 'All days'}
              </button>
              {eventDays.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`${styles.dayChip} ${styles.dayChipMark}`}
                  style={{ backgroundImage: stripeFor(eventDays, d) }}
                  aria-pressed={dayChoice === d}
                  disabled={frozen}
                  onClick={() => chooseDays(d)}
                >
                  <span>{dayLabel(d)}</span>
                </button>
              ))}
            </div>
          )}
          <FloorPlanMap
            plan={data.floorPlan}
            eventDays={eventDays}
            openDays={openDays}
            mine={mine}
            picked={new Set(cart.map((l) => l.tableId))}
            filterDay={dayChoice === 'all' ? null : dayChoice}
            disabled={frozen}
            onToggle={toggleTable}
          />
          <div className={styles.legend}>
            <span>
              <span className={styles.swatch} /> Open {multiDay ? 'all days' : ''}
            </span>
            {multiDay && (
              <span>
                <span
                  className={`${styles.swatch} ${styles.swatchStripe}`}
                  style={{ backgroundImage: stripeFor(eventDays, eventDays[0]!) }}
                />{' '}
                Striped · open those days only
              </span>
            )}
            <span>
              <span className={`${styles.swatch} ${styles.swatchPick}`} /> In your cart
            </span>
            {mine.size > 0 && (
              <span>
                <span className={`${styles.swatch} ${styles.swatchMine}`} /> Your tables
              </span>
            )}
            <span>
              <span className={`${styles.swatch} ${styles.swatchTaken}`} /> Taken
            </span>
          </div>
        </div>
        <aside className={styles.panel} aria-label="Your tables">
          {cartBody(true)}
          {actions('lg')}
        </aside>
      </div>
      <div
        className={`${styles.sheet} ${sheetOpen ? styles.sheetOpen : ''}`}
        role="dialog"
        aria-label="Your tables"
      >
        <button
          type="button"
          className={styles.sheetHandle}
          aria-expanded={sheetOpen}
          aria-controls="cart-sheet-body"
          onClick={() => setSheetOpen((o) => !o)}
        >
          <span className={styles.grab} aria-hidden="true" />
          <span className={styles.sheetSel}>
            <span className={styles.sheetTile}>{cart.length || '—'}</span>
            <span className={styles.sheetSelText}>
              <span className={styles.sheetName}>{summaryLine}</span>
              <span className={styles.sheetSub}>
                {summarySub} · {sheetOpen ? 'Hide' : 'Details'}
              </span>
            </span>
          </span>
        </button>
        {sheetOpen && (
          <div id="cart-sheet-body" className={styles.sheetBody}>
            {cartBody(false)}
          </div>
        )}
        {!sheetOpen && error && (
          <div className={styles.errorBox} role="alert">
            {error}
          </div>
        )}
        {actions('md')}
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
  onSubmit: (info: VendorInfoInput) => void;
}) {
  const seed = initial ?? prefill;
  const [tableName, setTableName] = useState(seed?.tableName ?? '');
  const [phone, setPhone] = useState(seed?.phone ?? '');
  const [sellsDescription, setSellsDescription] = useState(seed?.sellsDescription ?? '');
  const [agree, setAgree] = useState(!!initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const errs: Record<string, string> = {};
    if (!tableName.trim()) errs.tableName = 'What should we print on your table sign?';
    if (phone.replace(/\D/g, '').length < 7) errs.phone = 'Add a phone number for show day.';
    if (!sellsDescription.trim()) errs.sellsDescription = 'Tell shoppers what you’re bringing.';
    if (!agree) errs.agree = 'Please agree to the code of conduct.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    onSubmit({
      tableName: tableName.trim(),
      phone: phone.trim(),
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
        <p className={a.hint}>
          Booking as <b>{user?.name ?? 'you'}</b>
          {user?.email ? ` · ${user.email}` : ''}. Your receipt and vendor pass go there.
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
