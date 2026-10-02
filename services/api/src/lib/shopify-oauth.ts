import { createHmac, timingSafeEqual } from 'node:crypto';

/** Admin API scopes the booking flow needs (docs/PLAN.md §3.5). */
export const SHOPIFY_SCOPES = [
  'write_draft_orders',
  'read_orders',
  'write_orders',
  'read_customers',
  'write_customers',
] as const;

export function isValidShop(shop: string | undefined): shop is string {
  return !!shop && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
}

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Shopify signs OAuth redirects: every query parameter except `hmac`, sorted by key and joined
 * as `k=v&k=v`, HMAC-SHA256 with the app's client secret, hex encoded.
 */
export function verifyShopifyHmac(
  query: Record<string, string | undefined>,
  clientSecret: string,
): boolean {
  const given = query.hmac;
  if (!given) return false;
  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && query[k] !== undefined)
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  return safeEqualHex(hmacHex(clientSecret, message), given);
}

/** Stateless CSRF token: `<timestamp>.<hmac(shop|timestamp)>`. */
export function makeState(shop: string, clientSecret: string, now = Date.now()): string {
  const ts = String(now);
  return `${ts}.${hmacHex(clientSecret, `${shop}|${ts}`)}`;
}

export function verifyState(
  state: string | undefined,
  shop: string,
  clientSecret: string,
  now = Date.now(),
  maxAgeMs = 10 * 60_000,
): boolean {
  if (!state) return false;
  const [ts, sig] = state.split('.');
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (now - Number(ts) > maxAgeMs || Number(ts) > now + 60_000) return false;
  return safeEqualHex(hmacHex(clientSecret, `${shop}|${ts}`), sig);
}

export function authorizeUrl(args: {
  shop: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const u = new URL(`https://${args.shop}/admin/oauth/authorize`);
  u.searchParams.set('client_id', args.clientId);
  u.searchParams.set('scope', (args.scopes ?? SHOPIFY_SCOPES).join(','));
  u.searchParams.set('redirect_uri', args.redirectUri);
  u.searchParams.set('state', args.state);
  return u.toString();
}

export interface TokenExchange {
  accessToken: string;
  scope: string;
}

/** Exchange the one-time authorization code for a permanent Admin API access token. */
export async function exchangeCode(
  args: { shop: string; clientId: string; clientSecret: string; code: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenExchange> {
  const res = await fetchImpl(`https://${args.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shopify token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { access_token?: string; scope?: string };
  if (!body.access_token) throw new Error('Shopify token exchange returned no access_token');
  return { accessToken: body.access_token, scope: body.scope ?? '' };
}
