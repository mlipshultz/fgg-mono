import { loadShopifyConfig } from './shopify-secret.js';

/** What the booking flow needs from Shopify (docs/PLAN.md §3.5). GraphQL Admin API underneath. */
export interface DraftOrderLine {
  title: string;
  cents: number;
}

export interface DraftOrderInput {
  /** One line per table (with its days in the title), plus fee/tax lines when non-zero. */
  lineItems: DraftOrderLine[];
  email: string;
  /** Stored on the draft and copied to the order as note attributes. */
  attributes: Record<string, string>;
  tags: string[];
  note?: string;
}

export interface DraftOrderResult {
  id: string;
  name: string;
  invoiceUrl: string;
}

export interface ShopifyOrderView {
  id: string;
  name: string;
  financialStatus: string;
  totalCents: number;
  email?: string;
  noteAttributes: Record<string, string>;
}

export type WebhookTopic = 'ORDERS_PAID' | 'REFUNDS_CREATE';

export interface ShopifyClient {
  createDraftOrder(input: DraftOrderInput): Promise<DraftOrderResult>;
  getOrder(id: string): Promise<ShopifyOrderView | undefined>;
  refundOrder(orderId: string, amountCents: number, note: string): Promise<{ refundId: string }>;
  registerWebhooks(
    callbackUrl: string,
    topics: WebhookTopic[],
  ): Promise<{ created: WebhookTopic[]; existing: WebhookTopic[] }>;
}

function userErrors(obj: unknown): string | undefined {
  const errs = (obj as { userErrors?: { message: string }[] } | undefined)?.userErrors;
  return errs?.length ? errs.map((e) => e.message).join('; ') : undefined;
}

/** Shopify GIDs look like gid://shopify/Order/123; keep the numeric part for storage. */
export const gidToId = (gid: string): string => gid.split('/').pop() ?? gid;
export const idToGid = (type: string, id: string): string =>
  id.startsWith('gid://') ? id : `gid://shopify/${type}/${id}`;

export class GraphqlShopifyClient implements ShopifyClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const cfg = await loadShopifyConfig();
    if (!cfg.adminAccessToken)
      throw new Error('Shopify app is not installed (no adminAccessToken)');
    const res = await this.fetchImpl(
      `https://${cfg.shop}/admin/api/${cfg.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Shopify-Access-Token': cfg.adminAccessToken,
        },
        body: JSON.stringify({ query, variables }),
      },
    );
    if (!res.ok)
      throw new Error(`Shopify GraphQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length)
      throw new Error(`Shopify GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
    if (!body.data) throw new Error('Shopify GraphQL: empty response');
    return body.data;
  }

  async createDraftOrder(input: DraftOrderInput): Promise<DraftOrderResult> {
    const attrs = Object.entries(input.attributes).map(([key, value]) => ({ key, value }));
    const data = await this.gql<{
      draftOrderCreate: {
        draftOrder?: { id: string; name: string; invoiceUrl: string };
        userErrors: { message: string }[];
      };
    }>(
      `mutation($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id name invoiceUrl }
          userErrors { field message }
        }
      }`,
      {
        input: {
          email: input.email,
          tags: input.tags,
          ...(input.note ? { note: input.note } : {}),
          customAttributes: attrs,
          taxExempt: true,
          lineItems: input.lineItems.map((li) => ({
            title: li.title,
            originalUnitPrice: (li.cents / 100).toFixed(2),
            quantity: 1,
            taxable: false,
            requiresShipping: false,
            // Underscore-prefixed line properties are hidden from checkout, emails and the
            // order status page; the order-level customAttributes above carry the real keys
            // for the webhook (note_attributes).
            customAttributes: attrs.map((a) => ({ key: `_${a.key}`, value: a.value })),
          })),
        },
      },
    );
    const err = userErrors(data.draftOrderCreate);
    if (err || !data.draftOrderCreate.draftOrder)
      throw new Error(`draftOrderCreate: ${err ?? 'no draft'}`);
    const d = data.draftOrderCreate.draftOrder;
    return { id: gidToId(d.id), name: d.name, invoiceUrl: d.invoiceUrl };
  }

  async getOrder(id: string): Promise<ShopifyOrderView | undefined> {
    const data = await this.gql<{
      order?: {
        id: string;
        name: string;
        displayFinancialStatus: string;
        email?: string;
        totalPriceSet: { shopMoney: { amount: string } };
        customAttributes: { key: string; value: string }[];
      } | null;
    }>(
      `query($id: ID!) {
        order(id: $id) {
          id name displayFinancialStatus email
          totalPriceSet { shopMoney { amount } }
          customAttributes { key value }
        }
      }`,
      { id: idToGid('Order', id) },
    );
    const o = data.order;
    if (!o) return undefined;
    return {
      id: gidToId(o.id),
      name: o.name,
      financialStatus: o.displayFinancialStatus,
      totalCents: Math.round(Number(o.totalPriceSet.shopMoney.amount) * 100),
      ...(o.email ? { email: o.email } : {}),
      noteAttributes: Object.fromEntries(o.customAttributes.map((a) => [a.key, a.value])),
    };
  }

  async refundOrder(
    orderId: string,
    amountCents: number,
    note: string,
  ): Promise<{ refundId: string }> {
    const gid = idToGid('Order', orderId);
    const data = await this.gql<{
      order?: {
        transactions: { id: string; kind: string; status: string; gateway: string }[];
      } | null;
    }>(
      `query($id: ID!) {
        order(id: $id) { transactions(first: 20) { id kind status gateway } }
      }`,
      { id: gid },
    );
    const capture = data.order?.transactions.find(
      (t) => (t.kind === 'SALE' || t.kind === 'CAPTURE') && t.status === 'SUCCESS',
    );
    if (!capture) throw new Error(`No successful capture transaction on Shopify order ${orderId}`);
    const refund = await this.gql<{
      refundCreate: { refund?: { id: string }; userErrors: { message: string }[] };
    }>(
      `mutation($input: RefundInput!) {
        refundCreate(input: $input) { refund { id } userErrors { field message } }
      }`,
      {
        input: {
          orderId: gid,
          note,
          notify: true,
          transactions: [
            {
              orderId: gid,
              parentId: capture.id,
              gateway: capture.gateway,
              kind: 'REFUND',
              amount: (amountCents / 100).toFixed(2),
            },
          ],
        },
      },
    );
    const err = userErrors(refund.refundCreate);
    if (err || !refund.refundCreate.refund) throw new Error(`refundCreate: ${err ?? 'no refund'}`);
    return { refundId: gidToId(refund.refundCreate.refund.id) };
  }

  async registerWebhooks(callbackUrl: string, topics: WebhookTopic[]) {
    const existing = await this.gql<{
      webhookSubscriptions: {
        edges: { node: { topic: string; endpoint: { callbackUrl?: string } } }[];
      };
    }>(
      `{ webhookSubscriptions(first: 50) { edges { node { topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } } }`,
    );
    const have = new Set(
      existing.webhookSubscriptions.edges
        .filter((e) => e.node.endpoint.callbackUrl === callbackUrl)
        .map((e) => e.node.topic),
    );
    const created: WebhookTopic[] = [];
    const skipped: WebhookTopic[] = [];
    for (const topic of topics) {
      if (have.has(topic)) {
        skipped.push(topic);
        continue;
      }
      const data = await this.gql<{
        webhookSubscriptionCreate: { userErrors: { message: string }[] };
      }>(
        `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { userErrors { field message } }
        }`,
        { topic, sub: { callbackUrl, format: 'JSON' } },
      );
      const err = userErrors(data.webhookSubscriptionCreate);
      if (err) throw new Error(`webhookSubscriptionCreate ${topic}: ${err}`);
      created.push(topic);
    }
    return { created, existing: skipped };
  }
}

/** In-memory client for tests and for environments without a Shopify install. */
export class FakeShopifyClient implements ShopifyClient {
  drafts: (DraftOrderInput & DraftOrderResult)[] = [];
  refunds: { orderId: string; amountCents: number; note: string }[] = [];
  webhooks: { callbackUrl: string; topic: WebhookTopic }[] = [];
  orders = new Map<string, ShopifyOrderView>();
  failRefunds = false;

  async createDraftOrder(input: DraftOrderInput): Promise<DraftOrderResult> {
    const n = this.drafts.length + 1;
    const r = {
      id: `draft-${n}`,
      name: `#D${n}`,
      invoiceUrl: `https://fgg-dev.myshopify.com/invoices/${n}`,
    };
    this.drafts.push({ ...input, ...r });
    return r;
  }
  async getOrder(id: string) {
    return this.orders.get(id);
  }
  async refundOrder(orderId: string, amountCents: number, note: string) {
    if (this.failRefunds) throw new Error('refund failed');
    this.refunds.push({ orderId, amountCents, note });
    return { refundId: `refund-${this.refunds.length}` };
  }
  async registerWebhooks(callbackUrl: string, topics: WebhookTopic[]) {
    const created: WebhookTopic[] = [];
    const existing: WebhookTopic[] = [];
    for (const topic of topics) {
      if (this.webhooks.some((w) => w.callbackUrl === callbackUrl && w.topic === topic))
        existing.push(topic);
      else {
        this.webhooks.push({ callbackUrl, topic });
        created.push(topic);
      }
    }
    return { created, existing };
  }
}

let client: ShopifyClient | undefined;
export function shopify(): ShopifyClient {
  client ??= new GraphqlShopifyClient();
  return client;
}
/** Test hook (and future: swap for a stub when no app is installed). */
export function setShopifyClient(c: ShopifyClient | undefined): void {
  client = c;
}
