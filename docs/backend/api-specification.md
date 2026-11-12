# Mue'ad REST API Specification (v1) – Proposal

Status: **design only, no implementation.** Consistent with `backend-architecture.md` (services, roles, lifecycle, open questions) and `database-design.md` (entities, keys, access patterns).

Labels: **[SOW]** stated in the SOW, **[FE]** needed by the existing frontend, **[REC]** my recommendation, **[OPEN]** missing information (numbers refer to `backend-architecture.md` §2.3).

---

## 1. Conventions

### 1.1 Base and transport
- Base URL: `https://<api-id>.execute-api.<region>.amazonaws.com/v1` (Amazon API Gateway REST API, Lambda behind it). Region and custom domain [OPEN 13].
- JSON over HTTPS. `Content-Type: application/json`. Timestamps ISO-8601 UTC (`2026-11-10T10:24:00Z`).
- The frontend reads the base URL from a build-time environment variable. [REC]
- CORS: Amplify domain(s) and `http://localhost:8002` (dev). [REC]

### 1.2 Authentication [SOW: Cognito]
- Header `Authorization: Bearer <Cognito JWT>`. Cognito authorizer on API Gateway validates it.
- **Organization-level groups** come from the `cognito:groups` claim. Only two exist: `PlatformAdmin` (administration and read access to all requests) and `ApprovalEligible` (may be **assigned** as an approver). Neither grants authority inside a maintenance activity. *(Decided in TASK 04a; replaces the earlier global groups `MaintenanceOwner`, `TechnicalParticipant`, `Approver`, which are removed.)*
- **Activity roles** (`OWNER`, `PARTICIPANT`, `APPROVER`) are per request and stored in DynamoDB, not in the token. A person can hold different activity roles in different requests (SOW §2 stakeholders are activity-dependent). See §1.3 and §12.
- Sign-in, sign-out, token refresh and password flows are done directly against Cognito (via the chosen client library [OPEN 18]); there are no `/login` endpoints in this API.

### 1.3 Authorization model (activity-scoped, decided in TASK 04a)
Authority inside a maintenance request comes **only** from the caller's ACTIVE membership in **that** request (`REQ#<id> / MEMBER#<userId>`, see `database-design.md` 3.4). Organization-level groups never grant activity authority.

Codes in the tables below (all are **per request**):

| Code | Meaning |
|---|---|
| **O** | The `OWNER` member of **that** request (the person who created it). Any active user can create a request and become its owner. |
| **P** | A `PARTICIPANT` member of **that** request. |
| **A** | An `APPROVER` member of **that** request, assigned by the owner or an admin. Must also be in `ApprovalEligible`. |
| **ADM** | A `PlatformAdmin`: read access to all requests and member management on any request. **No approval bypass** (see §12.3). |
| **Any** | Any authenticated user (still limited to what they may see). |

- One person has at most **one** activity role per request, so the owner or a participant of a request can never be its approver.
- The same person may be `APPROVER` in request A, `PARTICIPANT` in request B and `OWNER` in request C.
- Visibility: a user sees a request if they are an ACTIVE member (any activity role) or a platform admin. Others get `404`.

### 1.4 Common headers
| Header | Use |
|---|---|
| `Idempotency-Key` | Optional on `POST` that create or decide (requests, invitations, decisions, AI summary). Same key within 24 h returns the original result. [REC] |
| `X-Request-Id` | Returned on every response; also logged to CloudWatch. |

### 1.5 Optimistic locking [REC]
Mutable resources return `version` (integer). `PATCH`/`PUT`/decision calls must send the `version` they read. On mismatch: `409 VERSION_CONFLICT`.

### 1.6 Pagination, sorting, filtering
- `limit` (default 25, max 100) and `nextToken` (opaque). Response: `{ "items": [...], "nextToken": "..." | null }`.
- Totals for UI text such as "Showing 1-5 of 12" [FE] are returned as `totalCount` **only** on endpoints that read an aggregate (stated per endpoint). DynamoDB cannot cheaply count arbitrary filters; see [OPEN] note in §10.
- `sort` where supported, for example `sort=createdAt:desc`.

### 1.7 Error format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable summary",
    "details": [{ "field": "title", "issue": "required" }],
    "requestId": "c7f0..."
  }
}
```
| HTTP | `code` examples |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_TRANSITION`, `INVALID_FILE` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN`, `NOT_A_PARTICIPANT` |
| 404 | `NOT_FOUND` |
| 409 | `VERSION_CONFLICT`, `ALREADY_DECIDED`, `SCHEDULE_CONFLICT_BLOCKING` |
| 413 | `FILE_TOO_LARGE` |
| 429 | `THROTTLED` |
| 5xx | `INTERNAL_ERROR`, `UPSTREAM_UNAVAILABLE` |

### 1.8 Enumerations
| Enum | Values | Source |
|---|---|---|
| `status` (request) | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SCHEDULED`, `READINESS`, `IN_PROGRESS`, `VALIDATION`, `COMPLETED`, `CANCELLED` | [REC] lifecycle, [OPEN 2] |
| `priority` | `HIGH`, `MEDIUM`, `LOW` | [FE]; keep only if confirmed [OPEN 8] |
| `inviteStatus` | `INVITED`, `CONFIRMED`, `DECLINED` | [SOW 4.3] |
| `taskStatus` | `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED` | [SOW 4.3: completion status], values [REC] |
| `decision` | `PENDING`, `APPROVED`, `REJECTED` | [SOW 4.5] |
| `checklistGroup` | `BACKUP`, `ACCESS`, `FIREWALL_CONNECTIVITY`, `TEAM_AVAILABILITY`, `APP_DEPENDENCIES`, `DOCUMENTATION` | [SOW 4.6] |
| `checklistStatus` | `PENDING`, `READY`, `NOT_READY`, `NOT_APPLICABLE` | [REC] |
| `validationDomain` | `APPLICATION`, `DATABASE`, `OPERATING_SYSTEM`, `INFRASTRUCTURE` | [SOW 4.9] |
| `validationResult` | `PASSED`, `FAILED`, `PASSED_WITH_ISSUES`, `NOT_APPLICABLE` | [REC] |
| `reportKind` / `reportStatus` | `AI_SUMMARY`, `FINAL` / `DRAFT`, `SAVED` | [SOW 4.8, 4.10] |
| `notificationType` | `INVITATION`, `APPROVAL_REQUESTED`, `APPROVAL_DECIDED`, `TASK_ASSIGNED`, `REMINDER`, `CONFLICT_ALERT`, `REPORT_READY` | [SOW 5.5], list [REC] |

### 1.9 Status mapping to the current UI [FE]
| UI label | API `status` |
|---|---|
| Pending | `PENDING_APPROVAL` |
| In Progress | `IN_PROGRESS` (and, when UI is extended, `READINESS`, `VALIDATION`) |
| Completed | `COMPLETED` |
| Rejected | `REJECTED` |

---

## 2. Core resource shapes

### 2.1 Request (summary and detail)
```json
{
  "id": "01JC...",
  "requestNo": "REQ-0142",
  "title": "Fix Meeting Room Projector",
  "description": "...",
  "status": "PENDING_APPROVAL",
  "owner": { "id": "u1", "displayName": "Sara", "initials": "S" },
  "environment": "PRODUCTION",
  "cloudPlatform": "AWS",
  "affectedSystems": ["billing-api", "orders-db"],
  "maintenanceType": "PATCHING",
  "scope": "text",
  "schedule": { "start": "2026-11-15T20:00:00Z", "end": "2026-11-15T23:00:00Z", "timezone": "Asia/Riyadh" },
  "category": "IT",
  "priority": "HIGH",
  "links": [{ "label": "Runbook", "url": "https://..." }],
  "approvalState": "PENDING",
  "conflicts": [{ "requestId": "01JB...", "requestNo": "REQ-0139", "reason": "OVERLAP_SAME_SYSTEM" }],
  "counts": { "participants": 4, "tasksDone": 2, "tasksTotal": 5 },
  "createdAt": "2026-11-10T10:24:00Z",
  "updatedAt": "2026-11-10T10:30:00Z",
  "version": 3
}
```
- The list endpoint returns a lighter object (no `scope`, `links`, `description` truncated). Both include fields the current UI shows: `requestNo`, `title`, `category`, `owner` (UI "Requested by"), `priority`, `status`, `createdAt`, and `schedule.start` (UI "Target date").
- UI "Assigned to" [FE] has no equivalent in the SOW data model (assignments are per task, not per request). **[OPEN]** show the first task assignee, a designated "lead", or drop the column.
- `environment`, `cloudPlatform`, `affectedSystems`, `maintenanceType`, `scope`, `schedule` are required by the SOW but are not on the current form. Which of them are mandatory at draft vs submit is [OPEN 8].
- `category` and `priority` come from the visual reference. If the SOW taxonomy replaces them, these fields are removed. [OPEN 8]

---

## 3. Endpoints

Legend: **Req** = request body or parameters. **Res** = successful response. Role = who may call.

### 3.1 Current user and users

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/me` | Current user profile and effective roles; replaces hard-coded "Amal". [FE] | – | `200 { id, email, displayName, initials, roles[], teamSpecialties[], notificationPrefs, unreadNotifications }` | Any |
| PATCH | `/me` | Update own display name, preferences. [REC] | `{ displayName?, notificationPrefs?: { email: bool } }` | `200` profile | Any |
| GET | `/users` | Directory search for assignment pickers. **Implemented in TASK 04a** (see §12.1). No email addresses in results. [SOW 4.3] | Query: `q` (**required, ≥ 2 chars**; name prefix, or exact email if it contains `@`), `approverEligible?=true`, `limit`, `nextToken` | `200 { items:[{id, displayName, initials, approvalEligible}], nextToken }` | Any |
| POST | `/users` | Create or invite a platform user. [SOW 4.1 "authorized users"; mechanism OPEN 4] | `{ email, displayName, roles[], teamSpecialties[]? }` | `201 { id, status: "INVITED" }` | ADM |
| PATCH | `/users/{userId}` | Change roles, specialties, enable/disable. [SOW §2 Platform Administrator] | `{ roles?, teamSpecialties?, status? }` | `200` user | ADM |

### 3.2 Reference data and settings

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/reference-data` | Value lists for forms: categories, priorities, environments, cloud platforms, maintenance types, teams, readiness template. Lists are [OPEN 8]. [FE form selects are static today] | – | `200 { categories[], priorities[], environments[], cloudPlatforms[], maintenanceTypes[], teams[], checklistGroups[] }` | Any |
| GET | `/admin/checklist-template` | Read default readiness items. [REC] | – | `200 { items:[{group,label,required,order}] }` | ADM |
| PUT | `/admin/checklist-template` | Replace default readiness items. [REC] | `{ items[] }` | `200` | ADM |

### 3.3 Maintenance requests [SOW 4.2]

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/requests` | List requests. Powers Requests page tabs, search, pagination. [FE] | Query: `status?` (one or comma list), `mine=owner\|participant\|approver`, `ownerId?`, `q?` (title or request no), `category?`, `priority?`, `from?`, `to?` (schedule start), `sort`, `limit`, `nextToken` | `200 { items:[RequestSummary], nextToken, totalCount? }` | Any (visibility rules §1.3) |
| GET | `/requests/counts` | Per-status counts for tab labels ("All (12)", "Pending (4)"). [FE] | Query: `mine?` | `200 { all, byStatus:{PENDING_APPROVAL, IN_PROGRESS, COMPLETED, REJECTED, ...} }` | Any |
| POST | `/requests` | Create a request as `DRAFT`; the caller becomes its `OWNER` member. [FE New Request][SOW 4.2] | `{ title*, description*, environment, cloudPlatform, affectedSystems[], maintenanceType, scope, schedule:{start,end,timezone}, category?, priority?, links?[], approvalPolicy? }` (*required on the current form; others per SOW, mandatory level [OPEN 8]; `approvalPolicy` `ANY_ONE` (default) or `ALL`) | `201 Request` (+ `Location`) | Any |
| GET | `/requests/{requestId}` | Request detail. [FE] | – | `200 Request` | O, P, A, ADM |
| PATCH | `/requests/{requestId}` | Edit fields. Allowed in `DRAFT` and `REJECTED`; after approval only by [OPEN 2]. | any subset of create fields + `version` | `200 Request` | O, ADM |
| POST | `/requests/{requestId}/submit` | Submit for approval. Snapshots the request's `APPROVER` members into a new approval round. **Implemented in TASK 04a without Step Functions, notifications or conflict check** (see §12.2). [SOW 4.5, 5.6] | `{ version }` (approvers come from the request's members, not from the body) | `200 { requestId, status:"PENDING_APPROVAL", approvalRound, approvalPolicy, approvers, version }` | O, ADM |
| POST | `/requests/{requestId}/transition` | Move through the post-approval lifecycle. Validates the target state and its preconditions (for example `READINESS` -> `IN_PROGRESS` only if required checklist items are `READY`; precondition rules [OPEN 2]). | `{ to: "SCHEDULED"\|"READINESS"\|"IN_PROGRESS"\|"VALIDATION"\|"COMPLETED", note?, version }` | `200 Request` | O, ADM (VALIDATION->COMPLETED: see closure §3.12) |
| POST | `/requests/{requestId}/withdraw` | Pull a `PENDING_APPROVAL` request back to `DRAFT` (recovery when a round cannot finish). **Implemented** (see §12.2). | `{ reason, version }` (reason required, max 1000) | `200 { requestId, status:"DRAFT", approvalState:"WITHDRAWN", round, closedRecords, version }` | O, ADM |
| POST | `/requests/{requestId}/cancel` | Cancel before `IN_PROGRESS`; cancels the workflow. [REC] | `{ reason, version }` | `200 Request` | O, ADM |
| POST | `/requests/{requestId}/archive` | Soft-archive. [REC] No hard delete. | `{ version }` | `200` | ADM |
| GET | `/requests/{requestId}/activity` | Combined timeline (audit + execution updates) for the Activity tab. [FE tab not built] | `limit`, `nextToken` | `200 { items:[{type, actor, message, at, meta}], nextToken }` | O, P, A, ADM |

### 3.4 Scheduling and conflicts [SOW 4.4]

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/schedule` | Activities in a date range for the Schedule page and "Upcoming Schedule" card. [FE] | Query: `from`, `to`, `status?`, `mine?` | `200 { items:[{requestId, requestNo, title, start, end, status}] }` | Any |
| POST | `/schedule/conflicts/check` | Pre-check a window while editing (no save). [SOW "potential scheduling conflicts"; rule [OPEN 10]] | `{ start, end, affectedSystems[], excludeRequestId? }` | `200 { conflicts:[{requestId, requestNo, title, overlap:{start,end}, sharedSystems[]}] }` | O, ADM |
| GET | `/requests/{requestId}/conflicts` | Current conflicts of a request. | – | `200 { conflicts[] }` | O, P, A, ADM |

### 3.5 Attachments and links [SOW 4.2, 5.4]
Files go directly to S3 using pre-signed URLs; they never pass through API Gateway. Links are stored on the request (`links`) and edited via `PATCH /requests/{id}`.

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| POST | `/requests/{requestId}/attachments` | Register an attachment and receive a pre-signed upload URL. [FE dropzone] | `{ fileName, contentType, sizeBytes }` (types/size: UI says PDF, DOC, XLS, PNG, 10 MB; [OPEN 7]) | `201 { attachmentId, uploadUrl, method:"PUT", headers, expiresInSeconds }` | O, P, ADM |
| POST | `/requests/{requestId}/attachments/{attachmentId}/confirm` | Mark upload complete after the browser uploaded to S3. | – | `200 Attachment` | O, P, ADM |
| GET | `/requests/{requestId}/attachments` | List attachments (Attachments tab). [FE tab not built] | – | `200 { items:[{id,fileName,contentType,sizeBytes,uploadedBy,uploadedAt}] }` | O, P, A, ADM |
| GET | `/requests/{requestId}/attachments/{attachmentId}/download-url` | Short-lived pre-signed GET URL. | – | `200 { url, expiresInSeconds }` | O, P, A, ADM |
| DELETE | `/requests/{requestId}/attachments/{attachmentId}` | Remove an attachment (uploader, owner, or admin). | – | `204` | O, ADM, uploader |

### 3.6 Members: participants and approvers [SOW 4.3, 4.5]
*Revised in TASK 04a: participants and approvers are both activity members (`/members` replaces `/participants`).*

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/requests/{requestId}/members` | Members with their activity role. **Implemented.** | Query: `includeRemoved?=true` | `200 { items:[Member], limits:{maxApprovers, maxMembers} }` | O, P, A, ADM |
| POST | `/requests/{requestId}/members` | Assign a participant or an approver. **Implemented** (rules §12.1). | `{ userId, activityRole:"PARTICIPANT"\|"APPROVER", specialty?, responsibilities? }` | `201 Member` | O, ADM |
| DELETE | `/requests/{requestId}/members/{userId}` | Soft-remove a member (the owner cannot be removed). **Implemented.** | – | `204` | O, ADM |
| PATCH | `/requests/{requestId}/members/{userId}` | Edit specialty and responsibilities. Design only. | `{ specialty?, responsibilities? }` | `200 Member` | O, ADM |
| POST | `/requests/{requestId}/members/{userId}/resend` | Re-send invitation / reminder. Design only (needs notifications). | – | `202` | O, ADM |
| POST | `/requests/{requestId}/members/me/response` | Invited participant confirms or declines. Design only. [SOW "confirm their participation"] | `{ response:"CONFIRMED"\|"DECLINED", reason? }` | `200 Member` | P (self) |

`Member`: `{ userId, displayName, initials, activityRole, status:"ACTIVE"|"REMOVED", specialty, responsibilities, assignedBy:{id, displayName, activityRole}, assignedAt, removedBy, removedAt }`. Names are snapshots taken at assignment.

### 3.7 Tasks [SOW 4.3]

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/requests/{requestId}/tasks` | List tasks (owner, deadline, status). | Query: `status?`, `assigneeId?` | `200 { items:[Task] }` | O, P, A, ADM |
| POST | `/requests/{requestId}/tasks` | Create and assign a task to a user or a team. Notifies assignee. | `{ title, description?, assigneeType:"USER"\|"TEAM", assigneeId, dueAt, order? }` | `201 Task` | O, ADM |
| PATCH | `/requests/{requestId}/tasks/{taskId}` | Edit/reassign task (owner) or update `status` (assignee). | `{ title?, description?, assigneeType?, assigneeId?, dueAt?, status?, version }` | `200 Task` | O, ADM; assignee for `status` only |
| DELETE | `/requests/{requestId}/tasks/{taskId}` | Remove a task. | – | `204` | O, ADM |
| GET | `/tasks/mine` | Tasks assigned to me across activities (dashboard). | Query: `status?`, `limit`, `nextToken` | `200 { items:[Task+request ref], nextToken }` | Any |

`Task`: `{ id, requestId, title, description, assigneeType, assignee:{id,displayName}, dueAt, status, completedAt, version }`. Team-level assignment: how a team task is "claimed" is [OPEN].

### 3.8 Approvals [SOW 4.5]

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
*Revised in TASK 04a. Approval authority is per request (assigned approvers), never from a global group. All endpoints below are **implemented**, without Step Functions or notifications.*

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/approvals` | **My** approval inbox (records assigned to the caller), newest first. [FE Approvals page] | Query: `decision=PENDING`(default)`\|APPROVED\|REJECTED\|NOT_REQUIRED`, `q?`, `limit`, `nextToken` | `200 { items:[{ approvalId, requestId, requestNo, title, description, requestedBy:{id,displayName,initials}, category, priority, round, policy, decision, comment, submittedAt, decidedAt, requestStatus, canDecide, blockedReason }], nextToken }` | Any (own records only) |
| GET | `/approvals/summary` | **My** counts for the KPI cards and tabs (exact count queries). [FE] | – | `200 { pending, approved, rejected }` | Any (own records only) |
| GET | `/requests/{requestId}/approvals` | Approval history: every round, its assigned approvers, decisions, comments, times. [SOW "track approval history"] | – | `200 { approvalState, approvalPolicy, currentRound, rounds:[{ round, policy, status, submittedAt, submittedBy:{id,displayName,activityRole}, decidedAt, approvers:[{userId, displayName, initials, activityRole, decision, comment, decidedAt}] }] }` | O, P, A, ADM |
| POST | `/requests/{requestId}/approvals/decision` | Approve or reject the current round. [FE Approve/Reject][SOW 4.5] | `{ decision:"APPROVED"\|"REJECTED", comment? }` (comment **required** on reject, max 1000; `version` not needed, see §12.2) | `200 { requestId, round, decision, requestStatus, roundStatus, version }` | A of **that** request and round (no admin bypass) |
| POST | `/approvals/bulk-decision` | Decide several at once. **Not implemented** (no bulk UI). | `{ items:[{requestId}], decision, comment? }` | `207 { results:[{requestId, ok, error?}] }` | A |

Policies:
- `ANY_ONE` (default): one approval approves the request at once. A rejection is recorded, but the request stays pending while any other approver can still decide. It is rejected only when **every** assigned approver has rejected.
- `ALL`: every assigned approver must approve, and any rejection rejects at once.

Details in §12.2.

### 3.9 Readiness checklist [SOW 4.6]

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/requests/{requestId}/checklist` | Items grouped by group, with readiness summary. | – | `200 { items:[{id, group, label, required, status, note, updatedBy, updatedAt, version}], summary:{total, ready, requiredNotReady} }` | O, P, A, ADM |
| POST | `/requests/{requestId}/checklist` | Add a custom item (items are seeded from the template). [REC] | `{ group, label, required }` | `201` item | O, ADM |
| PATCH | `/requests/{requestId}/checklist/{itemId}` | Participants update status/note. [SOW "participants can update checklist items"] | `{ status?, note?, version }` | `200` item | O, P (confirmed), ADM |
| DELETE | `/requests/{requestId}/checklist/{itemId}` | Remove a custom item. [REC] | – | `204` | O, ADM |

### 3.10 Execution tracking [SOW 4.7 – details not provided, OPEN 1]
The fields below are my minimal proposal.

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/requests/{requestId}/execution-updates` | Progress feed. | `limit`, `nextToken` | `200 { items:[{id, type, message, taskId?, severity?, author, createdAt}], nextToken }` | O, P, A, ADM |
| POST | `/requests/{requestId}/execution-updates` | Post a progress note or issue while `IN_PROGRESS`. | `{ type:"PROGRESS_NOTE"\|"ISSUE", message, taskId?, severity? }` | `201` update | O, P (confirmed), ADM |

Task status changes (`PATCH .../tasks/{id}`) also append `TASK_UPDATE` entries automatically. Overall progress % is derived from tasks.

### 3.11 Post-maintenance validation [SOW 4.9]

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/requests/{requestId}/validation` | Results per domain plus remaining issues. | – | `200 { results:[{domain, result, notes, confirmedBy, confirmedAt, version}], issues:[Issue] }` | O, P, A, ADM |
| PUT | `/requests/{requestId}/validation/{domain}` | Record/update a domain result ("as applicable"). | `{ result, notes?, version? }` | `200` result | P (relevant specialty), O, ADM |
| POST | `/requests/{requestId}/validation/issues` | Record a remaining issue. | `{ domain?, description, severity }` | `201` issue | O, P, ADM |
| PATCH | `/requests/{requestId}/validation/issues/{issueId}` | Update/resolve an issue. | `{ description?, severity?, status? }` | `200` issue | O, P, ADM |

### 3.12 Reports, AI summary, closure [SOW 4.8, 4.10, 5.7]
Final report and closure contents are not specified. [OPEN 1] Below is a minimal proposal.

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| POST | `/requests/{requestId}/reports/ai-summary` | Generate an AI Activity Summary draft with Bedrock from tasks, execution updates, issues, validation results. Asynchronous. [FE "Generate Summary" button][SOW 4.8] | `{ language?: "en"\|"ar" }` (language [OPEN 11]) | `202 { reportId, status:"GENERATING" }` | O, ADM |
| GET | `/requests/{requestId}/reports` | List reports of an activity. | – | `200 { items:[{id, kind, status, generatedAt, reviewedBy, reviewedAt}] }` | O, P, A, ADM |
| GET | `/requests/{requestId}/reports/{reportId}` | Get report content (for review). | – | `200 { id, kind, status, content, model, generatedAt }` | O, P, A, ADM |
| PUT | `/requests/{requestId}/reports/{reportId}` | Edit the draft text. | `{ content }` | `200` | O (responsible employee), ADM |
| POST | `/requests/{requestId}/reports/{reportId}/save` | Responsible employee reviews and saves; stores final copy in S3. [SOW "review before saving"] | `{ confirm: true }` | `200 { status:"SAVED", reviewedBy, reviewedAt }` | O (responsible employee), ADM |
| GET | `/requests/{requestId}/reports/{reportId}/download-url` | Pre-signed URL for the stored report. | `format?` (pdf/md: [OPEN 16]) | `200 { url, expiresInSeconds }` | O, P, A, ADM |
| POST | `/requests/{requestId}/close` | Final report and closure: requires validation recorded and a `SAVED` report; sets `COMPLETED`, `closedAt`. [SOW 4.10, rules OPEN 1] | `{ summary?, version }` | `200 Request` | O, ADM |

"Responsible employee" is assumed to be the request owner. [OPEN 1]

### 3.13 Reports and maintenance history [SOW 4.4 "reports"; screen not designed, OPEN 16]

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/reports` | Cross-activity report list (history). | Query: `month?`, `kind?`, `status?`, `limit`, `nextToken` | `200 { items:[{id, requestId, requestNo, title, kind, status, generatedAt}], nextToken }` | O, A, ADM |
| GET | `/history` | Maintenance history: completed/cancelled activities with filters. | Query: `from`, `to`, `status?`, `environment?`, `maintenanceType?`, `ownerId?`, `limit`, `nextToken` | `200 { items:[RequestSummary], nextToken }` | O, A, ADM |
| GET | `/history/export` | Start an export (CSV/PDF format [OPEN 16]). | same filters + `format` | `202 { exportId }`; then `GET /history/export/{exportId}` -> `{ status, url? }` | O, A, ADM |

### 3.14 Dashboard [SOW 4.4, FE]

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/dashboard/summary` | KPI cards (Total, Pending Approvals, In Progress, Completed), "Requests by Status" donut, "Requests by Category" bars. | Query: `scope=mine\|all` (default `mine`; `all` for ADM/A) | `200 { totals:{total,pendingApprovals,inProgress,completed}, byStatus:[{status,count}], byCategory:[{category,count}] }` | Any |
| GET | `/dashboard/requests-over-time` | Line chart series. | Query: `from`, `to`, `interval=day` | `200 { points:[{date,count}] }` | Any |
| GET | `/dashboard/upcoming` | Upcoming activities (next N days). Same data as `/schedule`, convenience. | Query: `days=14`, `limit=5` | `200 { items:[{requestId, title, start, status}] }` | Any |
| GET | `/dashboard/alerts` | Scheduling conflicts, overdue tasks, pending decisions. [SOW "alerts"] | – | `200 { conflicts[], overdueTasks[], pendingApprovals }` | Any |
| GET | `/dashboard/recent-requests` | "Recent Requests" table (dashboard v1 of the reference). | `limit=5` | `200 { items:[RequestSummary] }` | Any |

Note: the AI Activity Summary card on the dashboard reference is per-activity in the SOW (§3.12); a dashboard-wide summary is not in the SOW. [OPEN]

### 3.15 Notifications [SOW 4.3, 4.4, 5.5]

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/notifications` | Bell panel list. [FE bell] | Query: `unread?=true`, `limit`, `nextToken` | `200 { items:[{id, type, title, body, requestId?, createdAt, readAt}], nextToken }` | Any (own) |
| GET | `/notifications/unread-count` | Red dot / badge. Polled (for example every 60 s) [REC]. | – | `200 { count }` | Any (own) |
| POST | `/notifications/{notificationId}/read` | Mark read. | – | `204` | Any (own) |
| POST | `/notifications/read-all` | Mark all read. | – | `204` | Any (own) |

Notifications are created by the backend (workflow, stream and scheduler Lambdas), never by the client. Emails go through SNS/SES; no client endpoint sends email.

### 3.16 Team [FE]

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/team` | Team members for the sidebar list and the Team page: user, roles, specialties. Online presence is not provided. [OPEN 17] | `limit`, `nextToken` | `200 { items:[user] }` | Any |

Settings and Reports pages have no design; no dedicated endpoints beyond `/me`, `/admin/*`, `/reports`, `/history`.

---

## 4. Server-side events (not called by the frontend)
Documented so the frontend and data model line up. All SOW-based services: EventBridge, Step Functions, SNS, SES. [SOW 5.5, 5.6]

| Trigger | Action |
|---|---|
| `POST .../submit` | Start approval workflow; create approval items; notify approvers (in-app + email). |
| Approval decision | Resume workflow; update request status; notify owner. |
| Participant invited | Create participant item; notify invitee with details, responsibilities, scheduled time. |
| Task assigned or reassigned | Notify assignee. |
| Scheduled reminder (EventBridge) | Remind unconfirmed participants, pending approvers, unfinished checklist items before the window (timings [OPEN 9]). |
| Request create/update affecting schedule | Recompute `conflictFlags`; create `CONFLICT_ALERT` if new. |
| Report generation | Bedrock call, save draft to S3, notify owner (`REPORT_READY`). |
| DynamoDB stream | Maintain dashboard counters and denormalized list copies. |

---

## 5. Frontend usage map
Which existing screens and controls bind to which endpoints. [FE]

| Screen / control | Endpoint(s) |
|---|---|
| Topbar user name/avatar | `GET /me` |
| Bell dot / panel | `GET /notifications/unread-count`, `GET /notifications`, `POST /notifications/{id}/read` |
| Sidebar Team list | `GET /team` (presence not available) |
| Dashboard KPI cards, donut, category bars | `GET /dashboard/summary` |
| Dashboard line chart | `GET /dashboard/requests-over-time` |
| Dashboard Upcoming Schedule | `GET /dashboard/upcoming` (or `GET /schedule`) |
| Dashboard "Generate Summary" button | `POST /requests/{id}/reports/ai-summary` (needs an activity context; currently the button has none, [OPEN]) |
| Requests tabs and counts | `GET /requests/counts` |
| Requests list, search, pagination, sort | `GET /requests?status=&q=&limit=&nextToken=` |
| "New Request" form submit | `POST /requests` (then optionally `POST .../submit`), `POST .../attachments` for files |
| Attachment dropzone | `POST .../attachments` -> S3 `PUT` -> `POST .../confirm` |
| Request details page | `GET /requests/{id}` (+ `/members`, `/tasks`, `/approvals`, `/checklist`, `/attachments`, `/activity` for tabs) |
| Details Approve / Reject | `POST /requests/{id}/approvals/decision` |
| Approvals KPI cards and tabs | `GET /approvals/summary`, `GET /approvals?decision=` |
| Approvals row Approve / Reject | `POST /requests/{id}/approvals/decision` |
| Approvals checkboxes | `POST /approvals/bulk-decision` (if UI adds the action) |
| Schedule page | `GET /schedule` |
| Reports page | `GET /reports`, `GET /history` |
| Team page | `GET /team`, `GET /users` |
| Settings page | `GET/PATCH /me`, `/admin/*` |

Changes the UI will need later (not done in this task): sign-in screen, SOW fields on the request form, approval comment field, participant/task/checklist/execution/validation/closure/report UIs, notifications panel, role-aware navigation.

---

## 6. Role permission summary

All columns are **activity roles in one request** (§1.3). ADM = PlatformAdmin who is not a member of that request.

| Capability | O | P | A | ADM |
|---|---|---|---|---|
| Create a new request (and become its owner) | any active user | | | |
| View a request | ✔ | ✔ | ✔ | ✔ (read) |
| Edit / submit / cancel the request | ✔ | – | – | ✔ |
| Add / remove participants and approvers | ✔ | – | – | ✔ (never themselves as approver) |
| Confirm/decline own participation | – | ✔ | – | – |
| Update own task status | if assignee | ✔ | – | ✔ |
| Update checklist | ✔ | ✔ | – | ✔ |
| Post execution updates | ✔ | ✔ | – | ✔ |
| Record validation | ✔ | ✔ | – | ✔ |
| Approve / reject | ✗ (own request) | ✗ (participant) | ✔ (current round, eligible) | ✗ unless assigned as A |
| Generate / save AI report | ✔ | – | – | ✔ |
| Close activity | ✔ | – | – | ✔ |
| Manage users, org groups, templates | – | – | – | ✔ |

A person never holds two activity roles in the same request, so there is no "union" inside a request. Self-approval is impossible by construction and is checked again on every decision, including for platform admins.

---

## 7. Non-functional notes [REC]
- Throttling: API Gateway usage plan; return `429` with `Retry-After`.
- Payload limit: JSON bodies up to 1 MB (API Gateway limit is 10 MB; Lambda sync limit 6 MB). Files only via S3.
- Long operations (AI summary, export) are asynchronous: `202` then poll the resource.
- All state-changing calls write an audit item.
- Logs never contain tokens, file contents or full descriptions.

## 8. Assumptions made in this document
1. REST API (not HTTP API) and `/v1` versioning. [REC]
2. Roles are activity-scoped; organization groups are only `PlatformAdmin` and `ApprovalEligible`. **Decided in TASK 04a** (closes OPEN 5 for roles).
3. Responsible employee for the AI report is the request owner. [OPEN 1]
4. Reject requires a comment; approve takes an optional one. **Decided in TASK 04a** (closes OPEN 3 together with §12.2).
5. Participants are platform users. [OPEN 4]
6. Polling is acceptable for notifications. [REC]
7. Request lifecycle as in `backend-architecture.md` §3.2. [REC / OPEN 2]
8. `category` and `priority` are retained from the visual reference until the taxonomy is confirmed. [OPEN 8]
9. Execution tracking and closure endpoints are minimal proposals because SOW 4.7 and 4.10 contain headings only. [OPEN 1]

## 9. Not covered
Cognito hosted UI/sign-up flows, WebSocket/real-time, presence, multi-tenant `orgId` routing [OPEN 6], search engine, file virus scanning, infrastructure-as-code.

## 10. Known limitation to decide
"Showing 1-5 of 12" and free-text search by title are awkward in DynamoDB (see `database-design.md` access pattern 10). Options: (a) cursor pagination without exact totals plus counts from aggregates, (b) filter within bounded queries, (c) add a search service later. Needs your decision.

## 11. Implementation status (steps 1-2, `backend/`; items marked "04a" superseded by §12)

| Area | Endpoints implemented |
|---|---|
| Current user | `GET /me`, `PATCH /me` |
| Requests | `GET /requests`, `POST /requests`, `GET /requests/counts`, `GET /requests/{id}`, `PATCH /requests/{id}` |
| Attachments | `GET`/`POST /requests/{id}/attachments`, `POST .../{attachmentId}/confirm`, `GET .../{attachmentId}/download-url`, `DELETE .../{attachmentId}` |
| Dashboard | `GET /dashboard/summary`, `GET /dashboard/requests-over-time`, `GET /dashboard/upcoming` |
| Reference | `GET /reference-data` |

TASK 04a added: `GET /users`, `GET`/`POST /requests/{id}/members`, `DELETE /requests/{id}/members/{userId}`, `POST /requests/{id}/submit`, `POST /requests/{id}/withdraw` (added after the review), `POST /requests/{id}/approvals/decision`, `GET /requests/{id}/approvals`, `GET /approvals`, `GET /approvals/summary` (see §12).

Everything else in section 3 is still design only (transition/cancel/archive, tasks, checklist, execution, validation, reports, notifications, schedule/conflicts, users admin, team, bulk decisions).

Behaviour that differs from, or narrows, the text above:

1. **Token**: send the Cognito **ID token** in `Authorization` (it carries `email`, `name`, `cognito:groups`). The API Gateway authorizer is a Cognito user pool authorizer.
2. **Visibility** *(04a)*: ACTIVE members of the request (owner, participants, approvers) and platform admins. A request you cannot see returns `404`, not `403`.
3. **`POST /requests`** creates a `DRAFT` and requires `title` and `description`; all other fields are optional until the mandatory set is decided (open question 8). *(04a)* Any authenticated user may create and becomes the `OWNER` member. `Idempotency-Key` is accepted by CORS but **not implemented yet**.
4. **`PATCH /requests/{id}`** requires the current `version`; allowed only in `DRAFT` and `REJECTED` (otherwise `400 INVALID_TRANSITION`). A stale `version` returns `409 VERSION_CONFLICT`.
5. **`GET /requests`** *(04a)*: without `mine`, non-admins get every request they are an ACTIVE member of (any role), newest first; platform admins get all requests. `mine=owner` reads the owner index; `mine=participant` / `mine=approver` read the membership index for that role. No `totalCount` is returned (section 10, option a). `q` matches title or request number, case-insensitive.
6. **`GET /requests/counts`** *(04a)*: same scope as the list. Admins without `mine` read stored aggregates; everyone else gets counts computed from their memberships (capped at 2,000). **`/dashboard/summary`** with `scope=mine` still counts only requests the caller **owns**.
7. **`/dashboard/*` `scope=all`** *(04a)*: `PlatformAdmin` only. The former global `Approver` group no longer exists.
8. **Attachments**: allowed extensions pdf, doc, docx, xls, xlsx, png with a matching content type, max 10 MB. These come from the hint text on the New Request screen, not from the SOW (open question 7). Upload URL lifetime 300 s. Only the request owner or an admin can add files for now. *(Fix after the 04a review)* Uploading, confirming and deleting attachments are **locked** while the request is `PENDING_APPROVAL`, `COMPLETED` or `CANCELLED` (`409 ATTACHMENTS_LOCKED`). The status is checked inside the same transaction as the write, so the plan under review cannot change.
9. **`/reference-data`** returns only known values: categories and priorities from the UI reference, teams and checklist groups from the SOW. `environments`, `cloudPlatforms` and `maintenanceTypes` are empty until you approve the lists, so those request fields accept free text.
10. **Status mapping**: "In Progress" on the dashboard counts `IN_PROGRESS`, `READINESS` and `VALIDATION`.

## 12. Activity-scoped roles and approvals (TASK 04a, implemented in `backend/`)

Not deployed. Verified locally with a type check, `cdk synth` and a rules test of the authorization and outcome logic (no AWS calls).

### 12.1 Identity, directory and members

- **Org-level groups (Cognito):** `PlatformAdmin` and `ApprovalEligible` only. They are mirrored on sign-in (`GET /me`) as `USER#<id> / ROLE#<group>`, and stale mirrors are deleted on the next sign-in. `GET /me` → `roles` contains only these groups.
- **Directory `GET /users`** *(privacy fix after the 04a review)*:
  - Results are `{ id, displayName, initials, approvalEligible }` only. **No email addresses** are returned to anyone.
  - `q` is required with at least 2 characters (`400` otherwise), so the whole directory cannot be listed.
  - Search is a case-insensitive name prefix, or an exact email when `q` contains `@`. An email match is returned in the same minimal shape; the address is not echoed.
  - `approverEligible=true` lists only `ApprovalEligible` users.
  - Users appear **after their first sign-in**; admin user creation is not implemented.
- **Members:** one record per (request, user). The creator is written as `OWNER` in the same transaction as the request.

`POST /requests/{id}/members` checks, in this order (first failure wins):

| Check | Error |
|---|---|
| Caller is the request's `OWNER` or a `PlatformAdmin` | `403 FORBIDDEN` |
| Request is not `COMPLETED` / `CANCELLED` | `409 INVALID_STATE` |
| Request is not `PENDING_APPROVAL` (all assignments locked while pending) | `409 LOCKED_WHILE_PENDING` |
| Approvers only change in `DRAFT` / `REJECTED` | `409 APPROVERS_LOCKED` |
| Target has a profile (signed in once) | `404 USER_NOT_FOUND` |
| Target is active | `409 USER_INACTIVE` |
| Target is not already an ACTIVE member | `409 ALREADY_ASSIGNED` (same role) / `409 ROLE_CONFLICT` (other role: owners and participants can never be approvers of that request) |
| Approver ≠ owner | `409 ROLE_CONFLICT` |
| Nobody, platform admins included, assigns **themselves** as approver | `403 SELF_ASSIGNMENT_FORBIDDEN` |
| Approver is in `ApprovalEligible` | `409 NOT_ELIGIBLE` |
| At most 20 approvers / 50 members | `409 APPROVER_LIMIT` / `409 MEMBER_LIMIT` |

- **Removal** is soft: status `REMOVED`, with removed-by snapshot. The record stays for history. The owner cannot be removed (`400 CANNOT_REMOVE_OWNER`), and the same lock rules apply.
- **Concurrency:** every member change increments the request's internal `membersRev` under the same lock condition, inside one transaction. A concurrent submit or status change makes the change fail with `409 CONCURRENT_UPDATE` instead of silently altering a round.
- **`GET /requests/{id}`** now also returns `viewer: { activityRole, canEdit, canManageMembers }` for the UI. The backend re-checks on every call.

### 12.2 Submit, decide, history

**Submit** (`POST /requests/{id}/submit`, `{ version }`):
- Allowed for the owner or an admin, from `DRAFT` / `REJECTED`, with at least 1 and at most 20 ACTIVE approvers.
- Each approver must still be active and `ApprovalEligible`, otherwise `409 APPROVER_INVALID` with details.
- One transaction does all of the following:
  - the request becomes `PENDING_APPROVAL` with `approvalRound + 1`;
  - a round header `APPRROUND#<n>` is written;
  - one decision record per approver `APPR#<n>#<approverId>` (`PENDING`, snapshot names, inbox index) is written;
  - the audit entry `SUBMITTED_FOR_APPROVAL` and the status counters are written.
- Condition: unchanged `version`, unchanged `membersRev` (exact approver snapshot), status still `DRAFT`/`REJECTED`.

**Decide** (`POST /requests/{id}/approvals/decision`). The caller must pass **all** of these checks. There is **no exception for platform admins**.

| Check | Error |
|---|---|
| Request is `PENDING_APPROVAL` | `409 NOT_PENDING` |
| Caller is not the request owner | `403 SELF_APPROVAL` |
| Caller is not a participant of this request | `403 SELF_APPROVAL` |
| Caller is an ACTIVE `APPROVER` member with a record in the **current** round | `403 NOT_ASSIGNED` |
| Caller's token has `ApprovalEligible` (revocation takes effect within the 1 h token lifetime) | `403 NOT_ELIGIBLE` |
| Caller's record is still `PENDING` | `409 ALREADY_DECIDED` |

Outcomes:

| Policy | Decision | Result |
|---|---|---|
| `ANY_ONE` (default) | approve (also after earlier rejections) | Request `APPROVED` at once; round `APPROVED`; remaining `PENDING` records `NOT_REQUIRED` (`closedReason = APPROVED_BY_OTHER`). Earlier `REJECTED` records stay as recorded. |
| `ANY_ONE` | reject (comment required), other approvers still pending | Rejection recorded; request **stays `PENDING_APPROVAL`**; round stays `OPEN`; no counters change; other records untouched |
| `ANY_ONE` | reject (comment required), every other approver already rejected | Request `REJECTED` (editable again); round `REJECTED` |
| `ALL` | approve, others still pending | Stays `PENDING_APPROVAL`; round `OPEN` |
| `ALL` | approve, everyone else approved | Request `APPROVED` |
| `ALL` | reject (comment required) | Request `REJECTED` (editable again); other pending records `NOT_REQUIRED` |

- **Concurrency:** every decision rewrites the request under a version condition, so decisions on one request are serialised. If two approvers decide at the same moment, the server re-reads and retries (up to 3 attempts), which guarantees that the last `ALL` approval completes the round. The client therefore does not send a `version`. After 3 conflicts the call returns `409 CONCURRENT_UPDATE`.
- **Strongly consistent reads** *(fix after the 04a review)*: submit, decide and withdraw read the request, the caller's membership, the members and the round records with `ConsistentRead`. Before this fix, a fresh request version combined with stale decision records could commit a non-final `ALL` approval after everyone had approved, leaving the request pending.
- **Record updates alias every attribute name** *(fix after the 04a review)*: `comment` is a DynamoDB reserved word, and the raw name made every rejection fail.

**Withdraw** (`POST /requests/{id}/withdraw`, `{ reason, version }`). This is the recovery path when a round cannot finish: an approver left the organization, lost eligibility, or never answers.
- **Who and when:** the owner or a platform admin, only while `PENDING_APPROVAL`, with a current `version` and a non-empty reason.
- **One transaction** (at most 25 items):
  - the request returns to `DRAFT` with `approvalState = WITHDRAWN`, `withdrawnAt`, `withdrawnBy` and `withdrawReason`;
  - the round header becomes `WITHDRAWN`;
  - every still-pending record becomes `NOT_REQUIRED` (`closedReason = WITHDRAWN`); decisions already made stay as they are;
  - the audit entry `REQUEST_WITHDRAWN` and the status counters are written.
- **Afterwards:** approvers can be changed and the request resubmitted as a new round. Nothing in the old round is reassigned or edited.
- **Errors:** `403 FORBIDDEN`, `409 NOT_PENDING`, `409 VERSION_CONFLICT`, `409 CONCURRENT_UPDATE` (a decision happened at the same time).
- **Non-final decisions** (an `ALL` approval with others pending, or an `ANY_ONE` rejection with others pending) still rewrite the request with `version + 1` under the version condition. This serialises concurrent decisions: when two approvers make the last two decisions at once, one transaction fails and its retry reads the other's committed decision, so a round can never stay open after its outcome is determined.
- **While an `ANY_ONE` round is open after a rejection:**
  - The rejecting approver sees their record under `GET /approvals?decision=REJECTED` (with `requestStatus: PENDING_APPROVAL`), and their counts include it.
  - The owner sees the rejection and its comment in `GET /requests/{id}/approvals`.
  - The owner cannot edit while the request is pending; to act on the feedback before others decide, the owner withdraws, edits and resubmits.
- **Resubmission** after rejection starts round `n + 1`. Earlier rounds and their records are kept unchanged.
- **Inbox** (`GET /approvals`): only the caller's own records. `canDecide` / `blockedReason` reuse the decision checks; they are UI hints only.
- **History** (`GET /requests/{id}/approvals`): all rounds with approvers, decisions, comments and times.

### 12.3 Platform admin rules (decision 5)
- May view all requests, list all requests and manage members on any request.
- Cannot assign **themselves** as approver.
- Cannot approve unless explicitly assigned by someone else **and** `ApprovalEligible`.
- Cannot approve a request they own or participate in.

### 12.4 Audit (append-only, under the request)
Actions: `REQUEST_CREATED`, `REQUEST_UPDATED`, `MEMBER_ADDED`, `MEMBER_REMOVED`, `APPROVER_ASSIGNED`, `APPROVER_REMOVED`, `SUBMITTED_FOR_APPROVAL`, `APPROVAL_DECIDED`.

Every entry stores:
- the actor id, a snapshot of the actor's name, and their activity role at that moment (`OWNER`, `PARTICIPANT`, `APPROVER` or `PLATFORM_ADMIN`);
- the target user, name snapshot and activity role where relevant;
- the round, policy, decision and comment where relevant;
- a timestamp.

Audit entries, round headers and decision records are never deleted.

### 12.5 Not implemented in 04a
- Step Functions workflow, notifications and reminders.
- Scheduling-conflict check on submit.
- Approval groups (data model only, `database-design.md` 3.6).
- Bulk decisions.
- Admin user creation and org-group management in the app (use the Cognito console or CLI).
- Reassigning approvers inside an open round (by design: withdraw, change approvers, resubmit).
- Participant invitation responses.
- `PATCH /members/{userId}`.

These features have no UI yet (that is TASK 04b).

### 12.6 Review fixes and tests (after the TASK 04a review)

| Finding | Fix |
|---|---|
| C1: rejections failed (`comment` is a reserved word) | All decision-record attribute names are aliased (`decisionRecordUpdate` in `lib/approvals.ts`) |
| C2: stale reads could leave an `ALL` round pending, or drop an approver from a submit snapshot | Strongly consistent reads on submit, decide and withdraw |
| I7: no recovery for a stuck round | `POST /requests/{id}/withdraw` (§12.2) |
| I5: attachments could change during approval | Locked while pending, completed or cancelled (§11 item 8) |
| I3: directory exposed emails | No email in results; `q` must be at least 2 characters (§12.1) |
| I6: role-mirror writes could be dropped | Unprocessed batch writes are retried; after 5 attempts the call fails with `503` |
| Minor: stale `approvalDecidedAt` after resubmission | Cleared on submit |
| Minor: a foreign `nextToken` caused a `500` | `400 Invalid nextToken` when the token's key does not belong to the queried partition |

**Tests:** `npm test` in `backend/` (`node:test` + `tsx`, no extra packages, no AWS). The suite covers:
- the pure rule functions;
- handler flows against an in-memory fake of the DynamoDB client: submit, decide (ANY_ONE and ALL, retries), withdraw, members, the attachment lock, directory privacy, continuation-token checks and batch-write retry;
- a lint that fails if any expression sent by a handler uses a reserved word without an alias;
- a check that approval transitions only use consistent reads.

The fake does **not** evaluate conditions or apply transaction writes, so real DynamoDB behaviour is still unverified until deployment.

**ANY_ONE rule (decided after the review):** one approval approves; the request is rejected only when every assigned approver has rejected (§12.2). Tests cover mixed decisions, multiple approvers, single approvers, double decisions and three concurrency cases:
- a concurrent last rejection: the retry rejects the request;
- a concurrent approval: the rejection gets `409 NOT_PENDING`;
- a rejection racing an approval: the retry approves.

**Still open:** stale eligibility for departed users (review item 2; withdraw is the recovery path).
