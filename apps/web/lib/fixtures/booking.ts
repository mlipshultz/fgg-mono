import {
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
  type Vendor,
} from '@fgg/types';
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
  availability: {
    eventId: halloween.id,
    vendorStatus: 'open',
    tablesLeft: 60 - TAKEN.size,
    // A few tables differ by day so the picker's per-day stripes show up in fixture mode.
    days: halloween.days.map((d, i) => ({
      date: d.date,
      unavailable: [...TAKEN, ...(i === 0 ? ['D4', 'E5'] : ['A3', 'C5', 'F1'])].sort(),
    })),
  },
});

export interface CartLineFixture {
  tableId: string;
  dates: string[];
}

export function quoteFixture(lines: CartLineFixture[], rate: 'standard' | 'poke_bucks'): Quote {
  const unit = rate === 'poke_bucks' ? 10000 : 20000;
  const priced = lines.map(({ tableId, dates }) => {
    const row = tableId[0]!;
    const n = Number(tableId.slice(1));
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
  const now = Date.now();
  return HoldResponse.parse({
    hold: {
      id: fid('01JHLD', 1),
      eventId: halloween.id,
      vendorId: fid('01JVND', 1),
      heldBy: '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d',
      rate,
      tables: quote.lines.map((l) => ({
        tableId: l.tableId,
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
    event: halloween,
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
      logoUrl: 'https://fixture.local/fixtures/vendor-logo.svg',
      socials: { instagram: 'mayascardcorner' },
      tableId: 'B7',
      dates: ['2026-10-24', '2026-10-25'],
    },
    {
      vendorId: fid('01JVND', 2),
      name: 'Pocket Monsters MD',
      sellsDescription: 'Modern singles, a $1 bulk bin and a few sealed ETBs.',
      socials: { instagram: 'pocketmonstersmd', tiktok: 'pmmd' },
      tableId: 'C2',
      dates: ['2026-10-24'],
    },
    {
      vendorId: fid('01JVND', 3),
      name: 'Plush Pals',
      sellsDescription: 'Handmade plush and embroidered hats.',
      socials: { website: 'https://plushpals.example' },
      tableId: 'E4',
      dates: ['2026-10-24', '2026-10-25'],
    },
  ],
});

export const vendorDashboardFixture: VendorDashboard = VendorDashboard.parse({
  vendor: vendorProfileFixture,
  upcoming: [paidOrderFixture],
  history: [paidOrderFixture, refundedOrderFixture],
  paidThisYearCents: 70000,
  balanceDueCents: 0,
  events: fixtureEvents.slice(1),
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
