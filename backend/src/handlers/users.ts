import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, itemKey, TABLE, type Item } from "../lib/db";
import { badRequest } from "../lib/errors";
import { assertTokenPartition, decodeToken, encodeToken, json, parseLimit, router, type Ctx } from "../lib/http";
import { loadUserFacts, toDirectoryEntry } from "../lib/users";

export const MIN_QUERY = 2;

/**
 * GET /users?q=&approverEligible=true&limit=&nextToken=
 * Directory search for assignment pickers. Any signed-in user may search (owners pick participants/approvers).
 *  - q is required, at least 2 characters, so the whole directory cannot be listed (review finding I3)
 *  - q containing "@"      -> exact email lookup (GSI1 EMAIL#<email>); the email is NOT echoed back
 *  - q otherwise           -> case-insensitive name prefix (GSI2 DIRECTORY or ROLE#ApprovalEligible)
 *  - approverEligible=true -> only members of the ApprovalEligible group
 * Results never contain email addresses: { id, displayName, initials, approvalEligible }.
 * Only users who have signed in at least once are listed (profiles are created on first sign-in).
 */
const searchUsers = async ({ query }: Ctx) => {
  const limit = parseLimit(query.limit, 20, 50);
  const q = (query.q ?? "").trim().toLowerCase();
  if (q.length < MIN_QUERY) throw badRequest(`q must be at least ${MIN_QUERY} characters`, [{ field: "q", issue: "min_length" }]);
  if (q.length > 80) throw badRequest("q is too long (max 80)", [{ field: "q", issue: "max_length" }]);
  if (query.approverEligible !== undefined && !["true", "false"].includes(query.approverEligible)) {
    throw badRequest("approverEligible must be true or false", [{ field: "approverEligible", issue: "enum" }]);
  }
  const eligibleOnly = query.approverEligible === "true";

  let ids: string[] = [];
  let lastKey: Record<string, unknown> | undefined;

  if (q.includes("@")) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :p AND GSI1SK = :s",
        ExpressionAttributeValues: { ":p": `EMAIL#${q}`, ":s": "USER" },
      }),
    );
    ids = ((res.Items as Item[]) ?? []).map((p) => p.userId);
  } else {
    const partition = eligibleOnly ? "ROLE#ApprovalEligible" : "DIRECTORY";
    const startKey = decodeToken(query.nextToken);
    assertTokenPartition(startKey, "GSI2PK", partition);
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :p AND begins_with(GSI2SK, :q)",
        ExpressionAttributeValues: { ":p": partition, ":q": q },
        Limit: limit,
        ExclusiveStartKey: startKey,
      }),
    );
    const rows = (res.Items as Item[]) ?? [];
    ids = rows.map((r) => r.userId);
    lastKey = res.LastEvaluatedKey && rows.length ? itemKey(rows[rows.length - 1], "GSI2") : undefined;
  }

  const facts = await loadUserFacts(ids);
  const items = ids
    .map((id) => facts.get(id))
    .filter((f) => f?.exists && f.active && (!eligibleOnly || f.eligible))
    .map((f) => toDirectoryEntry(f!.profile!, f!.eligible));
  return json(200, { items, nextToken: encodeToken(lastKey) });
};

export const handler = router({
  "GET /users": searchUsers,
});
