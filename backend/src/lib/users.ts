import { batchGet, type Item } from "./db";

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
