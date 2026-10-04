'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  getVendorProfile,
  listVendorOrders,
  releaseHold,
  updateHold,
} from '@/lib/api';
import { countdown, fmtCents, openDaysByTable, tableById } from '@/lib/booking';
import { shortDateLabel } from '@/lib/dates';
import { type CartLine, CartBody } from './Cart';
import { type Info, Payment } from './Payment';
import { Picker } from './Picker';
import { TableConfirm } from './TableConfirm';
import styles from './book.module.css';

type Step = 1 | 2;
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
  /** Days the map shows (filters cells and seeds the table confirm); never empty. */
  const [shownDays, setShownDays] = useState<Set<IsoDate>>(new Set());
  /** Table whose days are being chosen in the confirm card. */
  const [pending, setPending] = useState<string | null>(null);
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
  /** Info from the last hold, so editing tables doesn't lose what was typed on Pay. */
  const [lastInfo, setLastInfo] = useState<Info | undefined>(undefined);
  useEffect(() => {
    if (hold?.vendorInfo) {
      const { tableName, phone, sellsDescription } = hold.vendorInfo;
      setLastInfo({ tableName, phone, sellsDescription });
    }
  }, [hold]);

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
                setStep(2);
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
  useEffect(() => {
    setShownDays(new Set(eventDays));
  }, [eventDays]);
  const openDays = useMemo(() => {
    if (!data) return new Map<string, Set<IsoDate>>();
    const m = openDaysByTable(data.floorPlan, data.availability);
    // Our own hold shows as taken in availability; hand those days back so they stay editable.
    for (const t of hold?.hold.tables ?? []) {
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
  const holdMatches = !!hold && hold.hold.rate === rate && key(hold.hold.tables) === key(cart);

  // If availability moves under the cart, drop the days (or tables) that went away.
  useEffect(() => {
    if (!data) return;
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
    if (!data || holdMatches || cart.length === 0) {
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

  const unit = data
    ? rate === 'poke_bucks'
      ? data.event.pokeBucksRateCents
      : data.event.tableRateCents
    : 0;
  const served = holdMatches ? hold.quote : quote;
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
    if (!cd?.expired || !hold) return;
    if (step === 2) setExpired(true);
    else {
      setHold(null);
      sessionStorage.removeItem(HOLD_KEY);
    }
  }, [cd?.expired, hold, step]);

  const availOn = (d: IsoDate) =>
    data ? data.floorPlan.tables.filter((t) => openDays.get(t.id)?.has(d)).length : 0;
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

  const doHold = async () => {
    if (!data || cart.length === 0) return;
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
      unitCents={unit}
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
          : 'Your tables are held for 10 minutes once you continue.'}
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
