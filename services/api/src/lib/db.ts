import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { monotonicFactory } from 'ulid';
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  Settings,
  type Activity,
  type Event,
  type FloorPlan,
  type GalleryItem,
  type Order,
  type OrderHistoryEntry,
  type Partner,
  type PriceWindow,
  type Role,
  type User,
  type Vendor,
  type VendorApplication,
  type VendorMember,
  type Venue,
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
  // Phase 3
  vendorApplication: (sub: string): Keys => ({ PK: `USER#${sub}`, SK: 'VENDORAPP' }),
  vendorApplicationIndex: (
    a: Pick<VendorApplication, 'userId' | 'status' | 'createdAt'>,
  ): Keys => ({
    ...keys.vendorApplication(a.userId),
    GSI1PK: `VENDORAPPS#${a.status}`,
    GSI1SK: a.createdAt,
  }),
  vendor: (id: string): Keys => ({ PK: `VENDOR#${id}`, SK: 'META' }),
  vendorIndex: (v: Pick<Vendor, 'id' | 'status' | 'businessName'>): Keys => ({
    ...keys.vendor(v.id),
    GSI1PK: `VENDORS#${v.status}`,
    GSI1SK: v.businessName.toLowerCase(),
  }),
  vendorMember: (vendorId: string, sub: string): Keys => ({
    PK: `VENDOR#${vendorId}`,
    SK: `MEMBER#${sub}`,
    GSI1PK: `USER#${sub}`,
    GSI1SK: `VENDOR#${vendorId}`,
  }),
  priceWindow: (eventId: string, kind: string, startsAt: string): Keys => ({
    PK: `EVENT#${eventId}`,
    SK: `PRICE#${kind}#${startsAt}`,
  }),
  /** Canonical order item. Owner lookups via GSI1, status views via GSI2. */
  order: (id: string): Keys => ({ PK: `ORDER#${id}`, SK: 'META' }),
  orderIndex: (
    o: Pick<Order, 'id' | 'ownerId' | 'status' | 'createdAt'>,
    startsAt: string,
  ): Keys => ({
    ...keys.order(o.id),
    GSI1PK: `OWNER#${o.ownerId}`,
    GSI1SK: `ORDER#${startsAt}#${o.id}`,
    GSI2PK: `ORDERS#${o.status}`,
    GSI2SK: `${o.createdAt}#${o.id}`,
  }),
  /** Pointer under the event so admin can list an event's orders without an index. */
  eventOrder: (eventId: string, orderId: string): Keys => ({
    PK: `EVENT#${eventId}`,
    SK: `ORDER#${orderId}`,
  }),
  orderHistory: (orderId: string, at: string, id: string): Keys => ({
    PK: `ORDER#${orderId}`,
    SK: `HIST#${at}#${id}`,
  }),
  /** Reverse lookup from Shopify's order id to ours (refund webhooks). */
  shopifyOrder: (shopifyOrderId: string): Keys => ({
    PK: `SHOPIFYORDER#${shopifyOrderId}`,
    SK: 'ORDER',
  }),
  counter: (eventId: string): Keys => ({ PK: `EVENT#${eventId}`, SK: 'COUNTER' }),
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
  PK: string;
  SK: string;
  holdId: string;
  eventId: string;
  vendorId: string;
  heldBy: string;
  tableId: string;
  date: string;
  dates: string[];
  rate: 'standard' | 'poke_bucks';
  unitCents: number;
  amountCents: number;
  feeCents: number;
  taxCents: number;
  totalCents: number;
  pricingInputs: Record<string, unknown>;
  vendorInfo?: Record<string, unknown>;
  expiresAt: string;
  ttl: number;
  createdAt: string;
  GSI1PK?: string;
  GSI1SK?: string;
}

export interface BookedTableItem {
  PK: string;
  SK: string;
  tableId: string;
  date: string;
  orderId: string;
  vendorId: string;
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

// ---------------------------------------------------------------------------
// Phase 3: vendors, applications, orders, holds, pricing
// ---------------------------------------------------------------------------

export { TransactWriteCommand };

export async function getSettings(): Promise<Settings> {
  const item = await getSettingsItem();
  const { PK: _pk, SK: _sk, ...rest } = (item ?? {}) as Record<string, unknown>;
  return Settings.parse(rest);
}

export async function getVendorApplication(sub: string): Promise<VendorApplication | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: keys.vendorApplication(sub) }),
  );
  return res.Item ? (stripKeys(res.Item) as VendorApplication) : undefined;
}

export async function putVendorApplication(a: VendorApplication): Promise<void> {
  await putItem({ ...keys.vendorApplicationIndex(a), ...a });
}

export interface AppPage {
  items: VendorApplication[];
  lastKey?: Record<string, unknown>;
}

export async function listVendorApplications(
  status: VendorApplication['status'],
  limit: number,
  cursor?: Record<string, unknown>,
): Promise<AppPage> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `VENDORAPPS#${status}` },
      Limit: limit,
      ScanIndexForward: true,
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
    }),
  );
  return {
    items: (res.Items ?? []).map((i) => stripKeys(i) as VendorApplication),
    ...(res.LastEvaluatedKey ? { lastKey: res.LastEvaluatedKey } : {}),
  };
}

export async function getVendor(id: string): Promise<Vendor | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: keys.vendor(id) }));
  return res.Item ? (stripKeys(res.Item) as Vendor) : undefined;
}

export async function putVendor(v: Vendor): Promise<void> {
  await putItem({ ...keys.vendorIndex(v), ...v });
}

export async function putVendorMember(m: VendorMember): Promise<void> {
  await putItem({ ...keys.vendorMember(m.vendorId, m.userId), ...m });
}

/** The vendor a user belongs to (one at launch), via GSI1 USER#sub → VENDOR#id. */
export async function getVendorForUser(sub: string): Promise<Vendor | undefined> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': 'VENDOR#' },
      Limit: 1,
    }),
  );
  const m = res.Items?.[0] as VendorMember | undefined;
  return m ? getVendor(m.vendorId) : undefined;
}

export async function updateVendor(
  id: string,
  patch: Partial<Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  const sets: string[] = ['#u = :u'];
  const names: Record<string, string> = { '#u': 'updatedAt' };
  const values: Record<string, unknown> = { ':u': new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`#${k} = :${k}`);
    names[`#${k}`] = k;
    values[`:${k}`] = v;
  }
  // Keep the vendor list index (GSI1 VENDORS#status / name) in step with the record.
  if (patch.status) {
    sets.push('GSI1PK = :gsi1pk');
    values[':gsi1pk'] = `VENDORS#${patch.status}`;
  }
  if (patch.businessName) {
    sets.push('GSI1SK = :gsi1sk');
    values[':gsi1sk'] = patch.businessName.toLowerCase();
  }
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: keys.vendor(id),
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export const listPriceWindows = (eventId: string) =>
  listEventPrefix<PriceWindow>(eventId, 'PRICE#');

export async function getOrder(id: string): Promise<Order | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: keys.order(id) }));
  return res.Item ? (stripKeys(res.Item) as Order) : undefined;
}

export async function getOrderByShopifyId(shopifyOrderId: string): Promise<Order | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: keys.shopifyOrder(shopifyOrderId) }),
  );
  const orderId = res.Item?.orderId as string | undefined;
  return orderId ? getOrder(orderId) : undefined;
}

/** Orders owned by a vendor (GSI1), newest event first. */
export async function listOrdersForOwner(ownerId: string): Promise<Order[]> {
  const items = await queryAll({
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
    ExpressionAttributeValues: { ':pk': `OWNER#${ownerId}`, ':sk': 'ORDER#' },
    ScanIndexForward: false,
  });
  return items.map((i) => stripKeys(i) as Order);
}

export interface OrderPage {
  items: Order[];
  lastKey?: Record<string, unknown>;
}

export async function listOrdersByStatus(
  status: Order['status'],
  limit: number,
  cursor?: Record<string, unknown>,
): Promise<OrderPage> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `ORDERS#${status}` },
      Limit: limit,
      ScanIndexForward: false,
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
    }),
  );
  return {
    items: (res.Items ?? []).map((i) => stripKeys(i) as Order),
    ...(res.LastEvaluatedKey ? { lastKey: res.LastEvaluatedKey } : {}),
  };
}

/** Orders for one event via the EVENT#id/ORDER# pointers, then a batch get. */
export async function listOrdersForEvent(
  eventId: string,
  limit: number,
  cursor?: Record<string, unknown>,
): Promise<OrderPage> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `EVENT#${eventId}`, ':sk': 'ORDER#' },
      Limit: limit,
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
    }),
  );
  const ids = (res.Items ?? []).map((i) => String(i.orderId));
  const orders = await batchGetOrders(ids);
  return { items: orders, ...(res.LastEvaluatedKey ? { lastKey: res.LastEvaluatedKey } : {}) };
}

export async function batchGetOrders(ids: string[]): Promise<Order[]> {
  const out: Order[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    if (!chunk.length) continue;
    const res = await ddb.send(
      new BatchGetCommand({
        RequestItems: { [TABLE]: { Keys: chunk.map((id) => keys.order(id)) } },
      }),
    );
    for (const it of res.Responses?.[TABLE] ?? []) out.push(stripKeys(it) as Order);
  }
  const rank = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

/** Monotonic so two history rows written in the same millisecond keep their order. */
const historyId = monotonicFactory();

export async function putOrderHistory(h: OrderHistoryEntry): Promise<void> {
  await putItem({ ...keys.orderHistory(h.orderId, h.at, historyId()), ...h });
}

/** Hold items for one hold id, scoped to the vendor (GSI1 VENDOR#id / HOLD#holdId). */
export async function getHoldItems(vendorId: string, holdId: string): Promise<HoldItem[]> {
  const items = await queryAll({
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
    ExpressionAttributeValues: { ':pk': `VENDOR#${vendorId}`, ':sk': `HOLD#${holdId}` },
  });
  return items as unknown as HoldItem[];
}

/** All active hold items a vendor has on an event. */
export async function listVendorHolds(vendorId: string, eventId: string): Promise<HoldItem[]> {
  const items = await queryAll({
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
    ExpressionAttributeValues: { ':pk': `VENDOR#${vendorId}`, ':sk': 'HOLD#' },
  });
  return (items as unknown as HoldItem[]).filter((h) => h.eventId === eventId);
}

export async function deleteItem(key: Keys): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: key.PK, SK: key.SK } }));
}

/** Drop the table's key attributes from a stored item. */
export function stripKeys<T>(item: Record<string, unknown>): T {
  const {
    PK: _pk,
    SK: _sk,
    GSI1PK: _a,
    GSI1SK: _b,
    GSI2PK: _c,
    GSI2SK: _d,
    ttl: _t,
    ...rest
  } = item;
  return rest as T;
}

export type { Role };
