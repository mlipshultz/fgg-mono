import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { mockClient } from 'aws-sdk-client-mock';
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  authorizeUrl,
  makeState,
  verifyShopifyHmac,
  verifyState,
} from '../src/lib/shopify-oauth.js';
import { _resetShopifyConfigCache } from '../src/lib/shopify-secret.js';

const SECRET = 'shpss_test_secret';
const SHOP = 'fgg-dev.myshopify.com';

function sign(query: Record<string, string>): Record<string, string> {
  const msg = Object.keys(query)
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  return { ...query, hmac: createHmac('sha256', SECRET).update(msg).digest('hex') };
}

function req(path: string, query: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `GET ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    queryStringParameters: query,
    requestContext: {
      accountId: '1',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'GET', path, protocol: 'HTTP/1.1', sourceIp: '1.1.1.1', userAgent: 'test' },
      requestId: 'r',
      routeKey: `GET ${path}`,
      stage: '$default',
      time: '',
      timeEpoch: 0,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

describe('shopify oauth helpers', () => {
  it('verifies Shopify redirect signatures', () => {
    const q = sign({ code: 'abc', shop: SHOP, timestamp: '1700000000', state: 's' });
    expect(verifyShopifyHmac(q, SECRET)).toBe(true);
    expect(verifyShopifyHmac({ ...q, code: 'tampered' }, SECRET)).toBe(false);
    expect(verifyShopifyHmac({ ...q, hmac: 'ff' }, SECRET)).toBe(false);
    expect(verifyShopifyHmac({ shop: SHOP }, SECRET)).toBe(false);
  });

  it('round-trips the state nonce and rejects old or foreign ones', () => {
    const now = 1_700_000_000_000;
    const state = makeState(SHOP, SECRET, now);
    expect(verifyState(state, SHOP, SECRET, now + 1000)).toBe(true);
    expect(verifyState(state, 'other.myshopify.com', SECRET, now + 1000)).toBe(false);
    expect(verifyState(state, SHOP, SECRET, now + 11 * 60_000)).toBe(false);
    expect(verifyState('nope', SHOP, SECRET, now)).toBe(false);
  });

  it('builds the authorize URL with scopes and redirect', () => {
    const u = new URL(
      authorizeUrl({ shop: SHOP, clientId: 'cid', redirectUri: 'https://x/cb', state: 'st' }),
    );
    expect(u.origin + u.pathname).toBe(`https://${SHOP}/admin/oauth/authorize`);
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('scope')).toContain('write_draft_orders');
    expect(u.searchParams.get('redirect_uri')).toBe('https://x/cb');
    expect(u.searchParams.get('state')).toBe('st');
  });
});

describe('shopify install handler', () => {
  const sm = mockClient(SecretsManagerClient);
  const base = { shop: SHOP, clientId: 'cid', clientSecret: SECRET, apiVersion: '2026-07' };

  beforeEach(() => {
    sm.reset();
    _resetShopifyConfigCache();
    process.env.SHOPIFY_SECRET_ID = 'fgg/test/shopify';
    sm.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(base) });
    sm.on(PutSecretValueCommand).resolves({});
  });

  it('redirects /shopify/install to the authorize screen for the configured shop', async () => {
    const { handler } = await import('../src/handlers/shopify.js');
    const res = (await handler(req('/shopify/install'))) as {
      statusCode: number;
      headers: Record<string, string>;
    };
    expect(res.statusCode).toBe(302);
    const u = new URL(res.headers.location!);
    expect(u.host).toBe(SHOP);
    expect(u.searchParams.get('redirect_uri')).toBe('https://api.example.com/shopify/callback');
    expect(verifyState(u.searchParams.get('state') ?? '', SHOP, SECRET)).toBe(true);
  });

  it('exchanges the code and stores the token on a valid callback', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'shpat_new', scope: 'write_draft_orders' }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { handler } = await import('../src/handlers/shopify.js');
    const q = sign({ code: 'code123', shop: SHOP, timestamp: '1', state: makeState(SHOP, SECRET) });
    const res = (await handler(req('/shopify/callback', q))) as {
      statusCode: number;
      body: string;
    };
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Shopify connected');
    const put = sm.commandCalls(PutSecretValueCommand)[0]!.args[0].input;
    const stored = JSON.parse(put.SecretString as string);
    expect(stored.adminAccessToken).toBe('shpat_new');
    expect(stored.clientSecret).toBe(SECRET);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('rejects a callback with a bad signature, wrong shop, or stale state', async () => {
    const { handler } = await import('../src/handlers/shopify.js');
    const good = { code: 'c', shop: SHOP, timestamp: '1', state: makeState(SHOP, SECRET) };
    const bad1 = (await handler(req('/shopify/callback', { ...sign(good), hmac: 'ab' }))) as {
      statusCode: number;
    };
    expect(bad1.statusCode).toBe(400);
    const bad2 = (await handler(
      req('/shopify/callback', sign({ ...good, shop: 'evil.myshopify.com' })),
    )) as { statusCode: number };
    expect(bad2.statusCode).toBe(400);
    const bad3 = (await handler(
      req('/shopify/callback', sign({ ...good, state: makeState(SHOP, SECRET, 0) })),
    )) as { statusCode: number };
    expect(bad3.statusCode).toBe(400);
    expect(sm.commandCalls(PutSecretValueCommand).length).toBe(0);
  });
});
