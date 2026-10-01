import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type {
  Activity,
  Event,
  FloorPlan,
  GalleryItem,
  Partner,
  Role,
  User,
  Venue,
} from '@fgg/types';

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
  user: (sub: string): Keys => ({ PK: `USER#${sub}`, SK: 'META' }),
  /** META plus the email lookup (GSI1) and the sharded admin list (GSI2). */
  userIndex: (u: Pick<User, 'sub' | 'email' | 'createdAt'>): Keys => ({
    ...keys.user(u.sub),
    GSI1PK: `EMAIL#${u.email.toLowerCase()}`,
    GSI1SK: `USER#${u.sub}`,
    GSI2PK: `USERS#${userShard(u.sub)}`,
    GSI2SK: u.createdAt,
  }),
  userStats: (sub: string): Keys => ({ PK: `USER#${sub}`, SK: 'STATS' }),
  userBadge: (sub: string, badgeId: string): Keys => ({
    PK: `USER#${sub}`,
    SK: `BADGE#${badgeId}`,
  }),
  savedEvent: (sub: string, eventId: string): Keys => ({
    PK: `USER#${sub}`,
    SK: `SAVED#${eventId}`,
  }),
};

export const USER_SHARDS = 10;
/** Stable 0..9 shard from the sub so admin paging spreads across partitions. */
export function userShard(sub: string): number {
  let h = 0;
  for (const ch of sub) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % USER_SHARDS;
}

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

// ---------------------------------------------------------------------------
// Users (Phase 2)
// ---------------------------------------------------------------------------

export interface UserStats {
  xp: number;
  checkins: number;
  fests: number;
  updatedAt?: string;
}

export interface UserBadgeItem {
  SK: string;
  badgeId: string;
  awardedAt: string;
  eventId?: string;
}

export interface SavedEventItem {
  SK: string;
  eventId: string;
  savedAt: string;
}

export async function getUser(sub: string): Promise<User | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: keys.user(sub) }));
  return res.Item as User | undefined;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `EMAIL#${email.toLowerCase()}` },
      Limit: 1,
    }),
  );
  return res.Items?.[0] as User | undefined;
}

/** Create the USER record only if it does not exist. Returns true when created. */
export async function createUserIfMissing(user: User): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: { ...keys.userIndex(user), ...user },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

export async function updateUser(
  sub: string,
  patch: Partial<Pick<User, 'displayName' | 'roles' | 'vendorId'>>,
): Promise<User> {
  const sets: string[] = ['#u = :u'];
  const names: Record<string, string> = { '#u': 'updatedAt' };
  const values: Record<string, unknown> = { ':u': new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`#${k} = :${k}`);
    names[`#${k}`] = k;
    values[`:${k}`] = v;
  }
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: keys.user(sub),
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'ALL_NEW',
    }),
  );
  return res.Attributes as User;
}

/** Everything under USER#sub in one query: META, STATS, BADGE#…, SAVED#…. */
export async function listUserItems(sub: string): Promise<{
  user?: User;
  stats: UserStats;
  badges: UserBadgeItem[];
  saved: SavedEventItem[];
}> {
  const items = await queryAll({
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `USER#${sub}` },
  });
  const out: { user?: User; stats: UserStats; badges: UserBadgeItem[]; saved: SavedEventItem[] } = {
    stats: { xp: 0, checkins: 0, fests: 0 },
    badges: [],
    saved: [],
  };
  for (const it of items) {
    const sk = String(it.SK);
    if (sk === 'META') out.user = it as unknown as User;
    else if (sk === 'STATS')
      out.stats = {
        xp: Number(it.xp ?? 0),
        checkins: Number(it.checkins ?? 0),
        fests: Number(it.fests ?? 0),
      };
    else if (sk.startsWith('BADGE#')) out.badges.push(it as unknown as UserBadgeItem);
    else if (sk.startsWith('SAVED#')) out.saved.push(it as unknown as SavedEventItem);
  }
  return out;
}

export async function listSavedEventIds(sub: string): Promise<string[]> {
  const items = await queryAll({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': 'SAVED#' },
    ProjectionExpression: 'eventId',
  });
  return items.map((it) => String(it.eventId));
}

export async function saveEvent(sub: string, eventId: string): Promise<void> {
  await putItem({ ...keys.savedEvent(sub, eventId), eventId, savedAt: new Date().toISOString() });
}

export async function unsaveEvent(sub: string, eventId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: keys.savedEvent(sub, eventId) }));
}

export interface UserPage {
  users: User[];
  /** Opaque continuation: shard + DynamoDB key. */
  next?: { shard: number; key?: Record<string, unknown> };
}

/** Page through all users shard by shard (GSI2 USERS#<shard>, ordered by createdAt). */
export async function listUsers(
  limit: number,
  cursor?: { shard: number; key?: Record<string, unknown> },
): Promise<UserPage> {
  const users: User[] = [];
  let shard = cursor?.shard ?? 0;
  let key = cursor?.key;
  while (shard < USER_SHARDS && users.length < limit) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `USERS#${shard}` },
        Limit: limit - users.length,
        ...(key ? { ExclusiveStartKey: key } : {}),
      }),
    );
    users.push(...((res.Items ?? []) as unknown as User[]));
    if (res.LastEvaluatedKey) {
      key = res.LastEvaluatedKey;
      if (users.length >= limit) return { users, next: { shard, key } };
    } else {
      shard += 1;
      key = undefined;
    }
  }
  return shard < USER_SHARDS ? { users, next: { shard, ...(key ? { key } : {}) } } : { users };
}

export type { Role };
