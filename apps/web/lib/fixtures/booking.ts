import {
  AdminEventList,
  CancelRequestList,
  AdminOrderList,
  EventFloorPlan,
  EventVendorList,
  HoldResponse,
  Quote,
  VendorApplication,
  VendorDashboard,
  VendorOrder,
  VendorProfile,
  VendorStanding,
  type FloorPlan,
  type FloorTable,
  type QuoteInput,
  type Vendor,
} from '@fgg/types';
import { tableById, tableUnitCents } from '../booking';
import { fixtureEvents } from './home';
import { fid } from './ids';

const halloween = fixtureEvents[0]!;
const venue = {
  id: halloween.venue.id,
  name: halloween.venue.name,
  address: '2200 York Rd',
  city: halloween.venue.city,
  state: halloween.venue.state,
  timeZone: 'America/New_York',
};

const TAKEN = new Set([
  'A1',
  'A2',
  'A5',
  'A6',
  'A9',
  'B3',
  'B4',
  'B7',
  'B8',
  'B10',
  'C1',
  'C2',
  'C8',
  'D5',
  'D6',
  'D9',
  'D10',
  'E1',
  'E3',
  'E4',
  'E7',
  'F2',
  'F5',
  'F6',
  'F8',
  'F9',
]);

const tables: FloorTable[] = [];
for (const [ri, row] of ['A', 'B', 'C', 'D', 'E', 'F'].entries()) {
  for (let n = 1; n <= 10; n++) {
    tables.push({
      id: `${row}${n}`,
      row,
      position: n,
      x: n <= 5 ? n : n + 1,
      y: ri + 1,
      nearby: n <= 5 ? ['art-station'] : ['kids-trading', 'find-em-all'],
      // F10 is the corner by the entrance: a premium table at $50 more a day.
      ...(row === 'F' && n === 10 ? { premiumDeltaCents: 5000 } : {}),
    });
  }
}

export const floorPlanFixture: FloorPlan = {
  venueId: venue.id,
  version: 1,
  width: 13,
  height: 8,
  zones: [
    { id: 'stage', label: 'Stage · Tournaments & Costume Contest', x: 0, y: 0, w: 13, h: 1 },
    { id: 'art-station', label: 'the Art Station', x: 0, y: 1, w: 1, h: 3 },
    { id: 'pokepets', label: 'PokéPets', x: 0, y: 4, w: 1, h: 3 },
    { id: 'kids-trading', label: 'Kids Trading', x: 12, y: 1, w: 1, h: 4 },
    { id: 'find-em-all', label: "Find 'Em All", x: 12, y: 5, w: 1, h: 2 },
    { id: 'entrance', label: 'Entrance · Check-in · Vendor load-in', x: 4, y: 7, w: 5, h: 1 },
  ],
  tables,
};

export const floorPlanResponseFixture = EventFloorPlan.parse({
  event: halloween,
  venue,
  floorPlan: floorPlanFixture,
  pricing: { tableRateCents: 20000, pokeBucksRateCents: 10000 },
  availability: {
    eventId: halloween.id,
    vendorStatus: 'open',
    tablesLeft: 60 - TAKEN.size - 1,
    // A few tables differ by day so the picker's per-day stripes show up in fixture mode.
    // B2 (Sat) and C4 (both days) belong to this vendor's paid order, so they're unavailable
    // exactly as the API would report them; the map shows them as "yours".
    days: halloween.days.map((d, i) => ({
      date: d.date,
      unavailable: [...TAKEN, 'C4', ...(i === 0 ? ['B2', 'D4', 'E5'] : ['A3', 'C5', 'F1'])].sort(),
    })),
  },
});

/** Winter Fest books by number of tables: 12 left on Saturday, 3 on Sunday. */
export const countEventFixture = fixtureEvents.find((e) => e.tableBooking === 'quantity')!;
export const countResponseFixture = EventFloorPlan.parse({
  event: countEventFixture,
  venue: { ...venue, ...countEventFixture.venue, address: '797 E Patrick St' },
  // Winter Fest is in its early-bird window in the fixtures.
  pricing: {
    tableRateCents: 15000,
    pokeBucksRateCents: 7500,
    windowKind: 'early_bird',
    windowEndsAt: '2026-12-01T05:00:00.000Z',
  },
  availability: {
    eventId: countEventFixture.id,
    vendorStatus: 'open',
    tablesLeft: 12,
    days: countEventFixture.days.map((d, i) => ({
      date: d.date,
      unavailable: [],
      left: i === 0 ? 12 : 3,
    })),
  },
});

export type CartLineFixture = QuoteInput['lines'][number];

export function quoteFixture(lines: CartLineFixture[], rate: 'standard' | 'poke_bucks'): Quote {
  const byCount = lines.some((l) => 'quantity' in l);
  const pricing = (byCount ? countResponseFixture : floorPlanResponseFixture).pricing!;
  const base = rate === 'poke_bucks' ? pricing.pokeBucksRateCents : pricing.tableRateCents;
  const priced = lines.map((l) => {
    if ('quantity' in l) {
      return {
        quantity: l.quantity,
        dates: [...l.dates].sort(),
        unitCents: base,
        lineCents: base * l.quantity * l.dates.length,
        pricingInputs: {},
      };
    }
    const { tableId, dates } = l;
    const row = tableId[0]!;
    const n = Number(tableId.slice(1));
    const unit = tableUnitCents(tableById(floorPlanFixture, tableId), base);
    return {
      tableId,
      dates: [...dates].sort(),
      unitCents: unit,
      lineCents: unit * dates.length,
      pricingInputs: {},
      rowLabel: `Row ${row} · Main Hall`,
      nearby: `${['A', 'B'].includes(row) ? 'Right by the stage and tournaments' : ['C', 'D'].includes(row) ? 'Center of the hall' : 'First row past the entrance (busiest spot)'}, ${n <= 5 ? 'next to the Art Station' : "next to Kids Trading and Find 'Em All"}.`,
    };
  });
  const subtotal = priced.reduce((n, l) => n + l.lineCents, 0);
  return Quote.parse({
    rate,
    lines: priced,
    subtotalCents: subtotal,
    feeCents: 0,
    taxCents: 0,
    totalCents: subtotal,
  });
}

export function holdFixture(
  lines: CartLineFixture[],
  rate: 'standard' | 'poke_bucks',
): HoldResponse {
  const quote = quoteFixture(lines, rate);
  const event = lines.some((l) => 'quantity' in l) ? countEventFixture : halloween;
  const now = Date.now();
  return HoldResponse.parse({
    hold: {
      id: fid('01JHLD', 1),
      eventId: event.id,
      vendorId: fid('01JVND', 1),
      heldBy: '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d',
      rate,
      tables: quote.lines.map((l) => ({
        ...('quantity' in l ? { quantity: l.quantity } : { tableId: l.tableId }),
        dates: l.dates,
        unitCents: l.unitCents,
        amountCents: l.lineCents,
        pricingInputs: {},
      })),
      subtotalCents: quote.subtotalCents,
      expiresAt: new Date(now + 10 * 60_000).toISOString(),
      createdAt: new Date(now).toISOString(),
    },
    quote,
    event,
    prefill: {
      tableName: vendorFixture.businessName,
      phone: vendorFixture.phone,
      sellsDescription: vendorFixture.sellsDescription,
    },
  });
}

export const vendorFixture: Vendor = {
  id: fid('01JVND', 1),
  businessName: "Maya's Card Corner",
  contactName: 'Maya Johnson',
  email: 'maya@cardcorner.com',
  phone: '4105550100',
  sells: ['pokemon_cards', 'collectibles'],
  sellsDescription: 'Vintage and modern singles, graded slabs, a $1 bulk bin.',
  socials: { instagram: 'mayascardcorner' },
  pokeBucksPartner: false,
  status: 'active',
  createdAt: '2026-04-12T15:00:00Z',
  updatedAt: '2026-04-12T15:00:00Z',
};

const eventPick = (ev: typeof halloween) => ({
  id: ev.id,
  slug: ev.slug,
  name: ev.name,
  startDate: ev.startDate,
  endDate: ev.endDate,
  days: ev.days,
  timeZone: ev.timeZone,
  venue: ev.venue,
  ...(ev.posterUrl ? { posterUrl: ev.posterUrl } : {}),
});

export const paidOrderFixture: VendorOrder = VendorOrder.parse({
  id: fid('01JORD', 1),
  eventId: halloween.id,
  kind: 'vendor_table',
  source: 'shopify',
  ownerId: vendorFixture.id,
  placedBy: '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d',
  status: 'paid',
  lines: [
    {
      type: 'table',
      tableId: 'B2',
      dates: ['2026-10-24'],
      rate: 'standard',
      unitCents: 20000,
      lineCents: 20000,
    },
    {
      type: 'table',
      tableId: 'C4',
      dates: ['2026-10-24', '2026-10-25'],
      rate: 'standard',
      unitCents: 20000,
      lineCents: 40000,
    },
  ],
  subtotalCents: 60000,
  feeCents: 0,
  taxCents: 0,
  totalCents: 60000,
  vendorInfo: {
    tableName: "Maya's Card Corner",
    contactName: 'Maya Johnson',
    phone: '4105550100',
    email: 'maya@cardcorner.com',
    sellsDescription: 'Vintage and modern singles, graded slabs, a $1 bulk bin.',
    codeOfConductAccepted: true,
  },
  shopifyOrderId: 'gid://shopify/Order/1001',
  passNumber: 'HF26-014',
  paidAt: '2026-09-30T14:12:00Z',
  createdAt: '2026-09-30T14:00:00Z',
  updatedAt: '2026-09-30T14:12:00Z',
  event: eventPick(halloween),
  loadInLabel: 'Sat Oct 24 · 8:30am',
});

const past = fixtureEvents.find((e) => e.slug === 'summer-fest-2026') ?? fixtureEvents[1]!;
const refundedOrderFixture: VendorOrder = VendorOrder.parse({
  ...paidOrderFixture,
  id: fid('01JORD', 2),
  eventId: past.id,
  status: 'refunded',
  lines: [
    {
      type: 'table',
      tableId: 'B2',
      dates: [past.startDate],
      rate: 'poke_bucks',
      unitCents: 10000,
      lineCents: 10000,
    },
  ],
  subtotalCents: 10000,
  totalCents: 10000,
  passNumber: 'SF26-022',
  paidAt: '2026-05-01T14:12:00Z',
  refundedAt: '2026-06-01T14:12:00Z',
  createdAt: '2026-05-01T14:00:00Z',
  event: eventPick(past),
  loadInLabel: undefined,
});

export const vendorProfileFixture: VendorProfile = VendorProfile.parse({
  ...vendorFixture,
  logoKey: 'vendors/fixture/logo.png',
  logoUrl: 'https://fixture.local/fixtures/vendor-logo.svg',
});

/** Who's vending at Halloween Fest (public). */
export const eventVendorsFixture: EventVendorList = EventVendorList.parse({
  event: halloween,
  vendors: [
    {
      vendorId: vendorFixture.id,
      name: "Maya's Card Corner",
      sellsDescription: 'Vintage and modern singles, graded slabs, a $1 bulk bin.',
      tags: ['pokemon_cards', 'singles', 'graded', 'vintage'],
      logoUrl: 'https://fixture.local/fixtures/vendor-logo.svg',
      socials: { instagram: 'mayascardcorner' },
      tables: [
        { tableId: 'B7', dates: ['2026-10-24', '2026-10-25'] },
        { tableId: 'B8', dates: ['2026-10-24'] },
      ],
    },
    {
      vendorId: fid('01JVND', 2),
      name: 'Pocket Monsters MD',
      sellsDescription: 'Modern singles, a $1 bulk bin and a few sealed ETBs.',
      tags: ['pokemon_cards', 'singles', 'sealed'],
      socials: { instagram: 'pocketmonstersmd', tiktok: 'pmmd' },
      tables: [{ tableId: 'C2', dates: ['2026-10-24'] }],
    },
    {
      vendorId: fid('01JVND', 3),
      name: 'Plush Pals',
      sellsDescription: 'Handmade plush and embroidered hats.',
      tags: ['plush', 'apparel'],
      socials: { website: 'https://plushpals.example' },
      tables: [{ tableId: 'E4', dates: ['2026-10-24', '2026-10-25'] }],
    },
  ],
});

export const vendorDashboardFixture: VendorDashboard = VendorDashboard.parse({
  vendor: vendorProfileFixture,
  upcoming: [paidOrderFixture],
  history: [paidOrderFixture, refundedOrderFixture],
  paidThisYearCents: 70000,
  balanceDueCents: 0,
  refundCutoffDays: 14,
});

export const applicationsFixture: VendorApplication[] = [
  VendorApplication.parse({
    id: fid('01JAPP', 1),
    userId: '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d',
    status: 'submitted',
    businessName: 'Pocket Monsters MD',
    contactName: 'Sam Rivera',
    email: 'sam@pocketmonsters.example',
    phone: '4435550123',
    sellsDescription: 'Modern singles, a $1 bulk bin and a few sealed ETBs.',
    socials: { instagram: 'pocketmonstersmd', tiktok: 'pmmd' },
    pokeBucksInterest: true,
    codeOfConductAccepted: true,
    sealedPolicyAccepted: true,
    attribution: { utmSource: 'facebook', adName: 'halloween-vendors' },
    createdAt: '2026-09-28T16:00:00Z',
    updatedAt: '2026-09-28T16:00:00Z',
  }),
  VendorApplication.parse({
    id: fid('01JAPP', 2),
    userId: '3f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8e',
    status: 'call_scheduled',
    businessName: 'Plush Pals',
    contactName: 'Dana Lee',
    email: 'dana@plushpals.example',
    phone: '4105550177',
    sellsDescription: 'Handmade plush and embroidered hats.',
    socials: {},
    pokeBucksInterest: false,
    codeOfConductAccepted: true,
    sealedPolicyAccepted: true,
    attribution: {},
    callScheduledAt: '2026-09-29T15:00:00Z',
    callScheduledVia: 'staff',
    createdAt: '2026-09-27T12:00:00Z',
    updatedAt: '2026-09-29T15:00:00Z',
  }),
];

export const standingFixture: VendorStanding = VendorStanding.parse({
  application: applicationsFixture[0],
  vendor: null,
  calendlyUrl: 'https://calendly.com/feelgoodgaming/vendor-call',
  approvalMode: 'manual_call',
});

export const adminOrdersFixture: AdminOrderList = AdminOrderList.parse({
  items: [
    paidOrderFixture,
    VendorOrder.parse({
      ...paidOrderFixture,
      id: fid('01JORD', 3),
      status: 'pending_payment',
      lines: [
        {
          type: 'table',
          tableId: 'E2',
          dates: ['2026-10-24'],
          rate: 'standard',
          unitCents: 20000,
          lineCents: 20000,
        },
      ],
      subtotalCents: 20000,
      totalCents: 20000,
      passNumber: undefined,
      shopifyOrderId: undefined,
      paidAt: undefined,
      vendorInfo: { ...paidOrderFixture.vendorInfo!, tableName: 'Pocket Monsters MD' },
    }),
    refundedOrderFixture,
  ],
});

/** Every fixture event as the admin editor sees it, plus the venues to pick from. */
export const adminEventsFixture: AdminEventList = AdminEventList.parse({
  events: fixtureEvents.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
    blurb: e.blurb,
    venueId: e.venue.id,
    timeZone: e.timeZone,
    days: e.days,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    published: true,
    vendorStatus: e.vendorStatus,
    ...(e.vendorOpensAt ? { vendorOpensAt: e.vendorOpensAt } : {}),
    tableRateCents: e.tableRateCents,
    pokeBucksRateCents: e.pokeBucksRateCents,
    tableBooking: e.tableBooking ?? 'floor_plan',
    ...(e.tableBooking === 'quantity' ? { tableCapacity: 40 } : {}),
    ...(e.posterUrl ? { posterKey: `events/${e.slug}/poster.jpg`, posterUrl: e.posterUrl } : {}),
    priceWindows:
      e.tableBooking === 'quantity'
        ? [
            {
              id: fid('01JPRC', 1),
              kind: 'early_bird',
              startsAt: '2026-10-01T04:00:00.000Z',
              endsAt: '2026-12-01T05:00:00.000Z',
              tableRateCents: 15000,
              pokeBucksRateCents: 7500,
            },
          ]
        : [],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  })),
  venues: [...new Map(fixtureEvents.map((e) => [e.venue.id, e.venue])).values()].map((v) => ({
    ...v,
    address: '2200 York Rd',
    timeZone: 'America/New_York',
    hasFloorPlan: v.id !== countEventFixture.venue.id,
    tableIds: v.id === venue.id ? floorPlanFixture.tables.map((t) => t.id) : [],
    premiumTables: v.id === venue.id ? [{ tableId: 'F10', premiumDeltaCents: 5000 }] : [],
  })),
});

/** Two vendors asking to cancel: one well before the show, one inside the refund window. */
export const cancelRequestsFixture: CancelRequestList = CancelRequestList.parse({
  items: [
    {
      ...paidOrderFixture,
      id: fid('01JORD', 4),
      passNumber: 'HF26-021',
      vendorInfo: { ...paidOrderFixture.vendorInfo!, tableName: 'Pocket Monsters MD' },
      cancelRequestedAt: '2026-10-02T15:00:00Z',
      cancelReason: 'Our van is in the shop that weekend.',
    },
    {
      ...paidOrderFixture,
      id: fid('01JORD', 5),
      passNumber: 'HF26-030',
      lines: [paidOrderFixture.lines[1]],
      subtotalCents: 40000,
      totalCents: 40000,
      vendorInfo: { ...paidOrderFixture.vendorInfo!, tableName: 'Plush Pals' },
      cancelRequestedAt: '2026-10-05T12:00:00Z',
    },
  ],
  refundCutoffDays: 14,
});
