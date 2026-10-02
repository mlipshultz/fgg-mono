import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Event, Order, Venue } from '@fgg/types';
import { orderDates, shortDate, tablesLabel } from './booking.js';

/** Naive local → floating time: the venue's own zone is implied by the location. */
function icsDateTime(date: string, hhmm: string): string {
  return `${date.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** One VEVENT per booked day, starting at load-in (or doors) and ending at close. */
export function vendorPassIcs(order: Order, ev: Event, venue: Venue, now = new Date()): string {
  const tables = tablesLabel(order);
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
      `SUMMARY:${icsEscape(`${ev.name} · Vendor ${order.lines.length > 1 ? 'tables' : 'table'} ${tables}`)}`,
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

const INK = rgb(0.078, 0.078, 0.078);
const MUTED = rgb(0.36, 0.353, 0.333);
const AQUA = rgb(0.2, 0.933, 0.863);

/** Simple sticker-style receipt. Returns the PDF bytes. */
export async function receiptPdf(order: Order, ev: Event, venue: Venue): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const line = order.lines.find((l) => l.type === 'table');
  const dates = orderDates(order);
  const tables = tablesLabel(order);

  page.drawRectangle({ x: 36, y: 36, width: 540, height: 720, borderColor: INK, borderWidth: 2 });
  page.drawRectangle({
    x: 42,
    y: 30,
    width: 540,
    height: 720,
    borderColor: AQUA,
    borderWidth: 4,
    opacity: 0,
  });
  page.drawText('Feel Good Gaming', { x: 60, y: 710, size: 22, font: bold, color: INK });
  page.drawText('RECEIPT', { x: 60, y: 684, size: 12, font: bold, color: MUTED });
  page.drawText(order.passNumber ? `Vendor pass ${order.passNumber}` : `Order ${order.id}`, {
    x: 60,
    y: 660,
    size: 14,
    font: bold,
    color: INK,
  });

  const rows: [string, string][] = [
    ['Event', ev.name],
    ['Venue', `${venue.name} · ${venue.city}, ${venue.state}`],
    [order.lines.length > 1 ? 'Tables' : 'Table', tables ? `${tables} · Main Hall` : '—'],
    ['Days', dates.map(shortDate).join(', ')],
    [
      'Rate',
      line && line.type === 'table'
        ? line.rate === 'poke_bucks'
          ? 'PokéBucks partner'
          : 'Standard'
        : '—',
    ],
    ['Subtotal', `$${(order.subtotalCents / 100).toFixed(2)}`],
    ['Fee', `$${(order.feeCents / 100).toFixed(2)}`],
    ['Tax', `$${(order.taxCents / 100).toFixed(2)}`],
    ['Total paid', `$${(order.totalCents / 100).toFixed(2)}`],
    ['Status', order.status],
    ['Paid at', order.paidAt ?? '—'],
    ['Shopify order', order.shopifyOrderId ?? '—'],
    ['Vendor', order.vendorInfo?.tableName ?? ''],
  ];
  let y = 620;
  for (const [k, v] of rows) {
    page.drawText(k.toUpperCase(), { x: 60, y, size: 9, font: bold, color: MUTED });
    page.drawText(v.replace(/[^\x20-\x7E]/g, ''), { x: 200, y, size: 12, font: reg, color: INK });
    y -= 26;
  }
  page.drawText('Full refund up to 14 days before the show. hello@feelgoodgaming.com', {
    x: 60,
    y: 70,
    size: 9,
    font: reg,
    color: MUTED,
  });
  return doc.save();
}
