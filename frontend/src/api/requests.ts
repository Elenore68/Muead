import { api } from "./client";

/* ---------- Types (mirror docs/backend/api-specification.md section 2.1 and 11) ---------- */
export type ApiStatus =
  | "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "SCHEDULED"
  | "READINESS" | "IN_PROGRESS" | "VALIDATION" | "COMPLETED" | "CANCELLED";
export type ApiPriority = "HIGH" | "MEDIUM" | "LOW";

export interface RequestSummary {
  id: string;
  requestNo: string;
  title: string;
  status: ApiStatus;
  owner: { id: string; displayName: string; initials: string };
  category: string | null;
  priority: ApiPriority | null;
  schedule: { start: string; end: string | null; timezone: string | null } | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Page<T> {
  items: T[];
  nextToken: string | null;
}

export interface Counts {
  all: number;
  byStatus: Partial<Record<ApiStatus, number>>;
}

export interface CreateRequestInput {
  title: string;
  description: string;
  category?: string;
  priority?: ApiPriority;
  /** Backend field "schedule.start". The current form only has a single "Target Date". */
  schedule?: { start: string };
}

export interface ReferenceData {
  categories: string[];
  priorities: string[];
}

/* ---------- Calls ---------- */
export const listRequests = (p: { status?: string; q?: string; limit: number; nextToken?: string }, signal?: AbortSignal) =>
  api<Page<RequestSummary>>("requests", { query: p, signal });

export const getCounts = (signal?: AbortSignal) => api<Counts>("requests/counts", { signal });

export const createRequest = (input: CreateRequestInput) =>
  api<{ id: string; requestNo: string }>("requests", { method: "POST", body: input });

export const getReferenceData = (signal?: AbortSignal) => api<ReferenceData>("reference-data", { signal });

/* ---------- Attachments: register -> PUT to S3 -> confirm ---------- */
// Same rules as the backend (backend/src/handlers/attachments.ts). The backend re-checks everything.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
};
export const ACCEPT_ATTR = Object.keys(CONTENT_TYPES).map((e) => `.${e}`).join(",");

/** Returns an error message for an unacceptable file, or null if it is fine. */
export const checkFile = (f: File): string | null => {
  const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
  if (!CONTENT_TYPES[ext]) return `${f.name}: only PDF, DOC, XLS and PNG files are allowed.`;
  if (f.size === 0) return `${f.name}: the file is empty.`;
  if (f.size > MAX_FILE_BYTES) return `${f.name}: larger than 10 MB.`;
  return null;
};

export async function uploadAttachment(requestId: string, file: File): Promise<void> {
  const ext = file.name.split(".").pop()!.toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  const reg = await api<{ attachmentId: string; uploadUrl: string; headers: Record<string, string> }>(`requests/${requestId}/attachments`, {
    method: "POST",
    body: { fileName: file.name, contentType, sizeBytes: file.size },
  });
  // Direct upload to S3 with the pre-signed URL. No Authorization header here.
  let put: Response;
  try {
    put = await fetch(reg.uploadUrl, { method: "PUT", headers: reg.headers, body: file });
  } catch {
    throw new Error(`${file.name}: upload failed (network or CORS).`);
  }
  if (!put.ok) throw new Error(`${file.name}: upload failed (${put.status}).`);
  await api(`requests/${requestId}/attachments/${reg.attachmentId}/confirm`, { method: "POST" });
}

/* ---------- Request details (GET /requests/{id}) ---------- */
export interface RequestDetail extends RequestSummary {
  description: string;
  environment?: string;
  cloudPlatform?: string;
  maintenanceType?: string;
  scope?: string;
  affectedSystems?: string[];
  links?: { label: string; url: string }[];
  approvalState?: string;
  /** TASK 04a fields (api-specification.md 12.1). */
  approvalPolicy?: "ANY_ONE" | "ALL";
  approvalRound?: number;
  /** What the caller may do in THIS request. The backend re-checks on every call. */
  viewer?: {
    activityRole: "OWNER" | "PARTICIPANT" | "APPROVER" | null;
    canEdit: boolean;
    canManageMembers: boolean;
  };
}

export const getRequest = (id: string, signal?: AbortSignal) =>
  api<RequestDetail>(`requests/${encodeURIComponent(id)}`, { signal });

/* ---------- Attachments list / download ---------- */
export interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** Cognito user id. The API returns no display name for the uploader. */
  uploadedBy: string;
  uploadedAt: string;
}

export const listAttachments = (requestId: string, signal?: AbortSignal) =>
  api<{ items: Attachment[] }>(`requests/${encodeURIComponent(requestId)}/attachments`, { signal });

export const getDownloadUrl = (requestId: string, attachmentId: string) =>
  api<{ url: string; expiresInSeconds: number }>(
    `requests/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(attachmentId)}/download-url`,
  );
