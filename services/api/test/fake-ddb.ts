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
  constructor(readonly CancellationReasons: { Code: string }[]) {
    super(
      `Transaction cancelled, please refer cancellation reasons for specific reasons [${CancellationReasons.map((r) => r.Code).join(', ')}]`,
    );
  }
}
class ValidationException extends Error {
  override name = 'ValidationException';
}

/**
 * Just enough DynamoDB to exercise the booking transactions: single table keyed by PK/SK,
 * GSI1/GSI2 equality + begins_with queries, condition expressions (attribute_[not_]exists,
 * comparisons, AND/OR without parentheses), ADD/SET/REMOVE updates, and TransactWrite that is
 * all-or-nothing, checks every condition against the state before the transaction, reports
 * per-item CancellationReasons, and enforces the 100-item and one-operation-per-item limits.
 *
 * Every read is strongly consistent; tests reproduce stale reads by handing the code an old copy.
 */
export class FakeDdb {
  items = new Map<string, Item>();
  /** Runs once, just before the next TransactWrite: lets a test land a competing write. */
  beforeTransact: (() => void) | undefined;
  /** The next N TransactWrites fail with a TransactionConflict, as when two overlap in AWS. */
  transactConflicts = 0;
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
    this.beforeTransact = undefined;
    this.transactConflicts = 0;
    this.mock.reset();
    this.install();
  }

  /** Evaluate a condition expression: OR of ANDs of simple atoms (DynamoDB precedence). */
  private holds(
    existing: Item | undefined,
    cond: string | undefined,
    values: Item = {},
    names: Record<string, string> = {},
  ): boolean {
    if (!cond) return true;
    const attr = (n: string) => names[n] ?? n;
    const atom = (raw: string): boolean => {
      const a = raw.trim();
      let m = /^attribute_not_exists\(([#\w]+)\)$/.exec(a);
      if (m) return existing?.[attr(m[1]!)] === undefined;
      m = /^attribute_exists\(([#\w]+)\)$/.exec(a);
      if (m) return existing?.[attr(m[1]!)] !== undefined;
      m = /^([#\w]+) (=|<>|<=|>=|<|>) (:\w+)$/.exec(a);
      if (m) {
        const l = existing?.[attr(m[1]!)];
        const r = values[m[3]!];
        if (l === undefined || r === undefined) return m[2] === '<>' && l !== r;
        switch (m[2]) {
          case '=':
            return l === r;
          case '<>':
            return l !== r;
          case '<':
            return l < r;
          case '<=':
            return l <= r;
          case '>':
            return l > r;
          default:
            return l >= r;
        }
      }
      throw new Error(`fake-ddb: unsupported condition ${cond}`);
    };
    return cond.split(/\s+OR\s+/).some((d) => d.split(/\s+AND\s+/).every(atom));
  }

  private check(
    existing: Item | undefined,
    cond: string | undefined,
    values: Item = {},
    names: Record<string, string> = {},
  ) {
    if (!this.holds(existing, cond, values, names))
      throw new ConditionalCheckFailedException('The conditional request failed');
  }

  private applyUpdate(input: any, checked = false): Item {
    const { PK, SK } = input.Key;
    const existing = this.get(PK, SK);
    if (!checked)
      this.check(
        existing,
        input.ConditionExpression,
        input.ExpressionAttributeValues,
        input.ExpressionAttributeNames,
      );
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
      } else if (verb === 'REMOVE') {
        for (const part of body.split(',')) delete item[resolve(part.trim())];
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
    // Simple `attr = :value` filters (e.g. `featured = :t`, `id = :id`).
    const filter = /^(\w+) = (:\w+)$/.exec(input.FilterExpression ?? '');
    if (filter) rows = rows.filter((i) => i[filter[1]!] === v[filter[2]!]);
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
        input.ExpressionAttributeNames,
      );
      this.put(input.Item);
      return {};
    });
    this.mock.on(DeleteCommand).callsFake((input: any) => {
      this.check(
        this.get(input.Key.PK, input.Key.SK),
        input.ConditionExpression,
        input.ExpressionAttributeValues,
        input.ExpressionAttributeNames,
      );
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
      const race = this.beforeTransact;
      this.beforeTransact = undefined;
      race?.();
      const ops: any[] = input.TransactItems;
      if (ops.length > 100)
        throw new ValidationException(
          'Member must have length less than or equal to 100 (TransactItems)',
        );
      const target = (t: any) =>
        t.Put ? t.Put.Item : (t.Delete ?? t.ConditionCheck ?? t.Update).Key;
      const seen = new Set<string>();
      for (const t of ops) {
        const k = this.key(target(t).PK, target(t).SK);
        if (seen.has(k))
          throw new ValidationException(
            'Transaction request cannot include multiple operations on one item',
          );
        seen.add(k);
      }
      if (this.transactConflicts > 0) {
        this.transactConflicts--;
        throw new TransactionCanceledException(
          ops.map((_, i) => ({ Code: i === 0 ? 'TransactionConflict' : 'None' })),
        );
      }
      // Every condition is judged against the table as it was before the transaction.
      const reasons = ops.map((t) => {
        const op = t.Put ?? t.Delete ?? t.ConditionCheck ?? t.Update;
        const { PK, SK } = target(t);
        return this.holds(
          this.get(PK, SK),
          op.ConditionExpression,
          op.ExpressionAttributeValues,
          op.ExpressionAttributeNames,
        )
          ? 'None'
          : 'ConditionalCheckFailed';
      });
      if (reasons.some((r) => r !== 'None'))
        throw new TransactionCanceledException(reasons.map((Code) => ({ Code })));
      for (const t of ops) {
        if (t.Put) this.put(t.Put.Item);
        else if (t.Delete) this.items.delete(this.key(t.Delete.Key.PK, t.Delete.Key.SK));
        else if (t.Update) this.applyUpdate(t.Update, true);
      }
      return {};
    });
  }
}
