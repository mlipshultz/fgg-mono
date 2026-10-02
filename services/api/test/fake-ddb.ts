/* eslint-disable @typescript-eslint/no-explicit-any */
import { mockClient } from 'aws-sdk-client-mock';
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

type Item = Record<string, any>;

class ConditionalCheckFailedException extends Error {
  override name = 'ConditionalCheckFailedException';
}
class TransactionCanceledException extends Error {
  override name = 'TransactionCanceledException';
}

/**
 * Just enough DynamoDB to exercise the booking transactions: single table keyed by PK/SK,
 * GSI1/GSI2 equality + begins_with queries, the few condition expressions the code uses,
 * ADD/SET updates, and all-or-nothing TransactWrite.
 */
export class FakeDdb {
  items = new Map<string, Item>();
  readonly mock = mockClient(DynamoDBDocumentClient);

  constructor() {
    this.install();
  }

  key(pk: string, sk: string) {
    return `${pk}\u0000${sk}`;
  }
  put(item: Item) {
    this.items.set(this.key(item.PK, item.SK), structuredClone(item));
  }
  get(pk: string, sk: string): Item | undefined {
    const it = this.items.get(this.key(pk, sk));
    return it ? structuredClone(it) : undefined;
  }
  all(): Item[] {
    return [...this.items.values()].map((i) => structuredClone(i));
  }
  reset() {
    this.items.clear();
    this.mock.reset();
    this.install();
  }

  private check(existing: Item | undefined, cond: string | undefined, values: Item = {}) {
    if (!cond) return;
    if (cond === 'attribute_not_exists(PK)') {
      if (existing) throw new ConditionalCheckFailedException('exists');
      return;
    }
    if (cond === 'attribute_exists(PK)') {
      if (!existing) throw new ConditionalCheckFailedException('missing');
      return;
    }
    if (cond === 'attribute_not_exists(PK) OR orderId = :oid') {
      if (existing && existing.orderId !== values[':oid'])
        throw new ConditionalCheckFailedException('taken');
      return;
    }
    throw new Error(`fake-ddb: unsupported condition ${cond}`);
  }

  private applyUpdate(input: any): Item {
    const { PK, SK } = input.Key;
    const existing = this.get(PK, SK);
    this.check(existing, input.ConditionExpression, input.ExpressionAttributeValues);
    const item: Item = existing ?? { PK, SK };
    const names: Record<string, string> = input.ExpressionAttributeNames ?? {};
    const values: Record<string, any> = input.ExpressionAttributeValues ?? {};
    const resolve = (n: string) => names[n] ?? n;
    const expr: string = input.UpdateExpression;
    for (const clause of expr.split(/\b(?=SET|ADD|REMOVE)\b/)) {
      const [verb, ...rest] = clause.trim().split(/\s+/);
      const body = rest.join(' ');
      if (verb === 'SET') {
        for (const part of body.split(',')) {
          const [l, r] = part.split('=').map((s) => s.trim());
          item[resolve(l!)] = values[r!];
        }
      } else if (verb === 'ADD') {
        for (const part of body.split(',')) {
          const [l, r] = part.trim().split(/\s+/);
          item[resolve(l!)] = (item[resolve(l!)] ?? 0) + values[r!];
        }
      }
    }
    this.put(item);
    return item;
  }

  private query(input: any): Item[] {
    const v: Record<string, any> = input.ExpressionAttributeValues ?? {};
    const idx = input.IndexName as string | undefined;
    const pkName = idx ? `${idx}PK` : 'PK';
    const skName = idx ? `${idx}SK` : 'SK';
    const cond: string = input.KeyConditionExpression;
    const pk = v[':pk'];
    let rows = this.all().filter((i) => i[pkName] === pk);
    const bw = /begins_with\(\w+, (:\w+)\)/.exec(cond);
    const eq = new RegExp(`${skName} = (:\\w+)`).exec(cond);
    if (bw) rows = rows.filter((i) => String(i[skName] ?? '').startsWith(v[bw[1]!]));
    else if (eq) rows = rows.filter((i) => i[skName] === v[eq[1]!]);
    if (input.FilterExpression === 'featured = :t')
      rows = rows.filter((i) => i.featured === v[':t']);
    rows.sort((a, b) => String(a[skName]).localeCompare(String(b[skName])));
    if (input.ScanIndexForward === false) rows.reverse();
    if (input.Limit) rows = rows.slice(0, input.Limit);
    return rows;
  }

  private install() {
    this.mock
      .on(GetCommand)
      .callsFake((input: any) => ({ Item: this.get(input.Key.PK, input.Key.SK) }));
    this.mock.on(PutCommand).callsFake((input: any) => {
      this.check(
        this.get(input.Item.PK, input.Item.SK),
        input.ConditionExpression,
        input.ExpressionAttributeValues,
      );
      this.put(input.Item);
      return {};
    });
    this.mock.on(DeleteCommand).callsFake((input: any) => {
      this.items.delete(this.key(input.Key.PK, input.Key.SK));
      return {};
    });
    this.mock
      .on(UpdateCommand)
      .callsFake((input: any) => ({ Attributes: this.applyUpdate(input) }));
    this.mock.on(QueryCommand).callsFake((input: any) => ({ Items: this.query(input) }));
    this.mock.on(BatchGetCommand).callsFake((input: any) => {
      const table = Object.keys(input.RequestItems)[0]!;
      const keys: Item[] = input.RequestItems[table].Keys;
      return { Responses: { [table]: keys.map((k) => this.get(k.PK, k.SK)).filter(Boolean) } };
    });
    this.mock.on(TransactWriteCommand).callsFake((input: any) => {
      const snapshot = new Map(this.items);
      try {
        for (const t of input.TransactItems) {
          if (t.Put) {
            this.check(
              this.get(t.Put.Item.PK, t.Put.Item.SK),
              t.Put.ConditionExpression,
              t.Put.ExpressionAttributeValues,
            );
            this.put(t.Put.Item);
          } else if (t.Delete) {
            this.check(
              this.get(t.Delete.Key.PK, t.Delete.Key.SK),
              t.Delete.ConditionExpression,
              t.Delete.ExpressionAttributeValues,
            );
            this.items.delete(this.key(t.Delete.Key.PK, t.Delete.Key.SK));
          } else if (t.ConditionCheck) {
            this.check(
              this.get(t.ConditionCheck.Key.PK, t.ConditionCheck.Key.SK),
              t.ConditionCheck.ConditionExpression,
              t.ConditionCheck.ExpressionAttributeValues,
            );
          } else if (t.Update) {
            this.applyUpdate(t.Update);
          }
        }
      } catch (e) {
        this.items = snapshot;
        if ((e as Error).name === 'ConditionalCheckFailedException')
          throw new TransactionCanceledException('cancelled');
        throw e;
      }
      return {};
    });
  }
}
