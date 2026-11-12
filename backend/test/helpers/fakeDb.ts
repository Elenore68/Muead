import { ddb, type Item } from "../../src/lib/db";

/**
 * Minimal in-memory stand-in for the DynamoDB DocumentClient (`ddb.send` is replaced).
 * Supports what the handler flows under test use: Get, Put, Update (returns stored item), Delete, Query
 * (base table or GSI, `X = :p` with optional `begins_with(Y, :s)` / `Y = :s`, Select COUNT), BatchGet,
 * BatchWrite and TransactWrite. Writes inside transactions are CAPTURED, not applied: tests seed state explicitly.
 * Every command is recorded so tests can assert on expressions and read consistency.
 */
export interface Sent {
  name: string;
  input: any;
}

export class FakeDb {
  store = new Map<string, Item>();
  sent: Sent[] = [];
  /** Throw a condition-failure cancellation for the next N TransactWrite calls. */
  failNextTransactions = 0;
  /**
   * Called for every TransactWrite before the failure check. Tests use it to simulate another approver's
   * decision committing between this caller's read and its write (the cancelled attempt is then retried).
   */
  onTransaction?: (attempt: number, items: any[]) => void;
  private txCount = 0;
  /** Return the first BatchWrite request as unprocessed this many times. */
  unprocessedBatchWrites = 0;
  private original = ddb.send.bind(ddb);

  install() {
    (ddb as any).send = async (cmd: any) => this.handle(cmd);
    return this;
  }
  uninstall() {
    (ddb as any).send = this.original;
  }

  put(item: Item) {
    this.store.set(`${item.PK}|${item.SK}`, structuredClone(item));
  }
  get(pk: string, sk: string) {
    return this.store.get(`${pk}|${sk}`);
  }
  commands(name: string) {
    return this.sent.filter((s) => s.name === name);
  }
  transactions() {
    return this.commands("TransactWriteCommand").map((s) => s.input.TransactItems as any[]);
  }

  private async handle(cmd: any): Promise<any> {
    const name: string = cmd.constructor.name;
    const input = cmd.input;
    this.sent.push({ name, input: structuredClone(input) });
    switch (name) {
      case "GetCommand":
        return { Item: structuredClone(this.get(input.Key.PK, input.Key.SK)) };
      case "PutCommand":
        this.put(input.Item);
        return {};
      case "UpdateCommand":
        return { Attributes: structuredClone(this.get(input.Key.PK, input.Key.SK) ?? input.Key) };
      case "DeleteCommand":
        this.store.delete(`${input.Key.PK}|${input.Key.SK}`);
        return {};
      case "QueryCommand":
        return this.query(input);
      case "BatchGetCommand": {
        const [table] = Object.keys(input.RequestItems);
        const keys = input.RequestItems[table].Keys as { PK: string; SK: string }[];
        return { Responses: { [table]: keys.map((k) => this.get(k.PK, k.SK)).filter(Boolean).map((i) => structuredClone(i)) }, UnprocessedKeys: {} };
      }
      case "BatchWriteCommand": {
        const [table] = Object.keys(input.RequestItems);
        const reqs = input.RequestItems[table] as any[];
        if (this.unprocessedBatchWrites > 0 && reqs.length) {
          this.unprocessedBatchWrites--;
          return { UnprocessedItems: { [table]: reqs } };
        }
        for (const r of reqs) {
          if (r.PutRequest) this.put(r.PutRequest.Item);
          if (r.DeleteRequest) this.store.delete(`${r.DeleteRequest.Key.PK}|${r.DeleteRequest.Key.SK}`);
        }
        return { UnprocessedItems: {} };
      }
      case "TransactWriteCommand":
        this.onTransaction?.(++this.txCount, input.TransactItems);
        if (this.failNextTransactions > 0) {
          this.failNextTransactions--;
          throw Object.assign(new Error("Transaction cancelled"), {
            name: "TransactionCanceledException",
            CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
          });
        }
        return {};
      default:
        throw new Error(`FakeDb: unsupported command ${name}`);
    }
  }

  private query(input: any) {
    const v = input.ExpressionAttributeValues ?? {};
    const kce: string = input.KeyConditionExpression;
    const pkMatch = /^(\w+) = (:\w+)/.exec(kce);
    if (!pkMatch) throw new Error(`FakeDb: unsupported key condition ${kce}`);
    const [, pkAttr, pkVal] = pkMatch;
    const begins = /begins_with\((\w+), (:\w+)\)/.exec(kce);
    const equals = / AND (\w+) = (:\w+)/.exec(kce);
    const skAttr = begins?.[1] ?? equals?.[1] ?? (pkAttr === "PK" ? "SK" : pkAttr.replace(/PK$/, "SK"));
    let items = [...this.store.values()].filter((it) => it[pkAttr] === v[pkVal]);
    if (begins) items = items.filter((it) => String(it[begins[1]] ?? "").startsWith(v[begins[2]]));
    if (equals) items = items.filter((it) => it[equals[1]] === v[equals[2]]);
    if (input.FilterExpression?.includes("#st = :a")) items = items.filter((it) => it.status === v[":a"]);
    items.sort((a, b) => String(a[skAttr]).localeCompare(String(b[skAttr])));
    if (input.ScanIndexForward === false) items.reverse();
    if (input.Select === "COUNT") return { Count: items.length };
    return { Items: items.map((i) => structuredClone(i)) };
  }
}

/* ------------------------------------------------------------------ expression lint */

/**
 * DynamoDB reserved words that collide with attribute names we use or are likely to use.
 * (Subset chosen for this codebase; the authoritative list is in the DynamoDB developer guide.)
 */
const RESERVED = new Set(
  [
    "comment", "status", "count", "name", "names", "role", "roles", "timezone", "date", "time", "timestamp", "day", "month", "year",
    "user", "users", "owner", "member", "type", "value", "values", "key", "keys", "size", "source", "state", "level", "order",
    "group", "region", "url", "text", "total", "token", "path", "item", "items", "action", "attribute", "data", "index",
    "list", "map", "number", "object", "result", "request", "response", "resource", "session", "string", "system", "table",
    "view", "zone", "archive", "backup", "lock", "limit", "location", "percent", "partition", "connection", "condition",
  ].map((w) => w.toLowerCase()),
);
const KEYWORDS = new Set(["SET", "REMOVE", "ADD", "DELETE", "AND", "OR", "NOT", "IN", "BETWEEN"]);
const FUNCTIONS = new Set(["attribute_exists", "attribute_not_exists", "attribute_type", "begins_with", "contains", "size", "if_not_exists", "list_append"]);

/** Raw (non-aliased) attribute names in an expression that are DynamoDB reserved words. */
export const reservedWordsIn = (expr: string): string[] => {
  const stripped = expr.replace(/[#:][A-Za-z0-9_]+/g, " ");
  const out: string[] = [];
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const word = m[0];
    const after = stripped.slice(m.index + word.length).trimStart();
    if (KEYWORDS.has(word)) continue;
    if (FUNCTIONS.has(word) && after.startsWith("(")) continue;
    if (RESERVED.has(word.toLowerCase())) out.push(word);
  }
  return out;
};

/** Every expression string in a command input (including the items of a transaction). */
export const expressionsOf = (input: any): string[] => {
  const parts = input?.TransactItems ? input.TransactItems.map((t: any) => Object.values(t)[0]) : [input];
  const exprs: string[] = [];
  for (const p of parts) {
    for (const k of ["UpdateExpression", "ConditionExpression", "KeyConditionExpression", "FilterExpression", "ProjectionExpression"]) {
      if (typeof p?.[k] === "string") exprs.push(p[k]);
    }
  }
  return exprs;
};

/* ------------------------------------------------------------------ event builder */
export const event = (p: {
  method: string;
  resource: string;
  sub: string;
  groups?: string;
  name?: string;
  body?: unknown;
  query?: Record<string, string>;
  path?: Record<string, string>;
}) =>
  ({
    httpMethod: p.method,
    resource: p.resource,
    body: p.body === undefined ? null : JSON.stringify(p.body),
    queryStringParameters: p.query ?? null,
    pathParameters: p.path ?? null,
    requestContext: { requestId: "test", authorizer: { claims: { sub: p.sub, email: `${p.sub.slice(-4)}@example.test`, name: p.name ?? p.sub.slice(-4), "cognito:groups": p.groups ?? "" } } },
  }) as any;

export const parse = (res: { statusCode: number; body: string }) => ({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined });
