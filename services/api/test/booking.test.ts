import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Order } from '@fgg/types';
import { FakeDdb } from './fake-ddb.js';
import { COUNT_EVENT_ID, EVENT_ID, countEvent, event, floorPlan, venue } from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';

const db = new FakeDdb();
const { keys } = await import('../src/lib/db.js');
const booking = await import('../src/lib/booking.js');
const { resolveQuote } = await import('../src/lib/pricing.js');
const { receiptPdf, vendorPassIcs } = await import('../src/lib/documents.js');

const VENDOR = '01HZX3V9K7Q2M4N8P6R5T1W0YD';
const OTHER = '01HZX3V9K7Q2M4N8P6R5T1W0YE';
const SUB = '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';
const quote = (tableId = 'A1', dates = ['2026-10-24', '2026-10-25']) =>
  resolveQuote({
    event,
    floorPlan,
    settings: DEFAULT_SETTINGS,
    lines: [{ tableId, dates }],
    rate: 'standard',
  });
const cart = (lines: { tableId: string; dates: string[] }[]) =>
  resolveQuote({ event, floorPlan, settings: DEFAULT_SETTINGS, lines, rate: 'standard' });

beforeEach(() => db.reset());

describe('holds', () => {
  it('writes one item per day and blocks a second vendor on any overlapping day', async () => {
    const items = await booking.createHold({
      event,
      vendorId: VENDOR,
      heldBy: SUB,
      quote: quote(),
      holdMinutes: 10,
    });
    expect(items).toHaveLength(2);
    expect(db.get(`EVENT#${EVENT_ID}`, 'HOLD#2026-10-24#A1')?.holdId).toBe(items[0]!.holdId);
    await expect(
      booking.createHold({
        event,
        vendorId: OTHER,
        heldBy: 'x',
        quote: quote('A1', ['2026-10-25']),
        holdMinutes: 10,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'table_unavailable' });
    // The failed transaction left nothing behind.
    expect(db.all().filter((i) => String(i.SK).startsWith('HOLD#'))).toHaveLength(2);
  });

  it("ignores expired holds and replaces the vendor's own previous hold", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    db.put({
      ...keys.hold(EVENT_ID, '2026-10-24', 'A1'),
      holdId: 'old',
      eventId: EVENT_ID,
      vendorId: OTHER,
      tableId: 'A1',
      date: '2026-10-24',
      expiresAt: past,
      ttl: 0,
    });
    const first = await booking.createHold({
      event,
      vendorId: VENDOR,
      heldBy: SUB,
      quote: quote('A1', ['2026-10-24']),
      holdMinutes: 10,
    });
    expect(first[0]!.holdId).not.toBe('old');
    const second = await booking.createHold({
      event,
      vendorId: VENDOR,
      heldBy: SUB,
      quote: quote('B2', ['2026-10-24']),
      holdMinutes: 10,
    });
    const holds = db.all().filter((i) => String(i.SK).startsWith('HOLD#'));
    expect(holds).toHaveLength(1);
    expect(holds[0]!.holdId).toBe(second[0]!.holdId);
  });

  it('holds several tables at once and fails the whole cart if any day is taken', async () => {
    const items = await booking.createHold({
      event,
      vendorId: VENDOR,
      heldBy: SUB,
      quote: cart([
        { tableId: 'A1', dates: ['2026-10-24', '2026-10-25'] },
        { tableId: 'A2', dates: ['2026-10-25'] },
      ]),
      holdMinutes: 10,
    });
    expect(items).toHaveLength(3);
    const hold = booking.toTableHold(items);
    expect(
      hold.tables.map((t) => ['tableId' in t && t.tableId, t.dates.length, t.amountCents]),
    ).toEqual([
      ['A1', 2, 40000],
      ['A2', 1, 20000],
    ]);
    expect(hold.subtotalCents).toBe(60000);
    // Another vendor can't take A2 on Sunday, nor A3+A1 as a cart.
    await expect(
      booking.createHold({
        event,
        vendorId: OTHER,
        heldBy: 'x',
        quote: cart([
          { tableId: 'A3', dates: ['2026-10-24'] },
          { tableId: 'A1', dates: ['2026-10-24'] },
        ]),
        holdMinutes: 10,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'table_unavailable' });
    expect(db.get(`EVENT#${EVENT_ID}`, 'HOLD#2026-10-24#A3')).toBeUndefined();
  });

  it('refuses to hold a booked table', async () => {
    db.put({
      ...keys.bookedTable(EVENT_ID, '2026-10-25', 'A1'),
      tableId: 'A1',
      date: '2026-10-25',
      orderId: 'o',
      vendorId: OTHER,
    });
    await expect(
      booking.createHold({ event, vendorId: VENDOR, heldBy: SUB, quote: quote(), holdMinutes: 10 }),
    ).rejects.toMatchObject({ code: 'table_unavailable' });
  });
});

function order(overrides: Partial<Order> = {}): Order {
  const now = '2026-10-01T00:00:00Z';
  return {
    id: '01HZX3V9K7Q2M4N8P6R5T1W0YF',
    eventId: EVENT_ID,
    kind: 'vendor_table',
    source: 'shopify',
    ownerId: VENDOR,
    placedBy: SUB,
    status: 'pending_payment',
    lines: [
      {
        type: 'table',
        tableId: 'A1',
        dates: ['2026-10-24', '2026-10-25'],
        rate: 'standard',
        unitCents: 20000,
        lineCents: 40000,
      },
    ],
    subtotalCents: 40000,
    feeCents: 0,
    taxCents: 0,
    totalCents: 40000,
    vendorInfo: {
      tableName: "Maya's Card Corner",
      contactName: 'Maya',
      phone: '4105550100',
      email: 'maya@cardcorner.com',
      sellsDescription: 'Singles',
      codeOfConductAccepted: true,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('finalizePaidOrder / closeOrder', () => {
  it('takes the table days, removes holds, assigns a sequential pass number, indexes the Shopify id', async () => {
    const items = await booking.createHold({
      event,
      vendorId: VENDOR,
      heldBy: SUB,
      quote: quote(),
      holdMinutes: 10,
    });
    const o = order({ holdId: items[0]!.holdId });
    await booking.writeOrder(o, event.startsAt);
    const paid = await booking.finalizePaidOrder({
      order: o,
      event,
      startsAt: event.startsAt,
      shopifyOrderId: '555',
      shopifyOrderName: '#1001',
      by: 'shopify',
    });
    expect(paid.status).toBe('paid');
    expect(paid.passNumber).toBe('HF26-001');
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')?.orderId).toBe(o.id);
    expect(db.get(`EVENT#${EVENT_ID}`, 'HOLD#2026-10-24#A1')).toBeUndefined();
    expect(db.get('SHOPIFYORDER#555', 'ORDER')?.orderId).toBe(o.id);
    expect(db.get(`ORDER#${o.id}`, 'META')?.GSI2PK).toBe('ORDERS#paid');
    const second = await booking.nextPassNumber(event);
    expect(second).toBe('HF26-002');
  });

  it('throws TableTakenError when another order owns a day, leaving nothing changed', async () => {
    db.put({
      ...keys.bookedTable(EVENT_ID, '2026-10-25', 'A1'),
      tableId: 'A1',
      date: '2026-10-25',
      orderId: 'other',
      vendorId: OTHER,
    });
    const o = order();
    await booking.writeOrder(o, event.startsAt);
    await expect(
      booking.finalizePaidOrder({
        order: o,
        event,
        startsAt: event.startsAt,
        shopifyOrderId: '1',
        by: 'shopify',
      }),
    ).rejects.toBeInstanceOf(booking.TableTakenError);
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')).toBeUndefined();
    expect(db.get(`ORDER#${o.id}`, 'META')?.status).toBe('pending_payment');
  });

  it('closeOrder frees the days for refunded orders and records history', async () => {
    const o = order();
    await booking.writeOrder(o, event.startsAt);
    const paid = await booking.finalizePaidOrder({
      order: o,
      event,
      startsAt: event.startsAt,
      shopifyOrderId: '9',
      by: 'shopify',
    });
    const refunded = await booking.closeOrder(
      paid,
      event,
      event.startsAt,
      'refunded',
      'shopify',
      'test',
    );
    expect(refunded.status).toBe('refunded');
    expect(refunded.refundedAt).toBeDefined();
    expect(db.get(`EVENT#${EVENT_ID}`, 'TABLE#2026-10-24#A1')).toBeUndefined();
    const hist = db
      .all()
      .filter((i) => i.PK === `ORDER#${o.id}` && String(i.SK).startsWith('HIST#'));
    expect(hist.map((h) => h.to)).toEqual(['paid', 'refunded']);
  });
});

describe('quantity events (no floor plan)', () => {
  const BOTH = ['2026-10-24', '2026-10-25'];
  const countQuote = (quantity: number, dates = BOTH) =>
    resolveQuote({
      event: countEvent,
      settings: DEFAULT_SETTINGS,
      lines: [{ quantity, dates }],
      rate: 'standard',
    });
  const hold = (vendorId: string, quantity: number, dates = BOTH) =>
    booking.createHold({
      event: countEvent,
      vendorId,
      heldBy: SUB,
      quote: countQuote(quantity, dates),
      holdMinutes: 10,
    });
  const countOrder = (quantity: number, overrides: Partial<Order> = {}) =>
    order({
      eventId: COUNT_EVENT_ID,
      lines: [
        {
          type: 'unassigned_tables',
          quantity,
          dates: BOTH,
          rate: 'standard',
          unitCents: 20000,
          lineCents: 20000 * quantity * 2,
        },
      ],
      ...overrides,
    });
  const rows = (prefix: string) =>
    db.all().filter((i) => i.PK === `EVENT#${COUNT_EVENT_ID}` && String(i.SK).startsWith(prefix));

  it('holds a number of tables per day and stops at the capacity', async () => {
    const items = await hold(VENDOR, 3);
    expect(items.map((i) => [i.SK, i.quantity])).toEqual([
      [`HOLD#2026-10-24#QTY#${items[0]!.holdId}`, 3],
      [`HOLD#2026-10-25#QTY#${items[0]!.holdId}`, 3],
    ]);
    expect(booking.toTableHold(items).tables).toEqual([
      { quantity: 3, dates: BOTH, unitCents: 20000, amountCents: 120000, pricingInputs: {} },
    ]);
    // 4 per day: one more fits on a day, two do not.
    await expect(hold(OTHER, 2, ['2026-10-25'])).rejects.toMatchObject({
      status: 409,
      code: 'table_unavailable',
      message: 'Only 1 table is left for Sun Oct 25',
    });
    expect(await hold(OTHER, 1, ['2026-10-25'])).toHaveLength(1);
    await expect(hold('v3', 1)).rejects.toMatchObject({
      message: 'Tables are sold out for Sun Oct 25',
    });
    expect(rows('HOLD#')).toHaveLength(3);
  });

  it('holds and books a different number of tables for each day', async () => {
    const quote = resolveQuote({
      event: countEvent,
      settings: DEFAULT_SETTINGS,
      lines: [
        { quantity: 3, dates: ['2026-10-24'] },
        { quantity: 1, dates: ['2026-10-25'] },
      ],
      rate: 'standard',
    });
    const items = await booking.createHold({
      event: countEvent,
      vendorId: VENDOR,
      heldBy: SUB,
      quote,
      holdMinutes: 10,
    });
    expect(items.map((i) => [i.date, i.quantity])).toEqual([
      ['2026-10-24', 3],
      ['2026-10-25', 1],
    ]);
    expect(booking.toTableHold(items).tables).toEqual([
      expect.objectContaining({ quantity: 3, dates: ['2026-10-24'], amountCents: 60000 }),
      expect.objectContaining({ quantity: 1, dates: ['2026-10-25'], amountCents: 20000 }),
    ]);
    // Each day fills on its own: Saturday has 1 left, Sunday 3.
    await expect(hold(OTHER, 2, ['2026-10-24'])).rejects.toMatchObject({
      message: 'Only 1 table is left for Sat Oct 24',
    });
    await hold(OTHER, 3, ['2026-10-25']);

    const o = order({
      eventId: COUNT_EVENT_ID,
      holdId: items[0]!.holdId,
      lines: booking.toTableHold(items).tables.map((t) => ({
        type: 'unassigned_tables' as const,
        quantity: 'quantity' in t ? t.quantity : 0,
        dates: t.dates,
        rate: 'standard' as const,
        unitCents: t.unitCents,
        lineCents: t.amountCents,
      })),
    });
    await booking.writeOrder(o, countEvent.startsAt);
    const paid = await booking.finalizePaidOrder({
      order: o,
      event: countEvent,
      startsAt: countEvent.startsAt,
      by: 'shopify',
    });
    expect(rows('TABLE#').map((r) => [r.date, r.quantity])).toEqual([
      ['2026-10-24', 3],
      ['2026-10-25', 1],
    ]);
    expect(booking.tablesLabel(paid)).toBe('3 tables Sat Oct 24, 1 table Sun Oct 25');
    const ics = vendorPassIcs(paid, countEvent, venue, new Date('2026-10-02T00:00:00Z'));
    expect(ics).toContain('SUMMARY:Winter Fest · Vendor · 3 tables');
    expect(ics).toContain('SUMMARY:Winter Fest · Vendor · 1 table');
  });

  it("frees an expired hold's tables and replaces the vendor's own hold", async () => {
    const first = await hold(OTHER, 4);
    await expect(hold(VENDOR, 1)).rejects.toMatchObject({ code: 'table_unavailable' });
    for (const it of first) db.put({ ...it, expiresAt: new Date(Date.now() - 1000).toISOString() });
    await hold(VENDOR, 2);
    // Asking again swaps the hold rather than stacking on top of it.
    const again = await hold(VENDOR, 4);
    expect(rows('HOLD#').filter((h) => h.vendorId === VENDOR)).toHaveLength(2);
    expect(again[0]!.quantity).toBe(4);
  });

  it('re-reads capacity when another booking lands between the read and the write', async () => {
    await hold(OTHER, 1, ['2026-10-24']);
    // Three more tables sell on Saturday after we counted but before our hold is written.
    db.beforeTransact = () => {
      db.put({
        ...keys.bookedCount(COUNT_EVENT_ID, '2026-10-24', 'other-order'),
        quantity: 3,
        date: '2026-10-24',
        orderId: 'other-order',
        vendorId: 'v3',
      });
      db.put({ ...keys.capacity(COUNT_EVENT_ID), version: 2 });
    };
    await expect(hold(VENDOR, 2, ['2026-10-24'])).rejects.toMatchObject({
      message: 'Tables are sold out for Sat Oct 24',
    });
    expect(rows('HOLD#')).toHaveLength(1);
    // A race that leaves room is retried and goes through.
    db.beforeTransact = () => db.put({ ...keys.capacity(COUNT_EVENT_ID), version: 3 });
    expect(await hold(VENDOR, 2, ['2026-10-25'])).toHaveLength(1);
    expect(db.get(`EVENT#${COUNT_EVENT_ID}`, 'CAPACITY')?.version).toBe(4);
  });

  it('books the tables on payment and gives them back on refund', async () => {
    const items = await hold(VENDOR, 2);
    const o = countOrder(2, { holdId: items[0]!.holdId });
    await booking.writeOrder(o, countEvent.startsAt);
    const paid = await booking.finalizePaidOrder({
      order: o,
      event: countEvent,
      startsAt: countEvent.startsAt,
      shopifyOrderId: '42',
      by: 'shopify',
    });
    expect(paid.status).toBe('paid');
    expect(rows('HOLD#')).toHaveLength(0);
    expect(rows('TABLE#').map((r) => [r.SK, r.quantity])).toEqual([
      [`TABLE#2026-10-24#QTY#${o.id}`, 2],
      [`TABLE#2026-10-25#QTY#${o.id}`, 2],
    ]);
    expect(booking.tablesLabel(paid)).toBe('2 tables');
    expect(booking.orderDates(paid)).toEqual(BOTH);
    // Two of four are gone for good now.
    await expect(hold(OTHER, 3)).rejects.toMatchObject({ code: 'table_unavailable' });
    await booking.closeOrder(paid, countEvent, countEvent.startsAt, 'refunded', 'shopify');
    expect(rows('TABLE#')).toHaveLength(0);
    expect(await hold(OTHER, 4)).toHaveLength(2);
  });

  it('refuses a payment that lands after the hold expired and the room sold', async () => {
    const items = await hold(VENDOR, 2);
    const o = countOrder(2, { holdId: items[0]!.holdId });
    await booking.writeOrder(o, countEvent.startsAt);
    for (const it of items) db.put({ ...it, expiresAt: new Date(Date.now() - 1000).toISOString() });
    await hold(OTHER, 3);
    await expect(
      booking.finalizePaidOrder({
        order: o,
        event: countEvent,
        startsAt: countEvent.startsAt,
        by: 'shopify',
      }),
    ).rejects.toBeInstanceOf(booking.TableTakenError);
    expect(rows('TABLE#')).toHaveLength(0);
  });

  it('writes the pass calendar and receipt without table numbers', async () => {
    const paid = countOrder(2, { status: 'paid', passNumber: 'WF27-001' });
    const ics = vendorPassIcs(paid, countEvent, venue, new Date('2026-10-02T00:00:00Z'));
    expect(ics).toContain('SUMMARY:Winter Fest · Vendor · 2 tables');
    const bytes = await receiptPdf(paid, countEvent, venue);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
  });
});

describe('documents', () => {
  const paid = order({
    status: 'paid',
    passNumber: 'HF26-014',
    paidAt: '2026-10-02T00:00:00Z',
    shopifyOrderId: '555',
  });
  it('builds a calendar with one VEVENT per day at load-in', () => {
    const ics = vendorPassIcs(paid, event, venue, new Date('2026-10-02T00:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261024T090000');
    expect(ics).toContain(`UID:${paid.id}-2026-10-24@feelgoodgaming.com`);
    expect(ics).toContain('LOCATION:Maryland State Fairgrounds\\, 2200 York Rd\\, Timonium\\, MD');
  });
  it('renders a PDF receipt', async () => {
    const bytes = await receiptPdf(paid, event, venue);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });
  it('derives event codes and load-in labels', () => {
    expect(booking.eventCode(event)).toBe('HF26');
    expect(booking.loadInLabel(event, ['2026-10-25', '2026-10-24'])).toBe('Sat Oct 24 · 9am');
  });
});
