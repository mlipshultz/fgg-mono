import {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { DEFAULT_BADGES, levelFromXp } from '@fgg/game';
import {
  SetRolesInput,
  UpdateMeInput,
  type AdminUserList,
  type AdminUserRow,
  type BadgeStatus,
  type Dashboard,
  type Me,
  type Role,
  type SavedEventIds,
  type User,
} from '@fgg/types';
import { claimsFrom, type Actor } from '../lib/auth.js';
import {
  createUserIfMissing,
  getEvent,
  getUser,
  getUserByEmail,
  listSavedEventIds,
  listUserItems,
  listUsers,
  saveEvent,
  unsaveEvent,
  updateUser,
} from '../lib/db.js';
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

export const handler = (req: Req) => router.handle(req);
