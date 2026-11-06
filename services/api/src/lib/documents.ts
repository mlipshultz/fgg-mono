import { PDFDocument, type PDFFont, type RGB, StandardFonts, rgb } from 'pdf-lib';
import type { Event, Order, Venue } from '@fgg/types';
import { orderDates, shortDate, tableCountLabel, tableLines, unassignedLines } from './booking.js';
import { FGG_LOGO_PNG_BASE64 } from './brand-logo.js';
import { fmtTime } from './events.js';

/** Naive local → floating time: the venue's own zone is implied by the location. */
function icsDateTime(date: string, hhmm: string): string {
  return `${date.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** One VEVENT per booked day, starting at load-in (or doors) and ending at close. */
export function vendorPassIcs(order: Order, ev: Event, venue: Venue, now = new Date()): string {
  const lines = tableLines(order);
  const tablesOn = (date: string) =>
    lines.filter((l) => l.dates.includes(date)).map((l) => l.tableId);
  /** Tables with no spot yet (`quantity` events) on a day. */
  const unassignedOn = (date: string) =>
    unassignedLines(order)
      .filter((l) => l.dates.includes(date))
      .reduce((n, l) => n + l.quantity, 0);
  const summary = (date: string) =>
    unassignedOn(date)
      ? `${ev.name} · Vendor · ${tableCountLabel(unassignedOn(date))}`
      : `${ev.name} · Vendor ${tablesOn(date).length > 1 ? 'tables' : 'table'} ${tablesOn(date).join(', ')}`;
  const dates = orderDates(order);
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const events = dates.map((date) => {
    const day = ev.days.find((d) => d.date === date);
    const start = day?.vendorLoadIn ?? day?.opens ?? '09:00';
    const end = day?.closes ?? '17:00';
    return [
      'BEGIN:VEVENT',
      `UID:${order.id}-${date}@feelgoodgaming.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${ev.timeZone}:${icsDateTime(date, start)}`,
      `DTEND;TZID=${ev.timeZone}:${icsDateTime(date, end)}`,
      `SUMMARY:${icsEscape(summary(date))}`,
      `LOCATION:${icsEscape(`${venue.name}, ${venue.address}, ${venue.city}, ${venue.state}`)}`,
      `DESCRIPTION:${icsEscape(`Vendor pass ${order.passNumber ?? ''}. Load-in ${start}. Doors ${day?.opens ?? ''}.`)}`,
      'END:VEVENT',
    ].join('\r\n');
  });
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Feel Good Gaming//Vendor Pass//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

// ---------------------------------------------------------------------------
// Receipt PDF
// ---------------------------------------------------------------------------

/** Design tokens (packages/tokens) as PDF colours. */
function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const C = {
  ink: hex('#141414'),
  paper: hex('#FFFDF7'),
  white: hex('#FFFFFF'),
  yellow: hex('#FFE15A'),
  aqua: hex('#33EEDC'),
  pink: hex('#FF7EB9'),
  pinkText: hex('#D6478A'),
  muted: hex('#5C5A55'),
  mutedDark: hex('#3A3830'),
  line: hex('#EEEAE0'),
  dash: hex('#E8E4DA'),
  closed: hex('#E8E4DA'),
};

/** Rounded rectangle as an SVG path, origin top-left, y down (pdf-lib's drawSvgPath). */
function roundedRect(w: number, h: number, r: number): string {
  return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<Order['status'], { label: string; fill: RGB }> = {
  paid: { label: 'PAID', fill: C.aqua },
  refunded: { label: 'REFUNDED', fill: C.pink },
  conflict: { label: 'REFUNDED', fill: C.pink },
  cancelled: { label: 'CANCELLED', fill: C.closed },
  pending_payment: { label: 'AWAITING PAYMENT', fill: C.yellow },
};

/** "(410) 555-0100" for ten US digits, else as typed. */
function phone(p: string): string {
  const d = p.replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : p;
}

/** "Sat Oct 24 – Sun Oct 25, 2026" */
function dateRange(dates: string[]): string {
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return '';
  const year = first.slice(0, 4);
  return first === last
    ? `${shortDate(first)}, ${year}`
    : `${shortDate(first)} – ${shortDate(last)}, ${year}`;
}

/** The date `days` before an event day: the last day for a full refund. */
function minusDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * The vendor's receipt: a sticker-style card (ink border, aqua offset shadow) with the logo,
 * pass number and status, the event and who was billed, one line per table (or per day's
 * number of tables), totals, and the refund terms. US Letter, built-in Helvetica (the brand
 * fonts are variable web fonts, which pdf-lib can't set at a weight).
 */
export async function receiptPdf(
  order: Order,
  ev: Event,
  venue: Venue,
  refundCutoffDays = 14,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Feel Good Gaming receipt ${order.passNumber ?? order.id}`);
  doc.setAuthor('Feel Good Gaming');
  const page = doc.addPage([612, 792]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const logo = await doc.embedPng(Buffer.from(FGG_LOGO_PNG_BASE64, 'base64'));

  // Helvetica speaks WinAnsi: keep what it can draw (é, ·, –, ’ are fine), drop the rest.
  const drawable = new Set(reg.getCharacterSet());
  const clean = (t: string) =>
    [...t.replace(/[\r\n\t]+/g, ' ')].filter((ch) => drawable.has(ch.codePointAt(0)!)).join('');
  const fit = (t: string, font: PDFFont, size: number, max: number) => {
    let out = clean(t);
    if (font.widthOfTextAtSize(out, size) <= max) return out;
    while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > max) out = out.slice(0, -1);
    return `${out.trimEnd()}…`;
  };
  const text = (
    t: string,
    x: number,
    y: number,
    o: { size?: number; font?: PDFFont; color?: RGB; max?: number; align?: 'left' | 'right' } = {},
  ) => {
    const size = o.size ?? 11;
    const font = o.font ?? reg;
    const s = o.max ? fit(t, font, size, o.max) : clean(t);
    const w = font.widthOfTextAtSize(s, size);
    page.drawText(s, {
      x: o.align === 'right' ? x - w : x,
      y,
      size,
      font,
      color: o.color ?? C.ink,
    });
  };
  /** Small capitals tracked out, like the site's eyebrows (pdf-lib has no letter spacing). */
  const eyebrow = (t: string, x: number, y: number, align: 'left' | 'right' = 'left') => {
    const chars = [...clean(t.toUpperCase())];
    const size = 8;
    const track = 1;
    const width =
      chars.reduce((n, ch) => n + bold.widthOfTextAtSize(ch, size), 0) +
      track * Math.max(0, chars.length - 1);
    let cx = align === 'right' ? x - width : x;
    for (const ch of chars) {
      page.drawText(ch, { x: cx, y, size, font: bold, color: C.muted });
      cx += bold.widthOfTextAtSize(ch, size) + track;
    }
  };
  const rule = (x1: number, x2: number, y: number, color = C.line, dashed = false) =>
    page.drawLine({
      start: { x: x1, y },
      end: { x: x2, y },
      thickness: dashed ? 1.5 : 1,
      color,
      ...(dashed ? { dashArray: [4, 3] } : {}),
    });

  // Page and card.
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: C.paper });
  const card = { x: 40, top: 756, w: 526, h: 712 };
  page.drawSvgPath(roundedRect(card.w, card.h, 22), {
    x: card.x + 6,
    y: card.top - 6,
    color: C.aqua,
  });
  page.drawSvgPath(roundedRect(card.w, card.h, 22), {
    x: card.x,
    y: card.top,
    color: C.white,
    borderColor: C.ink,
    borderWidth: 2,
  });
  const L = card.x + 32;
  const R = card.x + card.w - 32;
  let y = card.top - 32;

  // Header: logo and name, then receipt number, date and status on the right.
  page.drawImage(logo, { x: L, y: y - 52, width: 52, height: 52 });
  text('Feel Good Gaming', L + 64, y - 22, { size: 18, font: bold });
  text('feelgoodgaming.com', L + 64, y - 38, { size: 10, color: C.muted });
  eyebrow('Receipt', R, y - 8, 'right');
  text(order.passNumber ? `Pass ${order.passNumber}` : `Order ${order.id.slice(-8)}`, R, y - 28, {
    size: 16,
    font: bold,
    align: 'right',
  });
  if (order.paidAt) {
    const paid = new Intl.DateTimeFormat('en-US', {
      timeZone: ev.timeZone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(order.paidAt));
    text(`Paid ${paid}`, R, y - 44, { size: 9.5, color: C.muted, align: 'right' });
  }
  const status = STATUS[order.status];
  const pillW = bold.widthOfTextAtSize(status.label, 8.5) + 20;
  page.drawSvgPath(roundedRect(pillW, 18, 9), {
    x: R - pillW,
    y: y - 52,
    color: status.fill,
    borderColor: C.ink,
    borderWidth: 1.5,
  });
  text(status.label, R - pillW / 2 + bold.widthOfTextAtSize(status.label, 8.5) / 2, y - 64, {
    size: 8.5,
    font: bold,
    align: 'right',
  });
  y -= 76;
  rule(L, R, y, C.dash, true);

  // Event and who was billed, side by side.
  y -= 26;
  const mid = L + (R - L) / 2 + 12;
  eyebrow('Event', L, y);
  eyebrow('Billed to', mid, y);
  const colW = mid - L - 24;
  const evLines: [string, PDFFont, number, RGB][] = [
    [ev.name, bold, 14, C.ink],
    [dateRange(ev.days.map((d) => d.date)), reg, 10.5, C.ink],
    [venue.name, reg, 10.5, C.ink],
    [`${venue.address}, ${venue.city}, ${venue.state}`, reg, 9.5, C.muted],
  ];
  const vi = order.vendorInfo;
  const billLines: [string, PDFFont, number, RGB][] = vi
    ? [
        [vi.tableName, bold, 14, C.ink],
        ...(vi.contactName
          ? [[vi.contactName, reg, 10.5, C.ink] as [string, PDFFont, number, RGB]]
          : []),
        ...(vi.email ? [[vi.email, reg, 10.5, C.ink] as [string, PDFFont, number, RGB]] : []),
        ...(vi.phone
          ? [[phone(vi.phone), reg, 9.5, C.muted] as [string, PDFFont, number, RGB]]
          : []),
      ]
    : [];
  const blockTop = y - 20;
  evLines.forEach(([t, f, sz, col], i) =>
    text(t, L, blockTop - i * 16, { size: sz, font: f, color: col, max: colW }),
  );
  billLines.forEach(([t, f, sz, col], i) =>
    text(t, mid, blockTop - i * 16, { size: sz, font: f, color: col, max: R - mid }),
  );
  y = blockTop - Math.max(evLines.length, billLines.length) * 16 - 18;

  // Line items.
  const cols = { item: L + 12, days: L + 150, rate: R - 110, amount: R - 12 };
  page.drawSvgPath(roundedRect(R - L, 24, 8), { x: L, y, color: C.yellow });
  y -= 16;
  eyebrow('Item', cols.item, y);
  eyebrow('Days', cols.days, y);
  eyebrow('Per day', cols.rate, y, 'right');
  eyebrow('Amount', cols.amount, y, 'right');
  y -= 12;
  const items = order.lines.flatMap((l) => {
    if (l.type === 'ticket') return [];
    const days = [...l.dates].sort();
    const what = l.type === 'table' ? `Table ${l.tableId}` : tableCountLabel(l.quantity);
    const perDay =
      l.type === 'table' ? money(l.unitCents) : `${money(l.unitCents)} × ${l.quantity}`;
    return [{ what, days: days.map(shortDate).join(', '), perDay, amount: money(l.lineCents) }];
  });
  // Long orders (up to 10 tables) get tighter rows so everything stays on one page.
  const rowGap = items.length > 6 ? 14 : 22;
  for (const it of items) {
    y -= rowGap;
    text(it.what, cols.item, y, { size: 11, font: bold, max: cols.days - cols.item - 10 });
    text(it.days, cols.days, y, { size: 10.5, max: cols.rate - cols.days - 70 });
    text(it.perDay, cols.rate, y, { size: 10.5, align: 'right' });
    text(it.amount, cols.amount, y, { size: 11, font: bold, align: 'right' });
    y -= 10;
    rule(L, R, y);
  }
  const rate = order.lines.find((l) => l.type !== 'ticket');
  y -= 16;
  if (rate)
    text(rate.rate === 'poke_bucks' ? 'PokéBucks partner rate' : 'Standard rate', cols.item, y, {
      size: 9.5,
      color: C.muted,
    });
  if (unassignedLines(order).length)
    text('Table spots are assigned by FGG before the show.', cols.item, y - 14, {
      size: 9.5,
      color: C.muted,
    });

  // Totals.
  type Row = [label: string, value: string, kind: 'normal' | 'total' | 'refund'];
  const totals: Row[] = [['Subtotal', money(order.subtotalCents), 'normal']];
  if (order.feeCents) totals.push(['Processing fee', money(order.feeCents), 'normal']);
  if (order.taxCents) totals.push(['Sales tax', money(order.taxCents), 'normal']);
  totals.push(['Total paid', money(order.totalCents), 'total']);
  const refunded =
    order.status === 'refunded' || order.status === 'conflict'
      ? (order.refundedCents ?? order.totalCents)
      : (order.refundedCents ?? 0);
  if (refunded > 0) {
    totals.push(['Refunded', `-${money(refunded)}`, 'refund']);
    totals.push(['Net paid', money(order.totalCents - refunded), 'total']);
  }
  const tl = R - 200;
  for (const [label, value, kind] of totals) {
    y -= kind === 'total' ? 24 : 18;
    if (kind === 'total') rule(tl, R, y + 16, C.ink);
    const size = kind === 'total' ? 13 : 10.5;
    const font = kind === 'total' ? bold : reg;
    const color = kind === 'refund' ? C.pinkText : kind === 'total' ? C.ink : C.mutedDark;
    text(label, tl, y, { size, font, color });
    text(value, R, y, { size, font, color, align: 'right' });
  }

  // Pass box: what to do with the pass number on show day. Follows the totals; left out on the
  // rare order too long to leave room for it above the footer.
  const firstDay = orderDates(order)[0];
  const dayInfo = ev.days.find((d) => d.date === firstDay);
  const fy = card.top - card.h + 44;
  const boxH = 64;
  const boxTop = y - 32;
  if (boxTop - boxH > fy + 40) {
    page.drawSvgPath(roundedRect(R - L, boxH, 14), {
      x: L,
      y: boxTop,
      color: C.paper,
      borderColor: C.dash,
      borderWidth: 1.5,
    });
    eyebrow('Vendor pass', L + 16, boxTop - 20);
    text(
      order.passNumber
        ? `Show pass ${order.passNumber} at vendor check-in.`
        : 'Your pass number appears once payment is confirmed.',
      L + 16,
      boxTop - 38,
      { size: 11, font: bold, max: R - L - 32 },
    );
    if (dayInfo)
      text(
        `Load-in ${shortDate(dayInfo.date)} at ${fmtTime(dayInfo.vendorLoadIn ?? dayInfo.opens)} · doors ${fmtTime(dayInfo.opens)}.`,
        L + 16,
        boxTop - 54,
        { size: 9.5, color: C.muted, max: R - L - 32 },
      );
  }

  // Footer: refund terms and contact.
  rule(L, R, fy + 22, C.dash, true);
  const cutoff = firstDay ? ` (until ${shortDate(minusDays(firstDay, refundCutoffDays))})` : '';
  text(`Full refund up to ${refundCutoffDays} days before the show${cutoff}.`, L, fy, {
    size: 9,
    color: C.muted,
  });
  text('Questions? hello@feelgoodgaming.com', R, fy, { size: 9, color: C.muted, align: 'right' });
  text(
    `Order ${order.id}${order.shopifyOrderId ? ` · Payment ref ${order.shopifyOrderId}` : ''}`,
    L,
    fy - 14,
    { size: 8, color: C.muted },
  );
  return doc.save();
}
