import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { Activity, Event, FloorPlan, GalleryItem, Partner, Venue } from '@fgg/types';

/** Single table (docs/PLAN.md §3.4). Name from TABLE_NAME. */
export const TABLE = process.env.TABLE_NAME ?? 'fgg-dev';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export interface Keys {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
}

export const keys = {
  event: (id: string): Keys => ({ PK: `EVENT#${id}`, SK: 'META' }),
  eventIndex: (ev: Pick<Event, 'id' | 'slug' | 'startsAt' | 'published'>): Keys => ({
    ...keys.event(ev.id),
    ...(ev.published ? { GSI1PK: 'EVENTS#published', GSI1SK: ev.startsAt } : {}),
    GSI2PK: `SLUG#${ev.slug}`,
    GSI2SK: `EVENT#${ev.id}`,
  }),
  venue: (id: string): Keys => ({ PK: `VENUE#${id}`, SK: 'META' }),
  floorPlan: (venueId: string): Keys => ({ PK: `VENUE#${venueId}`, SK: 'FLOORPLAN' }),
  hold: (eventId: string, date: string, tableId: string): Keys => ({
    PK: `EVENT#${eventId}`,
    SK: `HOLD#${date}#${tableId}`,
  }),
  bookedTable: (eventId: string, date: string, tableId: string): Keys => ({
    PK: `EVENT#${eventId}`,
    SK: `TABLE#${date}#${tableId}`,
  }),
  activity: (id: string, sortOrder: number): Keys => ({
    PK: 'CONFIG',
    SK: `ACTIVITY#${pad(sortOrder)}#${id}`,
  }),
  partner: (id: string, sortOrder: number): Keys => ({
    PK: 'CONFIG',
    SK: `PARTNER#${pad(sortOrder)}#${id}`,
  }),
  settings: (): Keys => ({ PK: 'CONFIG', SK: 'SETTINGS' }),
  galleryItem: (eventId: string, sortOrder: number): Keys => ({
    PK: 'GALLERY',
    SK: `ITEM#${eventId}#${pad(sortOrder)}`,
    GSI1PK: `EVENT#${eventId}`,
    GSI1SK: `GALLERY#${pad(sortOrder)}`,
  }),
  subscriber: (email: string): Keys => ({ PK: 'LIST', SK: `SUB#${email.toLowerCase()}` }),
  contact: (ts: string, id: string): Keys => ({ PK: 'CONTACT', SK: `MSG#${ts}#${id}` }),
  waitlist: (eventId: string, kind: 'waitlist' | 'notify_me', ts: string, email: string): Keys => ({
    PK: `EVENT#${eventId}`,
    SK: `${kind === 'waitlist' ? 'WAIT' : 'NOTIFY'}#${ts}#${email.toLowerCase()}`,
  }),
};

export function pad(n: number, width = 4): string {
  return String(n).padStart(width, '0');
}

/** Stored gallery item: the domain item plus denormalized event labels for listing. */
export type StoredGalleryItem = GalleryItem & { eventName: string; eventLabel: string };

export interface HoldItem {
  SK: string;
  holdId: string;
  tableId: string;
  date: string;
  expiresAt: string;
}

export interface BookedTableItem {
  SK: string;
  tableId: string;
  date: string;
  orderId: string;
}

type Item = Record<string, unknown>;

async function queryAll(input: Omit<QueryCommandInput, 'TableName'>): Promise<Item[]> {
  const items: Item[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        ...input,
        ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
      }),
    );
    items.push(...((res.Items ?? []) as Item[]));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export async function getEvent(id: string): Promise<Event | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: keys.event(id) }));
  return res.Item as Event | undefined;
}

export async function getEventBySlug(slug: string): Promise<Event | undefined> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `SLUG#${slug}` },
      Limit: 1,
    }),
  );
  return res.Items?.[0] as Event | undefined;
}

/** Published events, ascending by startsAt. */
export async function listPublishedEvents(): Promise<Event[]> {
  const items = await queryAll({
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': 'EVENTS#published' },
  });
  return items as unknown as Event[];
}

export async function getVenue(id: string): Promise<Venue | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: keys.venue(id) }));
  return res.Item as Venue | undefined;
}

export async function getFloorPlan(venueId: string): Promise<FloorPlan | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: keys.floorPlan(venueId) }));
  return res.Item as FloorPlan | undefined;
}

async function listEventPrefix<T>(eventId: string, prefix: string): Promise<T[]> {
  const items = await queryAll({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `EVENT#${eventId}`, ':sk': prefix },
  });
  return items as unknown as T[];
}

export const listHolds = (eventId: string) => listEventPrefix<HoldItem>(eventId, 'HOLD#');
export const listBookedTables = (eventId: string) =>
  listEventPrefix<BookedTableItem>(eventId, 'TABLE#');

async function listConfig<T>(prefix: string): Promise<T[]> {
  const items = await queryAll({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': 'CONFIG', ':sk': prefix },
  });
  return items as unknown as T[];
}

export const listActivities = () => listConfig<Activity>('ACTIVITY#');
export const listPartners = () => listConfig<Partner>('PARTNER#');

export async function getSettingsItem(): Promise<Item | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: keys.settings() }));
  return res.Item as Item | undefined;
}

export interface GalleryQuery {
  eventId?: string;
  videosOnly?: boolean;
  limit: number;
  cursor?: Record<string, unknown>;
}

export interface GalleryResult {
  items: StoredGalleryItem[];
  lastKey?: Record<string, unknown>;
}

export async function queryGallery(q: GalleryQuery): Promise<GalleryResult> {
  const base: Omit<QueryCommandInput, 'TableName'> = q.eventId
    ? {
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `EVENT#${q.eventId}`, ':sk': 'GALLERY#' },
      }
    : {
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'GALLERY' },
      };
  const input: QueryCommandInput = {
    TableName: TABLE,
    ...base,
    Limit: q.limit,
    ...(q.cursor ? { ExclusiveStartKey: q.cursor } : {}),
  };
  if (q.videosOnly) {
    input.FilterExpression = '#t = :video';
    input.ExpressionAttributeNames = { '#t': 'type' };
    input.ExpressionAttributeValues = { ...input.ExpressionAttributeValues, ':video': 'video' };
  }
  const res = await ddb.send(new QueryCommand(input));
  return {
    items: (res.Items ?? []) as StoredGalleryItem[],
    ...(res.LastEvaluatedKey ? { lastKey: res.LastEvaluatedKey } : {}),
  };
}

/** Distinct events that have gallery items (projection query over the small GALLERY partition). */
export async function listGalleryEvents(): Promise<{ id: string; label: string }[]> {
  const items = await queryAll({
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': 'GALLERY' },
    ProjectionExpression: 'eventId, eventLabel',
  });
  const seen = new Map<string, string>();
  for (const it of items) {
    const id = it.eventId as string;
    if (!seen.has(id)) seen.set(id, (it.eventLabel as string) ?? id);
  }
  return [...seen].map(([id, label]) => ({ id, label }));
}

/** Featured gallery items for the homepage teaser. */
export async function listFeaturedGallery(max: number): Promise<StoredGalleryItem[]> {
  const items = await queryAll({
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': 'GALLERY', ':t': true },
    FilterExpression: 'featured = :t',
  });
  return (items as unknown as StoredGalleryItem[]).slice(0, max);
}

export async function putItem(item: Item): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
}
