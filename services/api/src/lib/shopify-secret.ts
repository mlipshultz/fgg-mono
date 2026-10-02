import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';

/**
 * Shape of the Secrets Manager secret `fgg/{stage}/shopify`. Staff create it with `shop`,
 * `clientId` and `clientSecret`; the OAuth callback fills in `adminAccessToken`.
 * Webhooks are signed with `clientSecret`, so no separate webhook secret is needed.
 */
export const ShopifyConfig = z.object({
  shop: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, 'shop must be *.myshopify.com'),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  adminAccessToken: z.string().optional(),
  apiVersion: z.string().default('2026-07'),
  installedAt: z.string().optional(),
  scopes: z.string().optional(),
});
export type ShopifyConfig = z.infer<typeof ShopifyConfig>;

let client: SecretsManagerClient | undefined;
function sm(): SecretsManagerClient {
  client ??= new SecretsManagerClient({});
  return client;
}

export function secretId(): string {
  const id = process.env.SHOPIFY_SECRET_ID;
  if (!id) throw new Error('SHOPIFY_SECRET_ID is not set');
  return id;
}

let cache: { at: number; value: ShopifyConfig } | undefined;
const TTL_MS = 60_000;

export async function loadShopifyConfig(force = false): Promise<ShopifyConfig> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const res = await sm().send(new GetSecretValueCommand({ SecretId: secretId() }));
  const parsed = ShopifyConfig.parse(JSON.parse(res.SecretString ?? '{}'));
  cache = { at: Date.now(), value: parsed };
  return parsed;
}

export async function saveShopifyConfig(next: ShopifyConfig): Promise<void> {
  await sm().send(
    new PutSecretValueCommand({ SecretId: secretId(), SecretString: JSON.stringify(next) }),
  );
  cache = { at: Date.now(), value: next };
}

/** Test hook. */
export function _resetShopifyConfigCache(): void {
  cache = undefined;
}
