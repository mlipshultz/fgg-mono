import {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { DEFAULT_BADGES, levelFromXp } from '@fgg/game';
import { ulid } from 'ulid';
import {
  CompOrderInput,
  RefundInput,
  ReviewInput,
  SetRolesInput,
  UpdateMeInput,
  VendorApplicationInput,
  type AdminOrderList,
  type AdminUserList,
  type AdminUserRow,
  type BadgeStatus,
  type Dashboard,
  type Me,
  type Order,
  type Role,
  type SavedEventIds,
  type User,
  type VendorApplication,
  type VendorApplicationList,
  type VendorStanding,
} from '@fgg/types';
import { claimsFrom, contactFor, type Actor } from '../lib/auth.js';
import {
  createUserIfMissing,
  getEvent,
  getFloorPlan,
  getOrder,
  getSettings,
  getUser,
  getUserByEmail,
  getVendor,
  getVendorApplication,
  getVendorForUser,
  listOrdersByStatus,
  listOrdersForEvent,
  listSavedEventIds,
  listUserItems,
  listUsers,
  listVendorApplications,
  putVendorApplication,
  saveEvent,
  unsaveEvent,
  updateUser,
} from '../lib/db.js';
import {
  closeOrder,
  finalizePaidOrder,
  history,
  toVendorOrder,
  writeOrder,
} from '../lib/booking.js';
import { addToGroup } from '../lib/cognito.js';
import { venueFor } from '../lib/events.js';
import { shopify } from '../lib/shopify.js';
import { approve, reject } from '../lib/vendor-approval.js';
import { todayIso, toPublicEvents } from '../lib/events.js';
import { HttpError, Router, json, parseBody, type Req } from '../lib/http.js';
import { mediaUrl } from '../lib/media.js';
import { assignableRoles, require as requireCan } from '../lib/permissions.js';

const USER_POOL_ID = process.env.USER_POOL_ID ?? '';
const cognito = new CognitoIdentityProviderClient({});

export function toMe(u: User): Me {
  return {
    sub: u.sub,
    email: u.email,
    displayName: u.displayName,
    roles: u.roles,
    ...(u.vendorId ? { vendorId: u.vendorId } : {}),
    memberSince: u.memberSince,
  };
}

function toAdminRow(u: User): AdminUserRow {
  return {
    sub: u.sub,
    email: u.email,
    displayName: u.displayName,
    roles: u.roles,
    ...(u.vendorId ? { vendorId: u.vendorId } : {}),
    memberSince: u.memberSince,
  };
}

export function displayNameFor(name: string | undefined, email: string | undefined): string {
  const n = name?.trim();
  if (n) return n.slice(0, 60);
  const local = (email ?? '').split('@')[0] ?? '';
  return (local || 'FGG Fan').slice(0, 60);
}

/** The caller's USER record, created lazily if the post-confirmation trigger missed it. */
async function ensureUser(actor: Actor): Promise<User> {
  const existing = await getUser(actor.sub);
  if (existing) {
    // Groups can change outside the API (admin console, CLI); keep the stored copy in step so
    // admin listings, which read the record, agree with the token.
    if (actor.roles.length && !sameRoles(existing.roles, actor.roles)) {
      try {
        return await updateUser(actor.sub, { roles: actor.roles });
      } catch (err) {
        console.warn('role write-back failed', err);
        return { ...existing, roles: actor.roles };
      }
    }
    return existing;
  }
  const now = new Date().toISOString();
  const user: User = {
    sub: actor.sub,
    email: actor.email ?? `${actor.sub}@unknown.invalid`,
    displayName: displayNameFor(actor.name, actor.email),
    birthYear: 1900,
    roles: actor.roles.length ? actor.roles : ['attendee'],
    memberSince: now,
    createdAt: now,
    updatedAt: now,
  };
  await createUserIfMissing(user);
  return (await getUser(actor.sub)) ?? user;
}

function sameRoles(a: readonly Role[], b: readonly Role[]): boolean {
  return a.length === b.length && a.every((r) => b.includes(r));
}

/** Roles from the token win over the stored copy, so group changes show up immediately. */
function withTokenRoles(user: User, actor: Actor): User {
  return actor.roles.length ? { ...user, roles: actor.roles } : user;
}

const encodeCursor = (c: unknown) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor<T>(c: string | undefined): T | undefined {
  if (!c) return undefined;
  try {
    return JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as T;
  } catch {
    throw new HttpError(400, 'bad_cursor', 'Invalid cursor');
  }
}

const router = new Router()
  .add('GET', '/me', async (req) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'read_own', actor.sub);
    const user = withTokenRoles(await ensureUser(actor), actor);
    return json(req, toMe(user));
  })
  .add('PATCH', '/me', async (req) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'update_own', actor.sub);
    const input = parseBody(req, UpdateMeInput);
    await ensureUser(actor);
    const user = await updateUser(actor.sub, { displayName: input.displayName.trim() });
    return json(req, toMe(withTokenRoles(user, actor)));
  })
  .add('GET', '/me/dashboard', async (req) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'read_own', actor.sub);
    await ensureUser(actor);
    const { user, stats, badges: earnedRows, saved } = await listUserItems(actor.sub);
    if (!user) throw new HttpError(500, 'user_missing', 'User record missing');
    const me = toMe(withTokenRoles(user, actor));
    const earned = new Map(earnedRows.map((b) => [b.badgeId, b.awardedAt]));
    const badges: BadgeStatus[] = [...DEFAULT_BADGES]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((b) => {
        const awardedAt = earned.get(b.id);
        return {
          id: b.id,
          title: b.title,
          description: b.description,
          ...(b.artKey ? { artUrl: mediaUrl(b.artKey) } : {}),
          earned: awardedAt !== undefined,
          ...(awardedAt ? { awardedAt } : {}),
        };
      });
    const today = todayIso();
    const savedEvents = (await Promise.all(saved.map((s) => getEvent(s.eventId)))).filter(
      (ev): ev is NonNullable<typeof ev> => !!ev && ev.published,
    );
    const upcoming = savedEvents
      .filter(
        (ev) =>
          [...ev.days]
            .map((d) => d.date)
            .sort()
            .at(-1)! >= today,
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const body: Dashboard = {
      me,
      progress: levelFromXp(stats.xp),
      stats: {
        fests: stats.fests,
        badgesEarned: badges.filter((b) => b.earned).length,
        badgesTotal: badges.length,
        memberSince: me.memberSince,
      },
      badges,
      savedEvents: await toPublicEvents(upcoming),
    };
    return json(req, body, 200, { 'cache-control': 'no-store' });
  })
  .add('GET', '/me/saved', async (req) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'save_events', actor.sub);
    const body: SavedEventIds = { eventIds: await listSavedEventIds(actor.sub) };
    return json(req, body, 200, { 'cache-control': 'no-store' });
  })
  .add('PUT', '/me/saved/{eventId}', async (req, { eventId }) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'save_events', actor.sub);
    const ev = await getEvent(eventId!);
    if (!ev || !ev.published) throw new HttpError(404, 'event_not_found', 'Event not found');
    await ensureUser(actor);
    await saveEvent(actor.sub, ev.id);
    return json(req, { ok: true });
  })
  .add('DELETE', '/me/saved/{eventId}', async (req, { eventId }) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'save_events', actor.sub);
    await unsaveEvent(actor.sub, eventId!);
    return json(req, { ok: true });
  })
  .add('GET', '/admin/users', async (req) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'admin_read_users');
    const q = req.queryStringParameters ?? {};
    if (q.q) {
      const u = await getUserByEmail(q.q);
      const body: AdminUserList = { items: u ? [toAdminRow(u)] : [] };
      return json(req, body, 200, { 'cache-control': 'no-store' });
    }
    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
    const page = await listUsers(limit, decodeCursor(q.cursor));
    const body: AdminUserList = {
      items: page.users.map(toAdminRow),
      ...(page.next ? { nextCursor: encodeCursor(page.next) } : {}),
    };
    return json(req, body, 200, { 'cache-control': 'no-store' });
  })
  .add('PUT', '/admin/users/{sub}/roles', async (req, { sub }) => {
    const actor = claimsFrom(req);
    const input = parseBody(req, SetRolesInput);
    const roles = assignableRoles(actor, sub!, input.roles);
    const target = await getUser(sub!);
    if (!target) throw new HttpError(404, 'user_not_found', 'User not found');
    const current = new Set<Role>(target.roles);
    const wanted = new Set<Role>(roles);
    for (const r of wanted) {
      if (current.has(r)) continue;
      await cognito.send(
        new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: sub, GroupName: r }),
      );
    }
    for (const r of current) {
      if (wanted.has(r)) continue;
      await cognito.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: sub,
          GroupName: r,
        }),
      );
    }
    const updated = await updateUser(sub!, { roles });
    return json(req, toAdminRow(updated));
  });

// ---------------------------------------------------------------------------
// Phase 3: vendor applications, admin review, admin orders
// ---------------------------------------------------------------------------

const APP_STATUSES = ['submitted', 'call_scheduled', 'approved', 'rejected'] as const;
const ORDER_STATUSES = ['pending_payment', 'paid', 'refunded', 'cancelled', 'conflict'] as const;

async function loadApplication(id: string): Promise<VendorApplication> {
  // Applications are keyed by user; the id is the ULID inside. Look through the open queues.
  for (const status of APP_STATUSES) {
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await listVendorApplications(status, 100, cursor);
      const hit = page.items.find((a) => a.id === id);
      if (hit) return hit;
      cursor = page.lastKey;
    } while (cursor);
  }
  throw new HttpError(404, 'application_not_found', 'Application not found');
}

async function adminOrderView(order: Order) {
  const ev = await getEvent(order.eventId);
  const venue = ev ? await venueFor(ev.venueId) : undefined;
  if (!ev || !venue) throw new HttpError(500, 'event_missing', 'Event missing for order');
  return toVendorOrder(order, ev, venue);
}

router
  .add('GET', '/me/vendor-application', async (req) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'read_own', actor.sub);
    const [application, vendor, settings] = await Promise.all([
      getVendorApplication(actor.sub),
      getVendorForUser(actor.sub),
      getSettings(),
    ]);
    const body: VendorStanding = {
      application: application ?? null,
      vendor: vendor ?? null,
      ...(settings.calendlyUrl ? { calendlyUrl: settings.calendlyUrl } : {}),
      approvalMode: settings.vendorApprovalMode,
    };
    return json(req, body, 200, { 'cache-control': 'no-store' });
  })
  .add('POST', '/me/vendor-application', async (req) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'update_own', actor.sub);
    const input = parseBody(req, VendorApplicationInput);
    const user = await ensureUser(actor);
    if (await getVendorForUser(actor.sub)) {
      throw new HttpError(409, 'already_vendor', 'You are already an approved vendor');
    }
    const existing = await getVendorApplication(actor.sub);
    if (existing && (existing.status === 'submitted' || existing.status === 'call_scheduled')) {
      throw new HttpError(409, 'application_pending', 'Your application is already under review');
    }
    const settings = await getSettings();
    const now = new Date().toISOString();
    const application: VendorApplication = {
      ...input,
      ...contactFor(actor, user),
      sells: input.sells ?? [],
      id: ulid(),
      userId: actor.sub,
      status: 'submitted',
      termsAcceptedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await putVendorApplication(application);
    if (settings.vendorApprovalMode === 'auto_video_terms') {
      const { application: approved } = await approve(application, 'system');
      return json(req, approved, 201);
    }
    try {
      await addToGroup(actor.sub, 'vendor_applicant');
      await updateUser(actor.sub, {
        roles: [...new Set([...actor.roles, 'vendor_applicant' as Role])],
      });
    } catch (err) {
      console.warn('vendor_applicant group add failed', err);
    }
    return json(req, application, 201);
  })
  .add('GET', '/admin/vendor-applications', async (req) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'review_vendor_applications');
    const q = req.queryStringParameters ?? {};
    const status = (APP_STATUSES as readonly string[]).includes(q.status ?? '')
      ? (q.status as VendorApplication['status'])
      : 'submitted';
    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
    const page = await listVendorApplications(status, limit, decodeCursor(q.cursor));
    const body: VendorApplicationList = {
      items: page.items,
      ...(page.lastKey ? { nextCursor: encodeCursor(page.lastKey) } : {}),
    };
    return json(req, body, 200, { 'cache-control': 'no-store' });
  })
  .add('POST', '/admin/vendor-applications/{id}/call-scheduled', async (req, { id }) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'review_vendor_applications');
    const app = await loadApplication(id!);
    if (app.status !== 'submitted')
      throw new HttpError(409, 'bad_status', `Application is ${app.status}`);
    const now = new Date().toISOString();
    const next: VendorApplication = {
      ...app,
      status: 'call_scheduled',
      callScheduledAt: now,
      callScheduledVia: 'staff',
      updatedAt: now,
    };
    await putVendorApplication(next);
    return json(req, next);
  })
  .add('POST', '/admin/vendor-applications/{id}/approve', async (req, { id }) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'review_vendor_applications');
    const input = parseBody(req, ReviewInput);
    const app = await loadApplication(id!);
    const { vendor } = await approve(app, actor.sub, input.notes);
    return json(req, vendor);
  })
  .add('POST', '/admin/vendor-applications/{id}/reject', async (req, { id }) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'review_vendor_applications');
    const input = parseBody(req, ReviewInput);
    const app = await loadApplication(id!);
    return json(req, await reject(app, actor.sub, input.notes));
  })
  .add('GET', '/admin/orders', async (req) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'manage_events');
    const q = req.queryStringParameters ?? {};
    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
    const cursor = decodeCursor<Record<string, unknown>>(q.cursor);
    let page;
    if (q.status && (ORDER_STATUSES as readonly string[]).includes(q.status)) {
      page = await listOrdersByStatus(q.status as Order['status'], limit, cursor);
      if (q.eventId) page.items = page.items.filter((o) => o.eventId === q.eventId);
    } else if (q.eventId) {
      page = await listOrdersForEvent(q.eventId, limit, cursor);
    } else {
      page = await listOrdersByStatus('paid', limit, cursor);
    }
    const body: AdminOrderList = {
      items: await Promise.all(page.items.map(adminOrderView)),
      ...(page.lastKey ? { nextCursor: encodeCursor(page.lastKey) } : {}),
    };
    return json(req, body, 200, { 'cache-control': 'no-store' });
  })
  .add('POST', '/admin/orders/{id}/refund', async (req, { id }) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'admin_refunds');
    const input = parseBody(req, RefundInput);
    const order = await getOrder(id!);
    if (!order) throw new HttpError(404, 'order_not_found', 'Order not found');
    const ev = await getEvent(order.eventId);
    if (!ev) throw new HttpError(500, 'event_missing', 'Event missing');
    if (order.status === 'paid' && order.source === 'shopify' && order.shopifyOrderId) {
      await shopify().refundOrder(
        order.shopifyOrderId,
        order.totalCents,
        input.reason ?? 'Refunded by FGG staff',
      );
      const next = await closeOrder(order, ev, ev.startsAt, 'refunded', actor.sub, input.reason);
      return json(req, await adminOrderView(next));
    }
    if (order.status === 'paid' || order.status === 'pending_payment') {
      const next = await closeOrder(order, ev, ev.startsAt, 'cancelled', actor.sub, input.reason);
      return json(req, await adminOrderView(next));
    }
    throw new HttpError(409, 'bad_status', `Order is already ${order.status}`);
  })
  .add('POST', '/admin/orders/comp', async (req) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'manage_events');
    const input = parseBody(req, CompOrderInput);
    const [ev, vendor] = await Promise.all([getEvent(input.eventId), getVendor(input.vendorId)]);
    if (!ev) throw new HttpError(404, 'event_not_found', 'Event not found');
    if (!vendor) throw new HttpError(404, 'vendor_not_found', 'Vendor not found');
    const plan = await getFloorPlan(ev.venueId);
    if (!plan?.tables.some((t) => t.id === input.tableId)) {
      throw new HttpError(404, 'table_not_found', 'Table is not on the floor plan');
    }
    const eventDates = new Set(ev.days.map((d) => d.date));
    for (const d of input.dates) {
      if (!eventDates.has(d))
        throw new HttpError(400, 'bad_date', `${d} is not a day of this event`);
    }
    const now = new Date().toISOString();
    const order: Order = {
      id: ulid(),
      eventId: ev.id,
      kind: 'vendor_table',
      source: 'manual',
      ownerId: vendor.id,
      placedBy: actor.sub,
      status: 'pending_payment',
      lines: [
        {
          type: 'table',
          tableId: input.tableId,
          dates: [...input.dates].sort(),
          rate: 'standard',
          unitCents: 0,
          lineCents: 0,
        },
      ],
      subtotalCents: 0,
      feeCents: 0,
      taxCents: 0,
      totalCents: 0,
      vendorInfo: {
        tableName: vendor.businessName,
        contactName: vendor.contactName,
        phone: vendor.phone,
        email: vendor.email,
        ...(vendor.sellsDescription ? { sellsDescription: vendor.sellsDescription } : {}),
        codeOfConductAccepted: true,
      },
      createdAt: now,
      updatedAt: now,
    };
    await writeOrder(order, ev.startsAt);
    await history(order.id, 'pending_payment', actor.sub, undefined, `comp: ${input.note ?? ''}`);
    try {
      const paid = await finalizePaidOrder({
        order,
        event: ev,
        startsAt: ev.startsAt,
        by: actor.sub,
      });
      return json(req, await adminOrderView(paid), 201);
    } catch {
      await closeOrder(order, ev, ev.startsAt, 'cancelled', actor.sub, 'comp failed: table taken');
      throw new HttpError(
        409,
        'table_unavailable',
        'That table is already booked on one of those days',
      );
    }
  })
  .add('POST', '/admin/shopify/register-webhooks', async (req) => {
    const actor = claimsFrom(req);
    requireCan(actor, 'admin_settings');
    const callbackUrl = `https://${req.requestContext.domainName}/webhooks/shopify`;
    const result = await shopify().registerWebhooks(callbackUrl, ['ORDERS_PAID', 'REFUNDS_CREATE']);
    return json(req, { callbackUrl, ...result });
  });

export const handler = (req: Req) => router.handle(req);
