import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { ulid } from 'ulid';
import {
  ContactSubmissionInput,
  SubscribeInput,
  WaitlistInput,
  type Event,
  type EventFloorPlan,
  type EventVendor,
  type EventVendorList,
  type GalleryPage,
  type Order,
  type HomeContent,
  type PublicGalleryItem,
  type PublicSettings,
} from '@fgg/types';
import {
  getEvent,
  getEventBySlug,
  getFloorPlan,
  getSettingsItem,
  getVendor,
  keys,
  listActivities,
  listFeaturedGallery,
  listGalleryEvents,
  listPartners,
  listOrdersForEvent,
  listPublishedEvents,
  putItem,
  queryGallery,
  type StoredGalleryItem,
} from '../lib/db.js';
import { HttpError, Router, json, parseBody, type Req } from '../lib/http.js';
import { mediaUrl, thumbUrl } from '../lib/media.js';
import {
  loadAvailability,
  todayIso,
  toPublicEvent,
  toPublicEvents,
  venueFor,
} from '../lib/events.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

async function resolveEvent(idOrSlug: string): Promise<Event> {
  const ev = ULID_RE.test(idOrSlug) ? await getEvent(idOrSlug) : await getEventBySlug(idOrSlug);
  if (!ev || !ev.published) throw new HttpError(404, 'event_not_found', 'Event not found');
  return ev;
}

function toPublicGalleryItem(it: StoredGalleryItem): PublicGalleryItem {
  const base = {
    id: it.id,
    eventId: it.eventId,
    eventName: it.eventName,
    eventLabel: it.eventLabel,
  };
  switch (it.type) {
    case 'photo':
      return {
        ...base,
        type: 'photo',
        url: mediaUrl(it.mediaKey),
        thumbUrl: thumbUrl(it.mediaKey),
        ...(it.caption ? { caption: it.caption } : {}),
        featured: it.featured ?? false,
      };
    case 'video':
      return {
        ...base,
        type: 'video',
        url: mediaUrl(it.mediaKey),
        posterUrl: mediaUrl(it.posterKey),
        durationSeconds: it.durationSeconds,
        ...(it.caption ? { caption: it.caption } : {}),
        featured: it.featured ?? false,
      };
    case 'stat':
      return { ...base, type: 'stat', value: it.value, label: it.label };
    case 'quote':
      return {
        ...base,
        type: 'quote',
        text: it.text,
        ...(it.attribution ? { attribution: it.attribution } : {}),
      };
  }
}

async function loadSettings(): Promise<PublicSettings> {
  const s = (await getSettingsItem()) ?? {};
  const str = (k: string) => (typeof s[k] === 'string' && s[k] ? (s[k] as string) : undefined);
  const social = (s.social ?? {}) as Record<string, unknown>;
  const pick = (k: string) =>
    typeof social[k] === 'string' && social[k] ? { [k]: social[k] } : {};
  return {
    contactEmail: str('contactEmail') ?? 'hello@feelgoodgaming.com',
    ...(str('discordInviteUrl') ? { discordInviteUrl: str('discordInviteUrl')! } : {}),
    social: {
      ...pick('discord'),
      ...pick('instagram'),
      ...pick('tiktok'),
      ...pick('youtube'),
      ...pick('facebook'),
    },
    ...(str('heroVideoUrl') ? { heroVideoUrl: str('heroVideoUrl')! } : {}),
    ...(str('heroPosterUrl') ? { heroPosterUrl: str('heroPosterUrl')! } : {}),
  };
}

const encodeCursor = (k: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(k)).toString('base64url');
function decodeCursor(c: string | undefined): Record<string, unknown> | undefined {
  if (!c) return undefined;
  try {
    return JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'bad_cursor', 'Invalid cursor');
  }
}

export const router = new Router()
  .add('GET', '/public/home', async (req) => {
    const today = todayIso();
    const all = await listPublishedEvents();
    const upcoming = all.filter((e) => e.endsAt.slice(0, 10) >= today);
    const past = all
      .filter((e) => e.endsAt.slice(0, 10) < today)
      .reverse()
      .slice(0, 8);
    const [events, pastPublic, activities, partners, featured, settings] = await Promise.all([
      toPublicEvents(upcoming),
      Promise.all(
        past.map(async (e) => {
          const v = await venueFor(e.venueId);
          return v ? toPublicEvent(e, v) : undefined;
        }),
      ),
      listActivities(),
      listPartners(),
      listFeaturedGallery(5),
      loadSettings(),
    ]);
    const body: HomeContent = {
      events,
      pastEvents: pastPublic
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          startDate: p.startDate,
          endDate: p.endDate,
          venue: p.venue,
          ...(p.posterUrl ? { posterUrl: p.posterUrl } : {}),
        })),
      activities: [...activities].sort((a, b) => a.sortOrder - b.sortOrder).map(stripKeys),
      partners: [...partners]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => ({
          id: p.id,
          name: p.name,
          logoUrl: mediaUrl(p.logoKey),
          ...(p.url ? { url: p.url } : {}),
          sortOrder: p.sortOrder,
        })),
      galleryTeaser: featured.map(toPublicGalleryItem),
      settings,
    };
    return json(req, body, 200, { 'cache-control': 'public, max-age=60' });
  })
  .add('GET', '/public/events', async (req) => {
    const today = todayIso();
    const all = await listPublishedEvents();
    const events = await toPublicEvents(all.filter((e) => e.endsAt.slice(0, 10) >= today));
    return json(req, { events }, 200, { 'cache-control': 'public, max-age=60' });
  })
  .add('GET', '/public/events/{id}/floorplan', async (req, { id }) => {
    const ev = await resolveEvent(id!);
    const [venue, floorPlan, availability] = await Promise.all([
      venueFor(ev.venueId),
      getFloorPlan(ev.venueId),
      loadAvailability(ev),
    ]);
    if (!venue) throw new HttpError(500, 'venue_missing', 'Venue missing');
    if (!floorPlan) throw new HttpError(404, 'no_floor_plan', 'This venue has no floor plan yet');
    const body: EventFloorPlan = {
      event: toPublicEvent(ev, venue, availability.tablesLeft),
      venue,
      floorPlan,
      availability,
    };
    return json(req, body, 200, { 'cache-control': 'no-store' });
  })
  .add('GET', '/public/events/{id}/vendors', async (req, { id }) => {
    const ev = await resolveEvent(id!);
    const orders: Order[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await listOrdersForEvent(ev.id, 200, cursor);
      orders.push(...page.items);
      cursor = page.lastKey;
    } while (cursor);
    const paid = orders.filter((o) => o.status === 'paid' && o.kind === 'vendor_table');
    const ids = [...new Set(paid.map((o) => o.ownerId))];
    const vendors = new Map(
      (await Promise.all(ids.map((vid) => getVendor(vid))))
        .filter((v): v is NonNullable<typeof v> => !!v)
        .map((v) => [v.id, v]),
    );
    // One card per vendor, however many tables or orders they have.
    const byVendor = new Map<string, EventVendor>();
    for (const o of paid) {
      const v = vendors.get(o.ownerId);
      if (!v) continue;
      const entry = byVendor.get(v.id) ?? {
        vendorId: v.id,
        name: o.vendorInfo?.tableName || v.businessName,
        sellsDescription: o.vendorInfo?.sellsDescription || v.sellsDescription || '',
        tags: v.sells ?? [],
        ...(v.logoKey ? { logoUrl: mediaUrl(v.logoKey) } : {}),
        socials: v.socials ?? {},
        tables: [],
      };
      for (const line of o.lines) {
        if (line.type !== 'table') continue;
        const t = entry.tables.find((x) => x.tableId === line.tableId);
        if (t) t.dates = [...new Set([...t.dates, ...line.dates])].sort();
        else entry.tables.push({ tableId: line.tableId, dates: [...line.dates].sort() });
      }
      if (entry.tables.length) byVendor.set(v.id, entry);
    }
    const list = [...byVendor.values()];
    for (const e of list)
      e.tables.sort((a, b) => a.tableId.localeCompare(b.tableId, 'en', { numeric: true }));
    list.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    const [event] = await toPublicEvents([ev]);
    const body: EventVendorList = { event: event!, vendors: list };
    return json(req, body, 200, { 'cache-control': 'public, max-age=60' });
  })
  .add('GET', '/public/events/{id}/availability', async (req, { id }) => {
    const ev = await resolveEvent(id!);
    return json(req, await loadAvailability(ev), 200, { 'cache-control': 'no-store' });
  })
  .add('GET', '/public/gallery', async (req) => {
    const q = req.queryStringParameters ?? {};
    const limit = Math.min(48, Math.max(1, Number(q.limit) || 12));
    const eventId = q.eventId && ULID_RE.test(q.eventId) ? q.eventId : undefined;
    const [page, events] = await Promise.all([
      queryGallery({
        ...(eventId ? { eventId } : {}),
        videosOnly: q.videosOnly === 'true',
        limit,
        ...(decodeCursor(q.cursor) ? { cursor: decodeCursor(q.cursor)! } : {}),
      }),
      listGalleryEvents(),
    ]);
    const body: GalleryPage = {
      items: page.items.map(toPublicGalleryItem),
      ...(page.lastKey ? { nextCursor: encodeCursor(page.lastKey) } : {}),
      events,
    };
    return json(req, body, 200, { 'cache-control': 'public, max-age=60' });
  })
  .add('POST', '/public/subscribe', async (req) => {
    const input = parseBody(req, SubscribeInput);
    const now = new Date().toISOString();
    await putItem({
      ...keys.subscriber(input.email),
      email: input.email.toLowerCase(),
      source: input.source,
      subscribedAt: now,
      updatedAt: now,
    });
    await pushToKlaviyo(input.email, input.source);
    return json(req, { ok: true });
  })
  .add('POST', '/public/contact', async (req) => {
    const input = parseBody(req, ContactSubmissionInput);
    const now = new Date().toISOString();
    const id = ulid();
    await putItem({ ...keys.contact(now, id), id, ...input, createdAt: now });
    await notifyContact(input);
    return json(req, { ok: true });
  })
  .add('POST', '/public/events/{id}/waitlist', async (req, { id }) => {
    const input = parseBody(req, WaitlistInput);
    const ev = await resolveEvent(id!);
    const now = new Date().toISOString();
    await putItem({
      ...keys.waitlist(ev.id, input.kind, now, input.email),
      eventId: ev.id,
      email: input.email.toLowerCase(),
      kind: input.kind,
      createdAt: now,
    });
    return json(req, { ok: true });
  });

function stripKeys<T extends object>(item: T): T {
  const {
    PK: _pk,
    SK: _sk,
    GSI1PK: _a,
    GSI1SK: _b,
    GSI2PK: _c,
    GSI2SK: _d,
    ...rest
  } = item as T & Record<string, unknown>;
  return rest as T;
}

/** Best effort: mirror the signup into the existing Klaviyo list. Never fails the request. */
async function pushToKlaviyo(email: string, source: string): Promise<void> {
  const key = process.env.KLAVIYO_API_KEY;
  const listId = process.env.KLAVIYO_LIST_ID;
  if (!key || !listId) return;
  try {
    const res = await fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs', {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        'content-type': 'application/vnd.api+json',
        accept: 'application/vnd.api+json',
        revision: '2024-10-15',
      },
      body: JSON.stringify({
        data: {
          type: 'profile-subscription-bulk-create-job',
          attributes: {
            custom_source: source,
            profiles: {
              data: [
                {
                  type: 'profile',
                  attributes: {
                    email,
                    subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } },
                  },
                },
              ],
            },
          },
          relationships: { list: { data: { type: 'list', id: listId } } },
        },
      }),
    });
    if (!res.ok) console.warn('klaviyo', res.status, await res.text());
  } catch (e) {
    console.warn('klaviyo failed', e);
  }
}

let ses: SESv2Client | undefined;

/** Best effort: email staff about a new contact submission once SES has a verified identity. */
async function notifyContact(input: ContactSubmissionInput): Promise<void> {
  const to = process.env.CONTACT_NOTIFY_EMAIL;
  const from = process.env.SES_FROM_EMAIL;
  if (!to || !from) return;
  try {
    ses ??= new SESv2Client({});
    const text = [
      `Name: ${input.name}`,
      `Organization: ${input.organization ?? '-'}`,
      `Email: ${input.email}`,
      `Interested in: ${input.interests.join(', ') || '-'}`,
      '',
      input.message,
    ].join('\n');
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        ReplyToAddresses: [input.email],
        Content: {
          Simple: {
            Subject: { Data: `New contact form message from ${input.name}` },
            Body: { Text: { Data: text } },
          },
        },
      }),
    );
  } catch (e) {
    console.warn('ses failed', e);
  }
}

export const handler = (req: Req) => router.handle(req);
