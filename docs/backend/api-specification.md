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
- Roles come from the `cognito:groups` claim: `MaintenanceOwner`, `TechnicalParticipant`, `Approver`, `PlatformAdmin` [SOW §2].
- Whether a user may hold several roles: [OPEN 5]. The API assumes yes (groups are a list) and grants the union.
- Sign-in, sign-out, token refresh and password flows are done directly against Cognito (via the chosen client library [OPEN 18]); there are no `/login` endpoints in this API.

### 1.3 Authorization model [REC]
Two checks on every call: (1) **role** from the token, (2) **activity membership** for activity-scoped data.

Role abbreviations in the tables below:

| Code | Meaning |
|---|---|
| **O** | Maintenance Owner. For activity-scoped endpoints, only the owner of **that** request. |
| **P** | Technical Participant who is a **member of that request** (any invite status unless stated). |
| **A** | Approver. For activity-scoped endpoints, an approver **assigned to that request**. |
| **ADM** | Platform Administrator. Full access to all activities and administration. |
| **Any** | Any authenticated user (still limited to what they may see). |

Visibility (default, [REC] pending [OPEN 2, 3, 5]): a user sees a request if they are its owner, a participant, an assigned approver, or an admin. Admins see everything.

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
| GET | `/users` | Search users for pickers (invite, assign, approvers). Also feeds the Team list. [FE][SOW 4.3] | Query: `role?`, `specialty?`, `q?`, `limit`, `nextToken` | `200 { items:[{id, displayName, initials, email, roles[], teamSpecialties[], status}], nextToken }` | O, A, ADM (P: limited to members of their activities) |
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
| POST | `/requests` | Create a request as `DRAFT`. [FE New Request][SOW 4.2] | `{ title*, description*, environment, cloudPlatform, affectedSystems[], maintenanceType, scope, schedule:{start,end,timezone}, category?, priority?, links?[] }` (*required on the current form; others per SOW, mandatory level [OPEN 8]) | `201 Request` (+ `Location`) | O, ADM |
| GET | `/requests/{requestId}` | Request detail. [FE] | – | `200 Request` | O, P, A, ADM |
| PATCH | `/requests/{requestId}` | Edit fields. Allowed in `DRAFT` and `REJECTED`; after approval only by [OPEN 2]. | any subset of create fields + `version` | `200 Request` | O, ADM |
| POST | `/requests/{requestId}/submit` | Submit for approval: validates required fields, runs conflict check, starts the Step Functions approval workflow, notifies approvers. [SOW 4.5, 5.6] | `{ approverIds[], version }` (approver choice vs rule: [OPEN 3]) | `202 { status:"PENDING_APPROVAL", approvalRound, conflicts[] }` | O, ADM |
| POST | `/requests/{requestId}/transition` | Move through the post-approval lifecycle. Validates the target state and its preconditions (for example `READINESS` -> `IN_PROGRESS` only if required checklist items are `READY`; precondition rules [OPEN 2]). | `{ to: "SCHEDULED"\|"READINESS"\|"IN_PROGRESS"\|"VALIDATION"\|"COMPLETED", note?, version }` | `200 Request` | O, ADM (VALIDATION->COMPLETED: see closure §3.12) |
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

### 3.6 Participants and invitations [SOW 4.3]

| Method | Path | Purpose | Req | Res | Role |
|---|---|---|---|---|---|
| GET | `/requests/{requestId}/participants` | List participants with invite status. | – | `200 { items:[{userId, displayName, initials, specialty, responsibilities, inviteStatus, respondedAt}] }` | O, P, A, ADM |
| POST | `/requests/{requestId}/participants` | Invite team members. Sends in-app notification and email with activity details, responsibilities, scheduled time. [SOW 4.3, 5.5] | `{ invitations:[{ userId, specialty?, responsibilities }] }` (invite by email for non-users: [OPEN 4]) | `201 { items:[participant] }` | O, ADM |
| PATCH | `/requests/{requestId}/participants/{userId}` | Edit responsibilities. | `{ specialty?, responsibilities? }` | `200` | O, ADM |
| DELETE | `/requests/{requestId}/participants/{userId}` | Remove a participant (tasks must be reassigned first, else `409`). | – | `204` | O, ADM |
| POST | `/requests/{requestId}/participants/{userId}/resend` | Re-send invitation / reminder. | – | `202` | O, ADM |
| POST | `/requests/{requestId}/participants/me/response` | Invited member confirms or declines. [SOW "confirm their participation"] | `{ response:"CONFIRMED"\|"DECLINED", reason? }` | `200 participant` | P (self) |

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
| GET | `/approvals` | Approver inbox for the Approvals page: tabs Pending/Approved/Rejected, search. [FE] | Query: `decision=PENDING\|APPROVED\|REJECTED`, `q?`, `sort`, `limit`, `nextToken` | `200 { items:[{ approvalId, requestId, requestNo, title, description, requestedBy:{...}, category, priority, requestedAt, decision, decidedAt }], nextToken }` | A, ADM |
| GET | `/approvals/summary` | KPI cards (Pending / Approved / Rejected) and tab counts. [FE] | – | `200 { pending, approved, rejected }` | A, ADM |
| GET | `/requests/{requestId}/approvals` | Approval history and current status (Approvals tab). [SOW "track approval history"] | – | `200 { state, rounds:[{round, submittedAt, items:[{approver, decision, comment, decidedAt}]}] }` | O, P, A, ADM |
| POST | `/requests/{requestId}/approvals/decision` | Approve or reject, with comment. Resumes the Step Functions workflow (task token). [FE Approve/Reject buttons][SOW 4.5, 5.6] | `{ decision:"APPROVED"\|"REJECTED", comment?, version }` (comment required on reject: [REC], [OPEN 3]) | `200 { decision, requestStatus }`; `409 ALREADY_DECIDED` if not pending | A (assigned approver), ADM |
| POST | `/approvals/bulk-decision` | Decide several at once. [FE has row checkboxes but no bulk action UI; [REC] only if UI adds it] | `{ items:[{requestId, version}], decision, comment? }` | `207 { results:[{requestId, ok, error?}] }` | A, ADM |

Multiple approvers, sequential vs parallel, and what makes the request approved: [OPEN 3]. The API returns per-approver items so any model fits.

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
| Request details page | `GET /requests/{id}` (+ `/participants`, `/tasks`, `/approvals`, `/checklist`, `/attachments`, `/activity` for tabs) |
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

| Capability | O | P | A | ADM |
|---|---|---|---|---|
| Create/edit/submit/cancel own request | ✔ | – | – | ✔ |
| View a request | own | member | assigned | all |
| Invite participants, create/assign tasks | ✔ | – | – | ✔ |
| Confirm/decline own participation | – | ✔ | – | – |
| Update own task status | if assignee | ✔ | – | ✔ |
| Update checklist | ✔ | ✔ | – | ✔ |
| Post execution updates | ✔ | ✔ | – | ✔ |
| Record validation | ✔ | ✔ | – | ✔ |
| Approve / reject | – | – | ✔ (assigned) | ✔ |
| Generate / save AI report | ✔ | – | – | ✔ |
| Close activity | ✔ | – | – | ✔ |
| Manage users, roles, templates | – | – | – | ✔ |

If one person holds several roles, permissions are the union. Whether the owner can approve their own request is [OPEN 3]; the API should reject it by default [REC].

---

## 7. Non-functional notes [REC]
- Throttling: API Gateway usage plan; return `429` with `Retry-After`.
- Payload limit: JSON bodies up to 1 MB (API Gateway limit is 10 MB; Lambda sync limit 6 MB). Files only via S3.
- Long operations (AI summary, export) are asynchronous: `202` then poll the resource.
- All state-changing calls write an audit item.
- Logs never contain tokens, file contents or full descriptions.

## 8. Assumptions made in this document
1. REST API (not HTTP API) and `/v1` versioning. [REC]
2. Users may have multiple roles. [OPEN 5]
3. Responsible employee for the AI report is the request owner. [OPEN 1]
4. Reject requires a comment. [REC / OPEN 3]
5. Participants are platform users. [OPEN 4]
6. Polling is acceptable for notifications. [REC]
7. Request lifecycle as in `backend-architecture.md` §3.2. [REC / OPEN 2]
8. `category` and `priority` are retained from the visual reference until the taxonomy is confirmed. [OPEN 8]
9. Execution tracking and closure endpoints are minimal proposals because SOW 4.7 and 4.10 contain headings only. [OPEN 1]

## 9. Not covered
Cognito hosted UI/sign-up flows, WebSocket/real-time, presence, multi-tenant `orgId` routing [OPEN 6], search engine, file virus scanning, infrastructure-as-code.

## 10. Known limitation to decide
"Showing 1-5 of 12" and free-text search by title are awkward in DynamoDB (see `database-design.md` access pattern 10). Options: (a) cursor pagination without exact totals plus counts from aggregates, (b) filter within bounded queries, (c) add a search service later. Needs your decision.

## 11. Implementation status (steps 1-2, `backend/`)

| Area | Endpoints implemented |
|---|---|
| Current user | `GET /me`, `PATCH /me` |
| Requests | `GET /requests`, `POST /requests`, `GET /requests/counts`, `GET /requests/{id}`, `PATCH /requests/{id}` |
| Attachments | `GET`/`POST /requests/{id}/attachments`, `POST .../{attachmentId}/confirm`, `GET .../{attachmentId}/download-url`, `DELETE .../{attachmentId}` |
| Dashboard | `GET /dashboard/summary`, `GET /dashboard/requests-over-time`, `GET /dashboard/upcoming` |
| Reference | `GET /reference-data` |

Everything else in section 3 is still design only (submit/transition, approvals, participants, tasks, checklist, execution, validation, reports, notifications, schedule/conflicts, users admin, team).

Behaviour that differs from, or narrows, the text above:

1. **Token**: send the Cognito **ID token** in `Authorization` (it carries `email`, `name`, `cognito:groups`). The API Gateway authorizer is a Cognito user pool authorizer.
2. **Visibility** is currently owner or platform admin only. Participants and assigned approvers are added with those features. A request you cannot see returns `404`, not `403`.
3. **`POST /requests`** creates a `DRAFT` and requires `title` and `description`; all other fields are optional until the mandatory set is decided (open question 8). Only `MaintenanceOwner` and `PlatformAdmin` may create. `Idempotency-Key` is accepted by CORS but **not implemented yet**.
4. **`PATCH /requests/{id}`** requires the current `version`; allowed only in `DRAFT` and `REJECTED` (otherwise `400 INVALID_TRANSITION`). A stale `version` returns `409 VERSION_CONFLICT`.
5. **`GET /requests`**: `mine=participant` and `mine=approver` return `501 NOT_IMPLEMENTED` until those features exist. No `totalCount` is returned (section 10, option a). `q` matches title or request number, case-insensitive, within the already-selected partition.
6. **`GET /requests/counts`** and **`/dashboard/summary`**: platform admins read stored aggregates; other users get counts computed from their own requests (capped at 2,000).
7. **`/dashboard/*` `scope=all`** is allowed for `Approver` and `PlatformAdmin`. Note it returns global counts, which may be broader than what an approver can open; decide whether that is acceptable.
8. **Attachments**: allowed extensions pdf, doc, docx, xls, xlsx, png with a matching content type, max 10 MB. These come from the hint text on the New Request screen, not from the SOW (open question 7). Upload URL lifetime 300 s. Only the request owner or an admin can add files for now.
9. **`/reference-data`** returns only known values: categories and priorities from the UI reference, teams and checklist groups from the SOW. `environments`, `cloudPlatforms` and `maintenanceTypes` are empty until you approve the lists, so those request fields accept free text.
10. **Status mapping**: "In Progress" on the dashboard counts `IN_PROGRESS`, `READINESS` and `VALIDATION`.
