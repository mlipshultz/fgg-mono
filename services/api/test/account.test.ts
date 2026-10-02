/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { AdminUserList, AdminUserRow, Dashboard, Me, SavedEventIds } from '@fgg/types';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { EVENT_ID, event, parse, req as baseReq, venue } from './fixtures.js';

process.env.TABLE_NAME = 'fgg-test';
process.env.MEDIA_BASE_URL = 'https://media.test';
process.env.WEB_ORIGINS = 'http://localhost:3000';
process.env.USER_POOL_ID = 'us-east-1_test';

const ddb = mockClient(DynamoDBDocumentClient);
const cognito = mockClient(CognitoIdentityProviderClient);
const { handler } = await import('../src/handlers/account.js');
const { clearVenueCache } = await import('../src/lib/events.js');
const { keys } = await import('../src/lib/db.js');

const SUB = '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';
const ADMIN = '9f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';

function authed(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  claims: Record<string, unknown>,
  body?: unknown,
  query?: Record<string, string>,
): APIGatewayProxyEventV2 {
  const r = baseReq(method as any, path, { body, ...(query ? { query } : {}) }) as any;
  r.requestContext.authorizer = { jwt: { claims, scopes: [] } };
  return r;
}

const user = {
  ...keys.user(SUB),
  sub: SUB,
  email: 'maya@example.com',
  displayName: 'Maya',
  birthYear: 2010,
  roles: ['attendee'],
  memberSince: '2026-04-01T00:00:00Z',
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
};
const claims = { sub: SUB, email: 'maya@example.com', 'cognito:groups': ['attendee'] };
const storedEvent = { ...keys.eventIndex(event), ...event };

beforeEach(() => {
  ddb.reset();
  cognito.reset();
  clearVenueCache();
  ddb.on(GetCommand).callsFake((input: any) => {
    const k = input.Key;
    if (k.PK === `USER#${SUB}` && k.SK === 'META') return { Item: user };
    if (k.PK === `EVENT#${EVENT_ID}` && k.SK === 'META') return { Item: storedEvent };
    if (k.PK === `VENUE#${venue.id}` && k.SK === 'META') return { Item: venue };
    if (k.SK === 'FLOORPLAN') return { Item: undefined };
    return { Item: undefined };
  });
  ddb.on(QueryCommand).callsFake((input: any) => {
    const v = input.ExpressionAttributeValues ?? {};
    if (v[':pk'] === `USER#${SUB}` && !v[':sk'])
      return {
        Items: [
          user,
          { PK: `USER#${SUB}`, SK: 'STATS', xp: 2500, checkins: 6, fests: 6 },
          {
            PK: `USER#${SUB}`,
            SK: 'BADGE#first-fest',
            badgeId: 'first-fest',
            awardedAt: '2026-04-25T00:00:00Z',
          },
          {
            PK: `USER#${SUB}`,
            SK: `SAVED#${EVENT_ID}`,
            eventId: EVENT_ID,
            savedAt: '2026-09-01T00:00:00Z',
          },
        ],
      };
    if (v[':pk'] === `USER#${SUB}` && v[':sk'] === 'SAVED#')
      return { Items: [{ eventId: EVENT_ID }] };
    if (v[':pk'] === `EVENT#${EVENT_ID}`) return { Items: [] };
    return { Items: [] };
  });
  ddb.on(PutCommand).resolves({});
  ddb.on(DeleteCommand).resolves({});
  ddb.on(UpdateCommand).callsFake((input: any) => ({
    Attributes: {
      ...user,
      ...Object.fromEntries(
        Object.entries(input.ExpressionAttributeValues).map(([k, v]) => [
          input.ExpressionAttributeNames[`#${k.slice(1)}`] ?? k.slice(1),
          v,
        ]),
      ),
    },
  }));
  cognito.on(AdminAddUserToGroupCommand).resolves({});
  cognito.on(AdminRemoveUserFromGroupCommand).resolves({});
});

describe('GET /me', () => {
  it('returns the caller and 401 without claims', async () => {
    const res = parse(await handler(authed('GET', '/me', claims)));
    expect(res.status).toBe(200);
    expect(Me.safeParse(res.body).success).toBe(true);
    expect(res.body.displayName).toBe('Maya');
    const anon = parse(await handler(baseReq('GET', '/me')));
    expect(anon.status).toBe(401);
  });
  it('creates the record lazily when the trigger missed it', async () => {
    ddb.on(GetCommand).resolvesOnce({ Item: undefined }).resolves({ Item: user });
    const res = parse(await handler(authed('GET', '/me', { ...claims, name: 'Maya J' })));
    expect(res.status).toBe(200);
    const puts = ddb.commandCalls(PutCommand);
    expect(puts.length).toBe(1);
    expect(puts[0]!.args[0].input.ConditionExpression).toBe('attribute_not_exists(PK)');
  });
  it('prefers roles from the token', async () => {
    const res = parse(
      await handler(authed('GET', '/me', { ...claims, 'cognito:groups': 'staff' })),
    );
    expect(res.body.roles).toEqual(['staff']);
  });
});

describe('PATCH /me', () => {
  it('validates and updates the display name', async () => {
    const bad = parse(await handler(authed('PATCH', '/me', claims, { displayName: '' })));
    expect(bad.status).toBe(400);
    const ok = parse(await handler(authed('PATCH', '/me', claims, { displayName: '  Maya J ' })));
    expect(ok.status).toBe(200);
    expect(ok.body.displayName).toBe('Maya J');
  });
});

describe('GET /me/dashboard', () => {
  it('assembles progress, badges and saved upcoming events', async () => {
    const res = parse(await handler(authed('GET', '/me/dashboard', claims)));
    expect(res.status).toBe(200);
    const parsed = Dashboard.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(res.body.progress).toMatchObject({ level: 7, title: 'Trader', xp: 2500, nextLevel: 8 });
    expect(res.body.stats).toMatchObject({ fests: 6, badgesEarned: 1 });
    expect(res.body.badges.find((b: any) => b.id === 'first-fest')).toMatchObject({
      earned: true,
      awardedAt: '2026-04-25T00:00:00Z',
    });
    expect(res.body.badges.find((b: any) => b.id === 'level-10').earned).toBe(false);
    expect(res.body.savedEvents.map((e: any) => e.slug)).toEqual(['halloween-fest-2026']);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('saved events', () => {
  it('lists, adds and removes', async () => {
    const list = parse(await handler(authed('GET', '/me/saved', claims)));
    expect(SavedEventIds.safeParse(list.body).success).toBe(true);
    expect(list.body.eventIds).toEqual([EVENT_ID]);

    const put = parse(await handler(authed('PUT', `/me/saved/${EVENT_ID}`, claims)));
    expect(put.status).toBe(200);
    const saved = ddb
      .commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item?.SK === `SAVED#${EVENT_ID}`);
    expect(saved).toBeDefined();

    const missing = parse(
      await handler(authed('PUT', '/me/saved/01HZX3V9K7Q2M4N8P6R5T1W0ZZ', claims)),
    );
    expect(missing.status).toBe(404);

    const del = parse(await handler(authed('DELETE', `/me/saved/${EVENT_ID}`, claims)));
    expect(del.status).toBe(200);
    expect(ddb.commandCalls(DeleteCommand).length).toBe(1);
  });
});

describe('admin users', () => {
  const staff = { sub: ADMIN, email: 'staff@example.com', 'cognito:groups': ['staff'] };
  const superadmin = { ...staff, 'cognito:groups': ['superadmin'] };

  it('requires staff and pages or looks up by email', async () => {
    expect(parse(await handler(authed('GET', '/admin/users', claims))).status).toBe(403);
    ddb.on(QueryCommand).callsFake((input: any) => {
      const v = input.ExpressionAttributeValues ?? {};
      if (input.IndexName === 'GSI1' && v[':pk'] === 'EMAIL#maya@example.com')
        return { Items: [user] };
      if (input.IndexName === 'GSI2') return { Items: v[':pk'] === 'USERS#3' ? [user] : [] };
      return { Items: [] };
    });
    const byEmail = parse(
      await handler(authed('GET', '/admin/users', staff, undefined, { q: 'Maya@example.com' })),
    );
    expect(byEmail.status).toBe(200);
    expect(AdminUserList.safeParse(byEmail.body).success).toBe(true);
    expect(byEmail.body.items).toHaveLength(1);
    const page = parse(
      await handler(authed('GET', '/admin/users', staff, undefined, { limit: '50' })),
    );
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.nextCursor).toBeUndefined();
    expect(
      ddb.commandCalls(QueryCommand).filter((c) => c.args[0].input.IndexName === 'GSI2').length,
    ).toBe(10);
  });

  it('lets only superadmin change roles and syncs Cognito groups', async () => {
    const denied = parse(
      await handler(authed('PUT', `/admin/users/${SUB}/roles`, staff, { roles: ['vendor'] })),
    );
    expect(denied.status).toBe(403);
    const res = parse(
      await handler(
        authed('PUT', `/admin/users/${SUB}/roles`, superadmin, { roles: ['vendor', 'staff'] }),
      ),
    );
    expect(res.status).toBe(200);
    expect(AdminUserRow.safeParse(res.body).success).toBe(true);
    expect(res.body.roles).toEqual(['vendor', 'staff']);
    const adds = cognito
      .commandCalls(AdminAddUserToGroupCommand)
      .map((c) => c.args[0].input.GroupName)
      .sort();
    const removes = cognito
      .commandCalls(AdminRemoveUserFromGroupCommand)
      .map((c) => c.args[0].input.GroupName);
    expect(adds).toEqual(['staff', 'vendor']);
    expect(removes).toEqual(['attendee']);
    const self = parse(
      await handler(authed('PUT', `/admin/users/${ADMIN}/roles`, superadmin, { roles: ['staff'] })),
    );
    expect(self.status).toBe(400);
  });
});
