/**
 * Idempotent dev seed with the placeholder content from the design canvas.
 *   pnpm --filter @fgg/api seed:dev        (AWS_PROFILE=fgg STAGE=dev)
 * Env: STAGE (dev|prod), optional TABLE_NAME, MEDIA_BUCKET.
 * Every entity has a fixed ULID so re-running overwrites instead of duplicating.
 */
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import type {
  Activity,
  Event,
  EventDay,
  FloorPlan,
  FloorTable,
  FloorZone,
  Partner,
  Venue,
} from '@fgg/types';

const STAGE = process.env.STAGE ?? 'dev';
process.env.TABLE_NAME ??= `fgg-${STAGE}`;
const { TABLE, ddb, keys } = await import('../src/lib/db.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.resolve(here, '../../../docs/handoff/uploads');

/** Fixed, valid ULIDs: a shared prefix plus a 2-char suffix per entity. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function fixedUlid(n: number): string {
  return `01HZS33DV0000000000000ED${ALPHABET[Math.floor(n / 32)]}${ALPHABET[n % 32]}`;
}

const NOW = new Date().toISOString();
const TZ = 'America/New_York';

// ---------------------------------------------------------------- venues
interface VenueSeed extends Venue {
  seed: number;
}
const venues: VenueSeed[] = [
  {
    seed: 1,
    id: fixedUlid(1),
    name: 'Maryland State Fairgrounds',
    address: '2200 York Rd',
    city: 'Timonium',
    state: 'MD',
    timeZone: TZ,
  },
  {
    seed: 2,
    id: fixedUlid(2),
    name: 'Merriweather District Hall',
    address: '10215 Wincopin Cir',
    city: 'Columbia',
    state: 'MD',
    timeZone: TZ,
  },
  {
    seed: 3,
    id: fixedUlid(3),
    name: 'Howard County Fairgrounds',
    address: '2210 Fairgrounds Rd',
    city: 'West Friendship',
    state: 'MD',
    timeZone: TZ,
  },
  {
    seed: 4,
    id: fixedUlid(4),
    name: 'Timonium Fairgrounds Exhibition Hall',
    address: '2200 York Rd',
    city: 'Timonium',
    state: 'MD',
    timeZone: TZ,
  },
  {
    seed: 5,
    id: fixedUlid(5),
    name: 'Baltimore Convention Center',
    address: '1 W Pratt St',
    city: 'Baltimore',
    state: 'MD',
    timeZone: TZ,
  },
];
const venueByName = (name: string) => venues.find((v) => v.name === name)!;

/** The designed floor plan: stage top, side zones, rows A–F × 10 with a cross-aisle, entrance bottom. */
function floorPlan(venueId: string): FloorPlan {
  const zones: FloorZone[] = [
    { id: 'stage', label: 'Stage / Tournaments', x: 4, y: 0, w: 14, h: 2 },
    { id: 'art-station', label: 'Art Station', x: 0, y: 3, w: 3, h: 7 },
    { id: 'pokepets', label: 'PokéPets', x: 0, y: 11, w: 3, h: 7 },
    { id: 'kids-trading', label: 'Kids Trading', x: 19, y: 3, w: 3, h: 7 },
    { id: 'find-em-all', label: "Find 'Em All", x: 19, y: 11, w: 3, h: 7 },
    { id: 'entrance', label: 'Entrance / Check-in', x: 4, y: 19, w: 14, h: 2 },
  ];
  const rowNear: Record<string, string> = {
    A: 'stage',
    B: 'stage',
    C: 'center',
    D: 'center',
    E: 'entrance',
    F: 'entrance',
  };
  const tables: FloorTable[] = [];
  const rows = ['A', 'B', 'C', 'D', 'E', 'F'];
  rows.forEach((row, ri) => {
    for (let n = 1; n <= 10; n++) {
      const side = n <= 5 ? 'art-station' : 'kids-trading';
      const nearby = [rowNear[row]!, side, n <= 5 ? 'pokepets' : 'find-em-all'].filter(
        (z) => z !== 'center',
      );
      tables.push({
        id: `${row}${n}`,
        row,
        position: n,
        x: 4 + (n - 1) + (n > 5 ? 1 : 0),
        y: 3 + ri * 2 + Math.floor(ri / 2),
        nearby,
      });
    }
  });
  return { venueId, version: 1, width: 22, height: 21, zones, tables };
}

// ---------------------------------------------------------------- events
interface EventSeed {
  seed: number;
  slug: string;
  seriesId: string;
  name: string;
  venue: string;
  dates: string[];
  hours?: [string, string][];
  blurb: string;
  vendorStatus: Event['vendorStatus'];
  poster?: string;
}
const eventSeeds: EventSeed[] = [
  {
    seed: 10,
    slug: 'halloween-fest-2026',
    seriesId: 'halloween-fest',
    name: 'Halloween Fest',
    venue: 'Maryland State Fairgrounds',
    dates: ['2026-10-24', '2026-10-25'],
    blurb: "Costume contest, trick-or-trade tables, 120+ vendors and a haunted Find 'Em All hunt.",
    vendorStatus: 'open',
    poster: 'halloween-fest-og.jpg',
  },
  {
    seed: 11,
    slug: 'holiday-fest-2026',
    seriesId: 'holiday-fest',
    name: 'Holiday Fest',
    venue: 'Merriweather District Hall',
    dates: ['2026-12-12', '2026-12-13'],
    blurb: 'Gift-swap trading, ugly-sweater tournament and Cards for Cans holiday drive.',
    vendorStatus: 'closed',
  },
  {
    seed: 12,
    slug: 'spring-fest-2027',
    seriesId: 'spring-fest',
    name: 'Spring Fest',
    venue: 'Howard County Fairgrounds',
    dates: ['2027-04-24', '2027-04-25'],
    blurb: "Outdoor Find 'Em All, Art Station garden and the season-opening PokéPets parade.",
    vendorStatus: 'coming_soon',
    poster: 'spring-fest-og.png',
  },
  {
    seed: 13,
    slug: 'summer-fest-2027',
    seriesId: 'summer-fest',
    name: 'Summer Fest',
    venue: 'Timonium Fairgrounds Exhibition Hall',
    dates: ['2027-06-26', '2027-06-27'],
    blurb: 'Beach-day theme, water-balloon raffle and our biggest tournament bracket.',
    vendorStatus: 'coming_soon',
    poster: 'summer-fest-og.png',
  },
  {
    seed: 14,
    slug: 'harbor-fest-2027',
    seriesId: 'harbor-fest',
    name: 'Harbor Fest',
    venue: 'Baltimore Convention Center',
    dates: ['2027-08-06', '2027-08-07', '2027-08-08'],
    hours: [
      ['10:00', '17:00'],
      ['10:00', '20:00'],
      ['10:00', '17:00'],
    ],
    blurb: 'Three days, 300+ vendors — the #1 family card show in Maryland.',
    vendorStatus: 'coming_soon',
    poster: 'harbor-fest-og.jpg',
  },
  // Past events so the gallery and past-events teaser have data.
  {
    seed: 15,
    slug: 'harbor-fest-2026',
    seriesId: 'harbor-fest',
    name: 'Harbor Fest',
    venue: 'Baltimore Convention Center',
    dates: ['2026-08-07', '2026-08-08', '2026-08-09'],
    hours: [
      ['10:00', '17:00'],
      ['10:00', '20:00'],
      ['10:00', '17:00'],
    ],
    blurb: 'Three days, 300+ vendors — the #1 family card show in Maryland.',
    vendorStatus: 'closed',
    poster: 'harbor-fest-og.jpg',
  },
  {
    seed: 16,
    slug: 'summer-fest-2026',
    seriesId: 'summer-fest',
    name: 'Summer Fest',
    venue: 'Timonium Fairgrounds Exhibition Hall',
    dates: ['2026-06-27', '2026-06-28'],
    blurb: 'Beach-day theme, water-balloon raffle and our biggest tournament bracket.',
    vendorStatus: 'closed',
    poster: 'summer-fest-og.png',
  },
  {
    seed: 17,
    slug: 'spring-fest-2026',
    seriesId: 'spring-fest',
    name: 'Spring Fest',
    venue: 'Howard County Fairgrounds',
    dates: ['2026-04-25', '2026-04-26'],
    blurb: "Outdoor Find 'Em All, Art Station garden and the season-opening PokéPets parade.",
    vendorStatus: 'closed',
    poster: 'spring-fest-og.png',
  },
];

/** Local wall-clock → UTC instant for America/New_York (EDT −4 / EST −5 by month, good enough for seeds). */
function localToIso(date: string, hhmm: string): string {
  const month = Number(date.slice(5, 7));
  const offset = month >= 4 && month <= 10 ? 4 : 5;
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(h + offset, m);
  return d.toISOString();
}

function buildEvent(s: EventSeed): Event {
  const days: EventDay[] = s.dates.map((date, i) => {
    const [opens, closes] = s.hours?.[i] ?? ['11:00', '17:00'];
    return { date, opens, closes, vendorLoadIn: '09:00' };
  });
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return {
    id: fixedUlid(s.seed),
    slug: s.slug,
    seriesId: s.seriesId,
    name: s.name,
    blurb: s.blurb,
    venueId: venueByName(s.venue).id,
    timeZone: TZ,
    days,
    startsAt: localToIso(first.date, first.opens),
    endsAt: localToIso(last.date, last.closes),
    ...(s.poster ? { posterKey: `events/${s.slug}/poster${path.extname(s.poster)}` } : {}),
    published: true,
    vendorStatus: s.vendorStatus,
    tableRateCents: 20000,
    pokeBucksRateCents: 10000,
    floorPlanVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

// ---------------------------------------------------------------- config
const activities: Activity[] = [
  {
    id: 'find-em-all',
    name: "Find 'Em All",
    description:
      'A scavenger hunt through the whole show. Find every hidden critter to win a prize.',
    xp: 50,
    sortOrder: 1,
  },
  {
    id: 'art-station',
    name: 'Art Station',
    description: 'Draw, color and design your own creature card at the free art tables.',
    xp: 25,
    sortOrder: 2,
  },
  {
    id: 'pokepets',
    name: 'PokéPets',
    description: 'Adopt an original plush pal, name it and take it on adventures around the fest.',
    xp: 25,
    sortOrder: 3,
  },
  {
    id: 'cards-for-cans',
    name: 'Cards for Cans',
    description: 'Bring canned food for the local pantry and trade it for a free card pack.',
    xp: 50,
    sortOrder: 4,
  },
  {
    id: 'trading',
    name: 'Trading',
    description: 'Supervised trading tables where kids swap fairly and make new friends.',
    xp: 25,
    sortOrder: 5,
  },
  {
    id: 'gaming',
    name: 'Gaming & Tournaments',
    description: 'Casual play all day, with beginner and open brackets every afternoon.',
    xp: 75,
    sortOrder: 6,
  },
];

const partners: Partner[] = ['Partner One', 'Partner Two', 'Partner Three'].map((name, i) => ({
  id: fixedUlid(20 + i),
  name,
  logoKey: 'partners/fgg-logo.png',
  sortOrder: i + 1,
}));

// ---------------------------------------------------------------- gallery
function label(s: EventSeed): string {
  return `${s.name} ${s.dates[0]!.slice(0, 4)}`;
}
const bySlug = (slug: string) => eventSeeds.find((e) => e.slug === slug)!;
const galleryItems = (() => {
  const harbor = bySlug('harbor-fest-2026');
  const summer = bySlug('summer-fest-2026');
  const spring = bySlug('spring-fest-2026');
  const ev = (s: EventSeed) => ({
    eventId: fixedUlid(s.seed),
    eventName: s.name,
    eventLabel: label(s),
  });
  return [
    {
      ...ev(harbor),
      type: 'photo',
      id: fixedUlid(30),
      mediaKey: 'gallery/harbor-fest-2026/poster.jpg',
      caption: 'Harbor Fest · Aug 2026',
      featured: true,
      sortOrder: 1,
    },
    {
      ...ev(summer),
      type: 'photo',
      id: fixedUlid(31),
      mediaKey: 'gallery/summer-fest-2026/poster.png',
      caption: 'Summer Fest · Jun 2026',
      featured: true,
      sortOrder: 1,
    },
    {
      ...ev(spring),
      type: 'photo',
      id: fixedUlid(32),
      mediaKey: 'gallery/spring-fest-2026/poster.png',
      caption: 'Spring Fest · Apr 2026',
      featured: true,
      sortOrder: 1,
    },
    {
      ...ev(summer),
      type: 'quote',
      id: fixedUlid(33),
      text: "My son traded his first card here and hasn't stopped smiling.",
      attribution: 'Parent, Summer Fest',
      featured: true,
      sortOrder: 2,
    },
    {
      ...ev(summer),
      type: 'quote',
      id: fixedUlid(34),
      text: "Best day of my summer, and I'm 41.",
      attribution: 'Dad, Summer Fest',
      featured: false,
      sortOrder: 3,
    },
    {
      ...ev(spring),
      type: 'stat',
      id: fixedUlid(35),
      value: '1,180',
      label: 'Cans donated · Spring Fest',
      featured: true,
      sortOrder: 2,
    },
  ];
})();

// ---------------------------------------------------------------- write
async function batchWrite(items: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    let req: Record<string, { PutRequest: { Item: Record<string, unknown> } }[]> = {
      [TABLE]: chunk.map((Item) => ({ PutRequest: { Item } })),
    };
    while (Object.keys(req).length) {
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: req }));
      req = (res.UnprocessedItems ?? {}) as typeof req;
      if (Object.keys(req).length) await new Promise((r) => setTimeout(r, 300));
    }
  }
}

async function resolveBucket(): Promise<string> {
  if (process.env.MEDIA_BUCKET) return process.env.MEDIA_BUCKET;
  const account = execSync('aws sts get-caller-identity --query Account --output text', {
    encoding: 'utf8',
  }).trim();
  return `fgg-media-${STAGE}-${account}`;
}

async function uploadMedia(): Promise<void> {
  const bucket = await resolveBucket();
  const s3 = new S3Client({});
  const puts: [string, string][] = [['fgg-logo.png', 'partners/fgg-logo.png']];
  for (const s of eventSeeds) {
    if (!s.poster) continue;
    const ext = path.extname(s.poster);
    puts.push([s.poster, `events/${s.slug}/poster${ext}`]);
    if (
      galleryItems.some((g) => 'mediaKey' in g && g.mediaKey === `gallery/${s.slug}/poster${ext}`)
    ) {
      puts.push([s.poster, `gallery/${s.slug}/poster${ext}`]);
    }
  }
  for (const [file, key] of puts) {
    const body = await readFile(path.join(UPLOADS, file));
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: key.endsWith('.png') ? 'image/png' : 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }
  console.log(`uploaded ${puts.length} media objects to s3://${bucket}`);
}

async function main(): Promise<void> {
  const items: Record<string, unknown>[] = [];
  for (const v of venues) {
    const { seed: _s, ...venue } = v;
    items.push({ ...keys.venue(v.id), ...venue });
    items.push({ ...keys.floorPlan(v.id), ...floorPlan(v.id) });
  }
  for (const s of eventSeeds) {
    const ev = buildEvent(s);
    items.push({ ...keys.eventIndex(ev), ...ev });
  }
  for (const a of activities) items.push({ ...keys.activity(a.id, a.sortOrder), ...a });
  for (const p of partners) items.push({ ...keys.partner(p.id, p.sortOrder), ...p });
  for (const g of galleryItems) items.push({ ...keys.galleryItem(g.eventId, g.sortOrder), ...g });
  items.push({
    ...keys.settings(),
    contactEmail: 'hello@feelgoodgaming.com',
    social: {},
    processingFeePct: 0,
    taxPct: 0,
    holdMinutes: 10,
    checkoutHoldMinutes: 30,
    refundCutoffDays: 14,
    vendorApprovalMode: 'manual_call',
    updatedAt: NOW,
  });

  await batchWrite(items);
  console.log(`wrote ${items.length} items to ${TABLE}`);
  await uploadMedia();
}

await main();
