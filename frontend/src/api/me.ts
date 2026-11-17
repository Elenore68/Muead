import { api } from "./client";

/* TASK 13: own profile and notification preferences (PATCH /me, docs/backend/api-specification.md). */
export interface MeUpdate {
  displayName?: string;
  notificationPrefs?: { email: boolean };
}
export interface MeResult {
  id: string;
  email: string;
  displayName: string;
  initials: string;
  roles: string[];
  notificationPrefs: { email: boolean };
}
export const MAX_DISPLAY_NAME = 80;
export const updateMe = (patch: MeUpdate) => api<MeResult>("me", { method: "PATCH", body: patch });
