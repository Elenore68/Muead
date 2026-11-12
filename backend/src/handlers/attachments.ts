import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { ddb, queryAll, TABLE, transact, txConditionFailed, type Item } from "../lib/db";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { json, router, type Ctx } from "../lib/http";
import { assertEdit, assertView } from "../lib/members";
import { ATTACHMENTS_LOCKED, attachmentsUnlockedCheck, loadRequest, type Status } from "../lib/requests";

/**
 * Attachments are part of the plan under review: no changes while PENDING_APPROVAL, COMPLETED or CANCELLED
 * (TASK 04a review, finding I5). Checked up front for a clear error, and again inside each write transaction.
 */
const LOCKED_MESSAGE = "Attachments cannot change while the request is waiting for approval or after it is finished";
const assertAttachmentsUnlocked = (r: Item) => {
  if (ATTACHMENTS_LOCKED.includes(r.status as Status)) throw new ApiError(409, "ATTACHMENTS_LOCKED", LOCKED_MESSAGE);
};
/** Index 1 of every attachment write transaction is the request-status check. */
const lockedOrConflict = (e: unknown, itemConflict: () => never): never => {
  if (txConditionFailed(e, 1)) throw new ApiError(409, "ATTACHMENTS_LOCKED", LOCKED_MESSAGE);
  if (txConditionFailed(e, 0)) itemConflict();
  throw e;
};

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME ?? "";

/**
 * ASSUMPTION (open question 7): the allowed types and the 10 MB limit are taken from the hint text
 * on the New Request screen ("PDF, DOC, XLS, PNG (Max 10 MB)"). The SOW does not define them.
 * DOCX/XLSX are accepted as the modern forms of DOC/XLS.
 */
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  png: ["image/png"],
};
const UPLOAD_URL_TTL = 300; // seconds
const DOWNLOAD_URL_TTL = 300;

const sanitizeName = (name: string): string => name.replace(/[^\w.\- ()]/g, "_").replace(/\.{2,}/g, ".").slice(0, 150);
const attKey = (requestId: string, id: string) => ({ PK: `REQ#${requestId}`, SK: `ATT#${id}` });

const toApi = (a: Item) => ({
  id: a.id,
  fileName: a.fileName,
  contentType: a.contentType,
  sizeBytes: a.sizeBytes,
  uploadedBy: a.uploadedBy,
  uploadedAt: a.uploadedAt,
  status: a.status,
});

const loadAttachment = async (requestId: string, attachmentId: string): Promise<Item> => {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(attachmentId)) throw notFound("Attachment not found");
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: attKey(requestId, attachmentId) }));
  if (!res.Item) throw notFound("Attachment not found");
  return res.Item;
};

/** POST /requests/{id}/attachments: register the file and return a short-lived pre-signed PUT URL. */
const createUpload = async ({ caller, path, body }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertEdit(r, caller);
  assertAttachmentsUnlocked(r);

  const fileName = typeof body.fileName === "string" ? sanitizeName(body.fileName.trim()) : "";
  const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
  const sizeBytes = body.sizeBytes;
  if (!fileName) throw badRequest("fileName is required", [{ field: "fileName", issue: "required" }]);
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes < 1) throw badRequest("sizeBytes must be a positive integer", [{ field: "sizeBytes", issue: "type" }]);
  if (sizeBytes > MAX_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", `Files are limited to ${MAX_BYTES / (1024 * 1024)} MB`);
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  if (!TYPES[ext] || !TYPES[ext].includes(contentType)) {
    throw new ApiError(400, "INVALID_FILE", `Allowed types: ${Object.keys(TYPES).join(", ")} (extension and content type must match)`);
  }

  const id = ulid();
  const now = new Date().toISOString();
  const s3Key = `attachments/${r.id}/${id}/${fileName}`;
  const item: Item = {
    ...attKey(r.id, id),
    entityType: "ATTACHMENT",
    id,
    fileName,
    contentType,
    sizeBytes,
    s3Key,
    uploadedBy: caller.userId,
    uploadedAt: now,
    status: "PENDING_UPLOAD",
  };
  await transact([
    { Put: { TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(PK)" } },
    attachmentsUnlockedCheck(r.id),
  ]).catch((e) => lockedOrConflict(e, () => { throw conflict("CONCURRENT_UPDATE", "Please try again"); }));
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: s3Key, ContentType: contentType, ContentLength: sizeBytes }), {
    expiresIn: UPLOAD_URL_TTL,
  });
  return json(201, {
    attachmentId: id,
    uploadUrl,
    method: "PUT",
    headers: { "Content-Type": contentType },
    expiresInSeconds: UPLOAD_URL_TTL,
  });
};

/** POST .../confirm: verify the object really arrived in S3 and matches the declared size. */
const confirmUpload = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertEdit(r, caller);
  const a = await loadAttachment(r.id, path.attachmentId);
  if (a.uploadedBy !== caller.userId && !caller.isAdmin) throw forbidden();
  if (a.status === "AVAILABLE") return json(200, toApi(a));
  assertAttachmentsUnlocked(r);

  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: a.s3Key })).catch((e) => {
    if (e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404) throw conflict("UPLOAD_MISSING", "The file has not been uploaded yet");
    throw e;
  });
  if (head.ContentLength !== a.sizeBytes) throw conflict("UPLOAD_MISMATCH", "The uploaded file size does not match the declared size");

  const confirmedAt = new Date().toISOString();
  await transact([
    {
      Update: {
        TableName: TABLE,
        Key: attKey(r.id, a.id),
        UpdateExpression: "SET #s = :ok, confirmedAt = :now",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":ok": "AVAILABLE", ":now": confirmedAt },
      },
    },
    attachmentsUnlockedCheck(r.id),
  ]).catch((e) => lockedOrConflict(e, () => { throw notFound("Attachment not found"); }));
  return json(200, toApi({ ...a, status: "AVAILABLE", confirmedAt }));
};

const listAttachments = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertView(r, caller);
  const items = await queryAll({
    KeyConditionExpression: "PK = :p AND begins_with(SK, :a)",
    ExpressionAttributeValues: { ":p": `REQ#${r.id}`, ":a": "ATT#" },
  });
  return json(200, { items: items.filter((a) => a.status === "AVAILABLE").map(toApi) });
};

const downloadUrl = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertView(r, caller);
  const a = await loadAttachment(r.id, path.attachmentId);
  if (a.status !== "AVAILABLE") throw notFound("Attachment not found");
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: a.s3Key,
      ResponseContentDisposition: `attachment; filename="${a.fileName}"`,
      ResponseContentType: a.contentType,
    }),
    { expiresIn: DOWNLOAD_URL_TTL },
  );
  return json(200, { url, expiresInSeconds: DOWNLOAD_URL_TTL });
};

const deleteAttachment = async ({ caller, path }: Ctx) => {
  const r = await loadRequest(path.requestId);
  await assertView(r, caller);
  const a = await loadAttachment(r.id, path.attachmentId);
  if (!caller.isAdmin && r.ownerId !== caller.userId && a.uploadedBy !== caller.userId) throw forbidden();
  assertAttachmentsUnlocked(r);
  await transact([
    { Delete: { TableName: TABLE, Key: attKey(r.id, a.id), ConditionExpression: "attribute_exists(PK)" } },
    attachmentsUnlockedCheck(r.id),
  ]).catch((e) => lockedOrConflict(e, () => { throw notFound("Attachment not found"); }));
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: a.s3Key })); // versioned bucket: leaves a delete marker
  return json(204);
};

export const handler = router({
  "GET /requests/{requestId}/attachments": listAttachments,
  "POST /requests/{requestId}/attachments": createUpload,
  "POST /requests/{requestId}/attachments/{attachmentId}/confirm": confirmUpload,
  "GET /requests/{requestId}/attachments/{attachmentId}/download-url": downloadUrl,
  "DELETE /requests/{requestId}/attachments/{attachmentId}": deleteAttachment,
});
