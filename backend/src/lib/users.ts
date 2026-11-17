import { batchGet, queryAll, type Item } from "./db";

/**
 * User directory (database-design.md 3.1).
 *   USER#<id> / PROFILE           GSI1 EMAIL#<email> (exact lookup)   GSI2 DIRECTORY / <lower name>#<id> (prefix search)
 *   USER#<id> / ROLE#<orgRole>    GSI2 ROLE#<orgRole> / <lower name>#<id>   (org-level group mirror, e.g. ApprovalEligible)
 * Profiles are created on first sign-in (GET /me), so a user appears in the directory only after signing in once.
 */
export const userKey = (id: string) => ({ PK: `USER#${id}`, SK: "PROFILE" });
export const roleKey = (id: string, role: string) => ({ PK: `USER#${id}`, SK: `ROLE#${role}` });
export const directorySK = (displayName: string, id: string) => `${displayName.trim().toLowerCase()}#${id}`;

export interface UserFacts {
  profile?: Item;
  exists: boolean;
  active: boolean;
  eligible: boolean;
}

/** Profile + ApprovalEligible mirror for many users in one batch. */
export const loadUserFacts = async (ids: string[]): Promise<Map<string, UserFacts>> => {
  const got = await batchGet(ids.flatMap((id) => [userKey(id), roleKey(id, "ApprovalEligible")]));
  const out = new Map<string, UserFacts>();
  for (const id of ids) {
    const profile = got.get(`USER#${id}|PROFILE`);
    out.set(id, {
      profile,
      exists: !!profile,
      active: profile?.status === "ACTIVE",
      eligible: got.has(`USER#${id}|ROLE#ApprovalEligible`),
    });
  }
  return out;
};

/** Directory result. Deliberately WITHOUT email (review finding I3): other users' addresses are not exposed. */
export const toDirectoryEntry = (p: Item, eligible: boolean) => ({
  id: p.userId as string,
  displayName: p.displayName as string,
  initials: p.initials as string,
  approvalEligible: eligible,
});

/**
 * The managers: every person in the ApprovalEligible group who has signed in at least once (the group mirror is written
 * at sign-in) and whose profile is ACTIVE. Index reads are eventually consistent; the profile status is read per user.
 */
export const listManagers = async (): Promise<{ userId: string; displayName: string; initials: string; active: boolean }[]> => {
  const mirrors = await queryAll({
    IndexName: "GSI2",
    KeyConditionExpression: "GSI2PK = :p",
    ExpressionAttributeValues: { ":p": "ROLE#ApprovalEligible" },
  }, 500);
  const facts = await loadUserFacts(mirrors.map((m) => m.userId as string));
  return mirrors.map((m) => {
    const f = facts.get(m.userId as string);
    return { userId: m.userId as string, displayName: (f?.profile?.displayName ?? m.displayName) as string, initials: (f?.profile?.initials ?? m.initials) as string, active: !!f?.active };
  });
};
