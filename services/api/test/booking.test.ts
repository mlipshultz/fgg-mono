import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Order } from '@fgg/types';
import { FakeDdb } from './fake-ddb.js';
import { EVENT_ID, event, floorPlan, venue } from './fixtures.js';

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
    expect(hold.tables.map((t) => [t.tableId, t.dates.length, t.amountCents])).toEqual([
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
