import { ulid } from 'ulid';
import {
  CancelRequestInput,
  QuoteInput,
  UpdateHoldInput,
  type CheckoutResponse,
  type Event,
  type FloorPlan,
  type HoldResponse,
  type Order,
  type PriceWindow,
  type Settings,
  type Vendor,
  type VendorDashboard,
  type VendorInfo,
  type VendorOrder,
  type VendorOrderList,
  type Venue,
} from '@fgg/types';
import { claimsFrom, type Actor } from '../lib/auth.js';
import {
  createHold,
  history,
  loadHold,
  quoteFromHold,
  releaseHold,
  shortDate,
  toTableHold,
  toVendorOrder,
  updateHoldItems,
  writeOrder,
} from '../lib/booking.js';
import {
  getEvent,
  getEventBySlug,
  getFloorPlan,
  getOrder,
  getSettings,
  getVendorForUser,
  listOrdersForOwner,
  listPriceWindows,
  listPublishedEvents,
  type HoldItem,
} from '../lib/db.js';
import { receiptPdf, vendorPassIcs } from '../lib/documents.js';
import { todayIso, toPublicEvents, venueFor } from '../lib/events.js';
import { HttpError, Router, json, parseBody, type Req, type Res } from '../lib/http.js';
import { require as requireCan } from '../lib/permissions.js';
import { nearbyText, resolveQuote } from '../lib/pricing.js';
import { shopify } from '../lib/shopify.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const STAGE = process.env.STAGE ?? 'dev';

interface Ctx {
  event: Event;
  venue: Venue;
  floorPlan: FloorPlan;
  priceWindows: PriceWindow[];
  settings: Settings;
}

async function vendorFor(actor: Actor): Promise<Vendor> {
  requireCan(actor, 'book_tables');
  const v = await getVendorForUser(actor.sub);
  if (!v)
    throw new HttpError(403, 'no_vendor', 'Your account is not attached to an approved vendor');
  if (v.status !== 'active')
    throw new HttpError(403, 'vendor_suspended', 'This vendor account is suspended');
  return v;
}

async function eventCtx(idOrSlug: string, requireOpen = true): Promise<Ctx> {
  const ev = ULID_RE.test(idOrSlug) ? await getEvent(idOrSlug) : await getEventBySlug(idOrSlug);
  if (!ev || !ev.published) throw new HttpError(404, 'event_not_found', 'Event not found');
  if (requireOpen && ev.vendorStatus !== 'open') {
    throw new HttpError(409, 'vendor_tables_closed', 'Vendor tables are not open for this event');
  }
  const [venue, floorPlan, priceWindows, settings] = await Promise.all([
    venueFor(ev.venueId),
    getFloorPlan(ev.venueId),
    listPriceWindows(ev.id),
    getSettings(),
  ]);
  if (!venue) throw new HttpError(500, 'venue_missing', 'Venue missing');
  if (!floorPlan) throw new HttpError(409, 'no_floor_plan', 'This venue has no floor plan yet');
  return { event: ev, venue, floorPlan, priceWindows, settings };
}

async function holdResponse(items: HoldItem[], ctx: Ctx): Promise<HoldResponse> {
  const table = ctx.floorPlan.tables.find((t) => t.id === items[0]!.tableId);
  const rowLabel = table ? `Row ${table.row} · Main Hall` : items[0]!.tableId;
  const nearby = table ? nearbyText(table, ctx.floorPlan) : '';
  const [event] = await toPublicEvents([ctx.event]);
  const vi = items[0]!.vendorInfo as VendorInfo | undefined;
  return {
    hold: toTableHold(items),
    quote: quoteFromHold(items, rowLabel, nearby),
    event: event!,
    ...(vi ? { vendorInfo: vi } : {}),
  };
}

function parseQuoteQuery(q: Record<string, string | undefined>) {
  return QuoteInput.parse({
    tableId: q.tableId,
    dates: (q.dates ?? '').split(',').filter(Boolean),
    rate: q.rate ?? 'standard',
  });
}

async function ownedOrder(actor: Actor, id: string): Promise<{ order: Order; vendor: Vendor }> {
  const vendor = await vendorFor(actor);
  const order = await getOrder(id);
  if (!order || order.ownerId !== vendor.id)
    throw new HttpError(404, 'order_not_found', 'Order not found');
  return { order, vendor };
}

async function vendorOrderView(order: Order): Promise<VendorOrder> {
  const ev = await getEvent(order.eventId);
  const venue = ev ? await venueFor(ev.venueId) : undefined;
  if (!ev || !venue) throw new HttpError(500, 'event_missing', 'Event missing for order');
  return toVendorOrder(order, ev, venue);
}

const router = new Router()
  .add('GET', '/vendor/events/{id}/quote', async (req, { id }) => {
    const actor = claimsFrom(req);
    await vendorFor(actor);
    const ctx = await eventCtx(id!);
    const input = parseQuoteQuery(req.queryStringParameters ?? {});
    const quote = resolveQuote({ ...ctx, ...input });
    return json(req, quote, 200, { 'cache-control': 'no-store' });
  })
  .add('POST', '/vendor/events/{id}/holds', async (req, { id }) => {
    const actor = claimsFrom(req);
    const vendor = await vendorFor(actor);
    const ctx = await eventCtx(id!);
    const input = parseBody(req, QuoteInput);
    const quote = resolveQuote({ ...ctx, ...input });
    const items = await createHold({
      event: ctx.event,
      vendorId: vendor.id,
      heldBy: actor.sub,
      quote,
      holdMinutes: ctx.settings.holdMinutes,
    });
    return json(req, await holdResponse(items, ctx), 201, { 'cache-control': 'no-store' });
  })
  .add('GET', '/vendor/holds/{id}', async (req, { id }) => {
    const actor = claimsFrom(req);
    const vendor = await vendorFor(actor);
    const items = await loadHold(vendor.id, id!);
    const ctx = await eventCtx(items[0]!.eventId, false);
    return json(req, await holdResponse(items, ctx), 200, { 'cache-control': 'no-store' });
  })
  .add('PATCH', '/vendor/holds/{id}', async (req, { id }) => {
    const actor = claimsFrom(req);
    const vendor = await vendorFor(actor);
    const input = parseBody(req, UpdateHoldInput);
    const items = await updateHoldItems(await loadHold(vendor.id, id!), {
      vendorInfo: input.vendorInfo,
    });
    const ctx = await eventCtx(items[0]!.eventId, false);
    return json(req, await holdResponse(items, ctx), 200, { 'cache-control': 'no-store' });
  })
  .add('DELETE', '/vendor/holds/{id}', async (req, { id }) => {
    const actor = claimsFrom(req);
    const vendor = await vendorFor(actor);
    try {
      await releaseHold(await loadHold(vendor.id, id!));
    } catch (e) {
      if (!(e instanceof HttpError && (e.status === 404 || e.status === 410))) throw e;
    }
    return json(req, { ok: true });
  })
  .add('POST', '/vendor/holds/{id}/checkout', async (req, { id }) => {
    const actor = claimsFrom(req);
    const vendor = await vendorFor(actor);
    const items = await loadHold(vendor.id, id!);
    const h = items[0]!;
    const vendorInfo = h.vendorInfo as VendorInfo | undefined;
    if (!vendorInfo)
      throw new HttpError(400, 'vendor_info_required', 'Add your vendor info before checkout');
    const ctx = await eventCtx(h.eventId);
    const now = new Date();
    const extendedTo = new Date(
      now.getTime() + ctx.settings.checkoutHoldMinutes * 60_000,
    ).toISOString();
    await updateHoldItems(items, { expiresAt: extendedTo });

    // Idempotent: a draft order already created for this hold is reused.
    const existing = (await listOrdersForOwner(vendor.id)).find(
      (o) => o.holdId === h.holdId && o.status === 'pending_payment' && o.shopifyInvoiceUrl,
    );
    if (existing?.shopifyInvoiceUrl) {
      const body: CheckoutResponse = {
        orderId: existing.id,
        invoiceUrl: existing.shopifyInvoiceUrl,
        holdExpiresAt: extendedTo,
      };
      return json(req, body, 200, { 'cache-control': 'no-store' });
    }

    const createdAt = now.toISOString();
    const order: Order = {
      id: ulid(),
      eventId: ctx.event.id,
      kind: 'vendor_table',
      source: 'shopify',
      ownerId: vendor.id,
      placedBy: actor.sub,
      status: 'pending_payment',
      lines: [
        {
          type: 'table',
          tableId: h.tableId,
          dates: [...h.dates].sort(),
          rate: h.rate,
          unitCents: h.unitCents,
          lineCents: h.amountCents,
        },
      ],
      subtotalCents: h.amountCents,
      feeCents: h.feeCents,
      taxCents: h.taxCents,
      totalCents: h.totalCents,
      vendorInfo,
      holdId: h.holdId,
      createdAt,
      updatedAt: createdAt,
    };
    const dayLabel = [...h.dates].sort().map(shortDate).join(' + ');
    const draft = await shopify().createDraftOrder({
      title: `${ctx.event.name} · Table ${h.tableId} · ${dayLabel}`,
      totalCents: h.totalCents,
      email: vendorInfo.email,
      attributes: {
        orderId: order.id,
        holdId: h.holdId,
        eventId: ctx.event.id,
        tableId: h.tableId,
      },
      tags: ['fgg', 'vendor-table', STAGE],
      note: `${vendorInfo.tableName} · ${h.rate === 'poke_bucks' ? 'PokéBucks partner' : 'Standard'} rate`,
    });
    const withDraft: Order = {
      ...order,
      shopifyDraftOrderId: draft.id,
      shopifyInvoiceUrl: draft.invoiceUrl,
    };
    await writeOrder(withDraft, ctx.event.startsAt);
    await history(order.id, 'pending_payment', actor.sub, undefined, `draft ${draft.name}`);
    const body: CheckoutResponse = {
      orderId: order.id,
      invoiceUrl: draft.invoiceUrl,
      holdExpiresAt: extendedTo,
    };
    return json(req, body, 201, { 'cache-control': 'no-store' });
  })
  .add('GET', '/vendor/orders', async (req) => {
    const actor = claimsFrom(req);
    const vendor = await vendorFor(actor);
    const orders = await listOrdersForOwner(vendor.id);
    const body: VendorOrderList = { orders: await Promise.all(orders.map(vendorOrderView)) };
    return json(req, body, 200, { 'cache-control': 'no-store' });
  })
  .add('GET', '/vendor/orders/{id}', async (req, { id }) => {
    const actor = claimsFrom(req);
    const { order } = await ownedOrder(actor, id!);
    return json(req, await vendorOrderView(order), 200, { 'cache-control': 'no-store' });
  })
  .add('GET', '/vendor/orders/{id}/pass.ics', async (req, { id }) => {
    const actor = claimsFrom(req);
    const { order } = await ownedOrder(actor, id!);
    if (order.status !== 'paid')
      throw new HttpError(409, 'not_paid', 'Pass is available once the order is paid');
    const ev = await getEvent(order.eventId);
    const venue = ev ? await venueFor(ev.venueId) : undefined;
    if (!ev || !venue) throw new HttpError(500, 'event_missing', 'Event missing');
    const res: Res = {
      statusCode: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': `attachment; filename="fgg-${order.passNumber ?? order.id}.ics"`,
        'cache-control': 'no-store',
      },
      body: vendorPassIcs(order, ev, venue),
    };
    return res;
  })
  .add('GET', '/vendor/orders/{id}/receipt.pdf', async (req, { id }) => {
    const actor = claimsFrom(req);
    const { order } = await ownedOrder(actor, id!);
    if (order.status !== 'paid' && order.status !== 'refunded') {
      throw new HttpError(409, 'not_paid', 'Receipt is available once the order is paid');
    }
    const ev = await getEvent(order.eventId);
    const venue = ev ? await venueFor(ev.venueId) : undefined;
    if (!ev || !venue) throw new HttpError(500, 'event_missing', 'Event missing');
    const bytes = await receiptPdf(order, ev, venue);
    const res: Res = {
      statusCode: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="fgg-receipt-${order.passNumber ?? order.id}.pdf"`,
        'cache-control': 'no-store',
      },
      body: Buffer.from(bytes).toString('base64'),
      isBase64Encoded: true,
    };
    return res;
  })
  .add('POST', '/vendor/orders/{id}/cancel-request', async (req, { id }) => {
    const actor = claimsFrom(req);
    const { order } = await ownedOrder(actor, id!);
    const input = parseBody(req, CancelRequestInput);
    if (order.status !== 'paid')
      throw new HttpError(409, 'not_paid', 'Only paid orders can be cancelled');
    const ev = await getEvent(order.eventId);
    const at = new Date().toISOString();
    const next = { ...order, cancelRequestedAt: at, updatedAt: at } as Order & {
      cancelRequestedAt: string;
    };
    await writeOrder(next, ev?.startsAt ?? order.createdAt);
    await history(
      order.id,
      order.status,
      actor.sub,
      order.status,
      `cancel requested: ${input.reason ?? ''}`,
    );
    return json(req, await vendorOrderView(next), 200, { 'cache-control': 'no-store' });
  })
  .add('GET', '/vendor/dashboard', async (req) => {
    const actor = claimsFrom(req);
    const vendor = await vendorFor(actor);
    const [orders, settings, published] = await Promise.all([
      listOrdersForOwner(vendor.id),
      getSettings(),
      listPublishedEvents(),
    ]);
    const views = await Promise.all(orders.map(vendorOrderView));
    const today = todayIso();
    const year = today.slice(0, 4);
    const upcoming = views
      .filter((o) => o.status === 'paid' && o.event.endDate >= today)
      .sort((a, b) => a.event.startDate.localeCompare(b.event.startDate));
    const bookedEventIds = new Set(upcoming.map((o) => o.eventId));
    const others = published.filter(
      (ev) =>
        !bookedEventIds.has(ev.id) &&
        [...ev.days]
          .map((d) => d.date)
          .sort()
          .at(-1)! >= today,
    );
    const body: VendorDashboard = {
      vendor,
      upcoming,
      history: views,
      paidThisYearCents: views
        .filter((o) => o.status === 'paid' && (o.paidAt ?? '').startsWith(year))
        .reduce((n, o) => n + o.totalCents, 0),
      balanceDueCents: views
        .filter((o) => o.status === 'pending_payment')
        .reduce((n, o) => n + o.totalCents, 0),
      events: await toPublicEvents(others),
      refundCutoffDays: settings.refundCutoffDays,
    };
    return json(req, body, 200, { 'cache-control': 'no-store' });
  });

export const handler = (req: Req) => router.handle(req);
