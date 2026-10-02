import type { Req, Res } from '../lib/http.js';
import { Router, error } from '../lib/http.js';
import { loadShopifyConfig, saveShopifyConfig } from '../lib/shopify-secret.js';
import {
  SHOPIFY_SCOPES,
  authorizeUrl,
  exchangeCode,
  makeState,
  verifyShopifyHmac,
  verifyState,
} from '../lib/shopify-oauth.js';

/**
 * Shopify app install (docs/PLAN.md §3.5). Staff put `shop`, `clientId` and `clientSecret`
 * in the stage's secret, then open `/shopify/install`. Shopify sends the browser back to
 * `/shopify/callback`, which exchanges the code for the Admin API token and stores it in
 * the same secret. Works for the dev store and, at cutover, the real store.
 */

function html(status: number, title: string, body: string): Res {
  return {
    statusCode: status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#FFFDF7;color:#141414;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border:2px solid #141414;border-radius:22px;padding:32px;max-width:520px;box-shadow:6px 6px 0 #33EEDC}
h1{margin:0 0 8px;font-size:28px}p{margin:0;line-height:1.5}code{background:#EEEAE0;padding:2px 6px;border-radius:6px}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`,
  };
}

function callbackUrl(req: Req): string {
  return `https://${req.requestContext.domainName}/shopify/callback`;
}

export const router = new Router()
  .add('GET', '/shopify/install', async (req) => {
    const cfg = await loadShopifyConfig(true);
    const state = makeState(cfg.shop, cfg.clientSecret);
    const location = authorizeUrl({
      shop: cfg.shop,
      clientId: cfg.clientId,
      redirectUri: callbackUrl(req),
      state,
    });
    return { statusCode: 302, headers: { location, 'cache-control': 'no-store' }, body: '' };
  })
  .add('GET', '/shopify/callback', async (req) => {
    const q = req.queryStringParameters ?? {};
    const cfg = await loadShopifyConfig(true);
    if (!verifyShopifyHmac(q, cfg.clientSecret)) {
      return error(req, 'bad_signature', 'Shopify signature did not verify', 400);
    }
    if (q.shop !== cfg.shop) {
      return error(req, 'wrong_shop', `This install is configured for ${cfg.shop}`, 400);
    }
    if (!verifyState(q.state, cfg.shop, cfg.clientSecret)) {
      return error(req, 'bad_state', 'Install link expired or was not started here', 400);
    }
    if (!q.code) return error(req, 'missing_code', 'No authorization code in the callback', 400);

    const token = await exchangeCode({
      shop: cfg.shop,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      code: q.code,
    });
    await saveShopifyConfig({
      ...cfg,
      adminAccessToken: token.accessToken,
      scopes: token.scope || SHOPIFY_SCOPES.join(','),
      installedAt: new Date().toISOString(),
    });
    return html(
      200,
      'Shopify connected',
      `The FGG booking app is installed on <code>${cfg.shop}</code> and its Admin API token is stored. You can close this tab.`,
    );
  });

export const handler = (req: Req): Promise<Res> => router.handle(req);
