'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MAX_TABLES_PER_ORDER,
  type EventFloorPlan,
  type FloorPlan,
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
  getVendorProfile,
  listVendorOrders,
  releaseHold,
  updateHold,
} from '@/lib/api';
import {
  fmtCents,
  openDaysByTable,
  priceWindowNote,
  tableById,
  tableUnitCents,
} from '@/lib/booking';
import { shortDateLabel } from '@/lib/dates';
import { type CartLine, CartBody } from './Cart';
import { CountFlow } from './CountFlow';
import {
  DEFAULT_TERMS,
  HOLD_KEY,
  holdNote,
  minutes,
  useCountdown,
  useReturnFromCheckout,
} from './hold';
import { type Info, Payment } from './Payment';
import { Picker } from './Picker';
import { TableConfirm } from './TableConfirm';
import styles from './book.module.css';

type Step = 1 | 2;
/** An event that books on a floor plan, which is then always there. */
type PlanData = EventFloorPlan & { floorPlan: FloorPlan };
const withPlan = (d: EventFloorPlan): PlanData | null =>
  d.floorPlan ? { ...d, floorPlan: d.floorPlan } : null;
/** The specific tables on a hold or quote (events that book by number have none). */
const spots = <T extends object>(lines: T[]) =>
  lines.flatMap((l) => ('tableId' in l ? [l as Extract<T, { tableId: string }>] : []));

const byTable = (a: CartLine, b: CartLine) =>
  a.tableId.localeCompare(b.tableId, 'en', { numeric: true });

/**
 * Loads the event, then books it the way the event is set up: tables picked on the floor plan,
 * or a number of tables when the venue's layout isn't known yet.
 */
export function BookFlow() {
  const router = useRouter();
  const [slug, setSlug] = useState<string | null>(null);
  const [data, setData] = useState<EventFloorPlan | null>(null);
  /** PokéBucks partners default to their rate; the switch can still flip it. */
  const [rate, setRate] = useState<TableRate>('standard');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('event');
    setSlug(s);
    if (!s) {
      // No show chosen: send the vendor to their dashboard.
      router.replace('/vendor');
      return;
    }
    let alive = true;
    // The vendor's rate loads with the event, so the PokéBucks switch and prices start out right
    // instead of flipping a moment after the page appears.
    const partner = getVendorProfile()
      .then((p) => p.pokeBucksPartner)
      .catch(() => false);
    Promise.all([getEventFloorPlan(s), partner])
      .then(([d, isPartner]) => {
        if (!alive) return;
        setRate(isPartner ? 'poke_bucks' : 'standard');
        setData(d);
      })
      .catch(
        (e: unknown) =>
          alive && setError(e instanceof Error ? e.message : 'Could not load the floor plan'),
      );
    return () => {
      alive = false;
    };
  }, []);

  const byCount = data?.event.tableBooking === 'quantity';
  const plan = data && !byCount ? withPlan(data) : null;
  if (error || (data && !byCount && !plan)) {
    return (
      <main className={styles.page}>
        <div className={`${a.card} ${a.cardPink} ${styles.expired}`}>
          <span className={styles.eyebrow}>Hmm</span>
          <h1 className={styles.stepTitle}>We couldn&apos;t open the floor plan</h1>
          <p className={a.lead}>{error ?? 'This venue has no floor plan yet.'}</p>
          <div>
            <Button href="/#events" variant="yellow" size="md">
              Back to events
            </Button>
          </div>
        </div>
      </main>
    );
  }
  if (!data || !slug) {
    return (
      <div className={a.skeleton} aria-busy="true" aria-label="Loading the floor plan">
        <span />
        <span />
      </div>
    );
  }
  return plan ? (
    <MapFlow slug={slug} initial={plan} initialRate={rate} />
  ) : (
    <CountFlow slug={slug} initial={data} initialRate={rate} />
  );
}

function MapFlow({
  slug,
  initial,
  initialRate,
}: {
  slug: string;
  initial: PlanData;
  initialRate: TableRate;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<PlanData>(initial);
  const terms = data.terms ?? DEFAULT_TERMS;
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  /** Days the map shows (filters cells and seeds the table confirm); never empty. */
  const [shownDays, setShownDays] = useState<Set<IsoDate>>(new Set());
  /** Table whose days are being chosen in the confirm card. */
  const [pending, setPending] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rate, setRate] = useState<TableRate>(initialRate);
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
  /** Info from the last hold, so editing tables doesn't lose what was typed on Pay. */
  const [lastInfo, setLastInfo] = useState<Info | undefined>(undefined);
  useEffect(() => {
    if (hold?.vendorInfo) {
      const { tableName, phone, sellsDescription } = hold.vendorInfo;
      setLastInfo({ tableName, phone, sellsDescription });
    }
  }, [hold]);

  // Mark what's already this vendor's and resume a hold from sessionStorage.
  useEffect(() => {
    let alive = true;
    const d = initial;
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
    void (async () => {
      try {
        const saved = sessionStorage.getItem(HOLD_KEY);
        if (saved) {
          const { holdId, eventId } = JSON.parse(saved) as { holdId: string; eventId: string };
          if (eventId === d.event.id) {
            const h = await getHold(holdId);
            if (!alive) return;
            if (new Date(h.hold.expiresAt).getTime() > Date.now()) {
              setHold(h);
              setCart(spots(h.hold.tables).map((t) => ({ tableId: t.tableId, dates: t.dates })));
              setRate(h.hold.rate);
              setStep(2);
            } else sessionStorage.removeItem(HOLD_KEY);
          }
        }
      } catch {
        sessionStorage.removeItem(HOLD_KEY);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Poll availability every 20s while picking.
  useEffect(() => {
    if (step !== 1) return;
    const id = setInterval(() => {
      getEventFloorPlan(slug)
        .then((d) => setData((cur) => ({ ...cur, availability: d.availability })))
        .catch(() => {});
    }, 20_000);
    return () => clearInterval(id);
  }, [slug, step]);

  const eventDays = useMemo(() => data.event.days.map((d) => d.date), [data]);
  // Seed the Available checkboxes once per event. Keyed on the dates themselves: the 20s
  // availability poll replaces `data`, which must not reset what the vendor unchecked.
  const dayKey = eventDays.join(',');
  useEffect(() => {
    setShownDays(new Set(dayKey ? (dayKey.split(',') as IsoDate[]) : []));
  }, [dayKey]);
  const openDays = useMemo(() => {
    const m = openDaysByTable(data.floorPlan, data.availability);
    // Our own hold shows as taken in availability; hand those days back so they stay editable.
    for (const t of spots(hold?.hold.tables ?? [])) {
      const set = m.get(t.tableId) ?? new Set<IsoDate>();
      for (const d of t.dates) set.add(d);
      m.set(t.tableId, set);
    }
    return m;
  }, [data, hold]);

  /** Does the cart still match what the hold reserved? Then Continue can reuse it. */
  const key = (lines: { tableId: string; dates: IsoDate[] }[]) =>
    [...lines]
      .map((l) => `${l.tableId}:${[...l.dates].sort().join('+')}`)
      .sort()
      .join('|');
  const holdMatches =
    !!hold && hold.hold.rate === rate && key(spots(hold.hold.tables)) === key(cart);

  // If availability moves under the cart, drop the days (or tables) that went away.
  useEffect(() => {
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
  }, [openDays, data]);

  // Server quote for exact prices (overrides / windows); a local estimate fills in meanwhile.
  useEffect(() => {
    if (holdMatches || cart.length === 0) {
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
  }, [data, cart, rate, holdMatches]);

  /** The per-day rate in force now (price window or base); tables add their own premium. */
  const pricing = data.pricing ?? data.event;
  const unit = rate === 'poke_bucks' ? pricing.pokeBucksRateCents : pricing.tableRateCents;
  const unitOf = (id: string) => tableUnitCents(tableById(data.floorPlan, id), unit);
  const served = holdMatches ? hold.quote : quote;
  const servedLines = spots(served?.lines ?? []);
  const priced =
    served &&
    served.rate === rate &&
    servedLines.length === cart.length &&
    cart.every((l) =>
      servedLines.some(
        (x) => x.tableId === l.tableId && x.dates.join() === [...l.dates].sort().join(),
      ),
    )
      ? served
      : null;
  const pricedLine = (l: CartLine) =>
    priced ? servedLines.find((x) => x.tableId === l.tableId) : undefined;
  const lineCents = (l: CartLine) => pricedLine(l)?.lineCents ?? unitOf(l.tableId) * l.dates.length;
  const lineUnit = (l: CartLine) => pricedLine(l)?.unitCents ?? unitOf(l.tableId);
  const subtotal = priced?.subtotalCents ?? cart.reduce((n, l) => n + lineCents(l), 0);
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

  const availOn = (d: IsoDate) =>
    data.floorPlan.tables.filter((t) => openDays.get(t.id)?.has(d)).length;
  const toggleShownDay = (d: IsoDate) =>
    setShownDays((cur) => {
      const next = new Set(cur);
      if (next.has(d)) {
        if (next.size === 1) return cur; // keep at least one day on the map
        next.delete(d);
      } else next.add(d);
      return next;
    });
  /** Tap a table: single-day events add it straight away; otherwise open the day picker. */
  const pickTable = (id: string) => {
    if (busy) return;
    const open = openDays.get(id) ?? new Set<IsoDate>();
    if (!open.size) return;
    setError(null);
    if (eventDays.length === 1) {
      setCart((cur) =>
        cur.some((l) => l.tableId === id)
          ? cur.filter((l) => l.tableId !== id)
          : [...cur, { tableId: id, dates: [...open] }].sort(byTable),
      );
      return;
    }
    setPending((cur) => (cur === id ? null : id));
  };
  const confirmTable = (id: string, dates: IsoDate[]) => {
    setCart((cur) => {
      const rest = cur.filter((l) => l.tableId !== id);
      if (rest.length >= MAX_TABLES_PER_ORDER) {
        setError(`You can book up to ${MAX_TABLES_PER_ORDER} tables in one order.`);
        return cur;
      }
      return [...rest, { tableId: id, dates }].sort(byTable);
    });
    setPending(null);
  };
  const removeLine = (id: string) => {
    setCart((cur) => cur.filter((l) => l.tableId !== id));
    setPending(null);
  };
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

  const refresh = () => {
    getEventFloorPlan(slug)
      .then((d) => setData((cur) => withPlan(d) ?? cur))
      .catch(() => {});
  };

  const doHold = async () => {
    if (cart.length === 0) return;
    setPending(null);
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
        refresh();
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

  const cartLabel = cart.map((l) => l.tableId).join(', ');
  const tablesWord = cart.length === 1 ? 'table' : 'tables';

  if (expired) {
    return (
      <main className={styles.page}>
        <div className={`${a.card} ${a.cardPink} ${styles.expired}`}>
          <span className={styles.eyebrow}>Time&apos;s up</span>
          <h1 className={styles.stepTitle}>Your hold expired</h1>
          <p className={a.lead}>
            We held {cartLabel || 'your tables'} for {minutes(terms.holdMinutes)}. They&apos;re back
            on the map now, so pick again and we&apos;ll hold them fresh.
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

  const ev = data.event;
  const eyebrow = `${shortDateLabel(ev.startDate, ev.endDate)} · ${ev.venue.name}`;
  const availCount = data.floorPlan.tables.filter(
    (t) => (openDays.get(t.id)?.size ?? 0) > 0,
  ).length;

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

  // Step 1
  const frozen = busy;
  const pokeBucksCents = pricing.pokeBucksRateCents;
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
    >
      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}
    </CartBody>
  );

  const pendingLine = pending ? cart.find((l) => l.tableId === pending) : undefined;
  const pendingOpen = pending ? (openDays.get(pending) ?? new Set<IsoDate>()) : null;
  const confirm = pending && pendingOpen && (
    <TableConfirm
      key={pending}
      tableId={pending}
      rowLabel={(() => {
        const t = tableById(data.floorPlan, pending);
        return t ? `Row ${t.row}` : 'Main Hall';
      })()}
      eventDays={eventDays}
      openDays={pendingOpen}
      initial={
        pendingLine?.dates ??
        (() => {
          const shown = eventDays.filter((d) => pendingOpen.has(d) && shownDays.has(d));
          return shown.length ? shown : eventDays.filter((d) => pendingOpen.has(d));
        })()
      }
      unitCents={unitOf(pending)}
      inCart={!!pendingLine}
      onConfirm={(dates) => confirmTable(pending, dates)}
      onRemove={() => removeLine(pending)}
      onCancel={() => setPending(null)}
    />
  );

  const actions = (size: 'lg' | 'md') => (
    <>
      {size === 'lg' && holdMatches && countdownChip}
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
        {holdMatches
          ? 'Still held for you. Change anything here and we hold it fresh when you continue.'
          : holdNote(terms)}
      </span>
    </>
  );

  return (
    <main className={styles.page}>
      {topbar}
      {step === 2 && hold ? (
        <div className={styles.body} style={{ gridTemplateColumns: '1fr' }}>
          <Payment
            key={hold.hold.id}
            ev={ev}
            terms={terms}
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
        </div>
      ) : (
        <Picker
          eyebrow={eyebrow}
          priceNote={priceWindowNote(data.pricing)}
          plan={data.floorPlan}
          eventDays={eventDays}
          openDays={openDays}
          mine={mine}
          picked={new Set(cart.map((l) => l.tableId))}
          shownDays={shownDays}
          frozen={frozen}
          availCount={availCount}
          availOn={availOn}
          onToggleShownDay={toggleShownDay}
          onPickTable={pickTable}
          pendingTable={pending}
          confirm={confirm}
          cartBody={cartBody}
          actions={actions}
          summaryLine={summaryLine}
          summarySub={summarySub}
          sheetOpen={sheetOpen}
          onSheetToggle={() => setSheetOpen((o) => !o)}
          sheetError={error}
        />
      )}
    </main>
  );
}
