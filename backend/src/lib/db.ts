import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";

export const TABLE = process.env.TABLE_NAME ?? "";

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export type Item = Record<string, any>;

/** Runs a query and follows pages until `max` items are collected (or the index is exhausted). */
export const queryAll = async (input: Omit<QueryCommandInput, "TableName">, max = 1000): Promise<Item[]> => {
  const out: Item[] = [];
  let key: Record<string, any> | undefined = input.ExclusiveStartKey;
  do {
    const res = await ddb.send(new QueryCommand({ ...input, TableName: TABLE, ExclusiveStartKey: key }));
    out.push(...((res.Items as Item[]) ?? []));
    key = res.LastEvaluatedKey;
  } while (key && out.length < max);
  return out.slice(0, max);
};

/** Fetches filtered pages until `limit` matches are found; returns the continuation key. */
export const queryPage = async (
  input: Omit<QueryCommandInput, "TableName" | "Limit">,
  limit: number,
  filter: (item: Item) => boolean,
): Promise<{ items: Item[]; lastKey?: Record<string, any> }> => {
  const items: Item[] = [];
  let key: Record<string, any> | undefined = input.ExclusiveStartKey;
  let rounds = 0;
  while (rounds++ < 20) {
    const res = await ddb.send(new QueryCommand({ ...input, TableName: TABLE, ExclusiveStartKey: key, Limit: Math.max(limit, 25) }));
    for (const it of (res.Items as Item[]) ?? []) {
      if (!filter(it)) continue;
      items.push(it);
      if (items.length === limit) {
        // Resume right after the last returned item.
        return { items, lastKey: itemKey(it, input.IndexName) };
      }
    }
    key = res.LastEvaluatedKey;
    if (!key) return { items };
  }
  return { items, lastKey: key };
};

/** Primary key (+ index keys) of an item, used as ExclusiveStartKey. */
const itemKey = (it: Item, indexName?: string): Record<string, any> => {
  const k: Record<string, any> = { PK: it.PK, SK: it.SK };
  if (indexName) {
    k[`${indexName}PK`] = it[`${indexName}PK`];
    k[`${indexName}SK`] = it[`${indexName}SK`];
  }
  return k;
};
