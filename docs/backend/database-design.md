# Mue'ad Database Design (DynamoDB) – Proposal

Status: **design only. No tables have been created.** Labels: **[SOW]**, **[FE]**, **[REC]**, **[OPEN]** as in `backend-architecture.md`.

SOW 5.4 says DynamoDB stores "maintenance requests, user information, assignments, approvals, tasks, and activity records" and S3 stores supporting documents and generated reports.

## 1. Approach

- **Single-table design** [REC] named `muead-main` (name not final). All entities below are item types in one table, distinguished by `entityType`. This makes "get a request with everything under it" one `Query`.
- **On-demand capacity**, PITR on, KMS encryption [REC].
- **IDs**: ULIDs (sortable by time) for requests, tasks, etc. Human-friendly request number `REQ-0001` is stored separately as `requestNo` (generated from an atomic counter item). The UI shows IDs like `REQ-0142`. [FE]
- **Timestamps**: ISO-8601 UTC strings (`createdAt`, `updatedAt`).
- **Optimistic locking**: `version` number on mutable items.
- **Large content** (attachments, reports) lives in S3; DynamoDB stores metadata and the S3 key.
- **Multi-tenancy [OPEN]**: if more than one organization shares a deployment, prefix every PK with `ORG#<orgId>#`. Keys below omit this.
- Single-table is a recommendation; separate tables per entity is a valid alternative if the team prefers simplicity. I would confirm before implementation.

## 2. Key conventions

| Attribute | Meaning |
|---|---|
| `PK`, `SK` | Table key |
| `GSI1PK`, `GSI1SK` | Inverted / per-user views |
| `GSI2PK`, `GSI2SK` | Status / schedule views |
| `GSI3PK`, `GSI3SK` | Assignee / approver inbox |
| `entityType` | `USER`, `REQUEST`, `PARTICIPANT`, ... |
| `version` | Optimistic lock |

## 3. Entities

### 3.1 User [SOW: user information]
`PK=USER#<userId>`  `SK=PROFILE`  (`userId` = Cognito `sub`)

| Attribute | Notes |
|---|---|
| `email`, `displayName`, `initials` | Frontend shows name + initials avatar [FE] |
| `roles` | *(Revised in TASK 04a.)* Organization-level groups only: `PlatformAdmin`, `ApprovalEligible`. Not stored as a set on the profile; mirrored as `ROLE#<group>` items (see section 8). They never grant authority inside an activity; activity roles live in 3.4. |
| `teamSpecialties` | Set: `Cloud`, `Database`, `Application`, `OS`, `SecurityNetwork` [SOW 2]; need confirmation [OPEN] |
| `status` | `ACTIVE`, `DISABLED`, `INVITED` |
| `notificationPrefs` | Map, e.g. `{ email: true }` [REC] |
| `createdAt`, `lastLoginAt` | |

GSI1: `GSI1PK=EMAIL#<email lowercase>`, `GSI1SK=USER` (lookup when inviting by email).
GSI2 (directory, 04a): the profile has `GSI2PK=DIRECTORY`, `GSI2SK=<lowercase displayName>#<userId>` (name prefix search). Org-group mirror items `USER#<id> / ROLE#<group>` have `GSI2PK=ROLE#<group>` and the same `GSI2SK` (for example, list `ApprovalEligible` users), plus a name/email snapshot.
The "online" dots in the team list [FE] are not stored. [OPEN 17]

### 3.2 Maintenance Request [SOW 4.2]
`PK=REQ#<requestId>`  `SK=META`

| Attribute | Notes |
|---|---|
| `requestNo` | `REQ-0142` style, unique via counter item |
| `title`, `description` | [FE] |
| `environment` | e.g. Production / Staging [SOW]; values [OPEN] |
| `cloudPlatform` | [SOW]; values [OPEN] |
| `affectedSystems` | List of strings [SOW] |
| `maintenanceType` | [SOW]; values [OPEN] |
| `scope` | Text [SOW] |
| `scheduleStart`, `scheduleEnd`, `timezone` | [SOW: schedule]. UI has a single "target date" today [FE] |
| `category`, `priority` | [FE] (Equipment/Facilities/IT/…; High/Medium/Low). Keep only if confirmed [OPEN] |
| `status` | See lifecycle in architecture doc §3.2 |
| `ownerId` | Maintenance Owner |
| `links` | List of `{label, url}` [SOW: links] |
| `conflictFlags` | List of conflicting `requestId`s (computed) [SOW 4.4] |
| `approvalState` | `NONE`, `PENDING`, `APPROVED`, `REJECTED`, `WITHDRAWN` (denormalized from approvals) |
| `withdrawnAt`, `withdrawnBy`, `withdrawReason` | Set by withdraw; cleared on the next submit |
| `approvalPolicy` | *(04a)* `ANY_ONE` (default) or `ALL` |
| `approvalRound` | *(04a)* Current round number; `0` = never submitted |
| `submittedAt`, `submittedBy`, `approvalDecidedAt` | *(04a)* Last submission / final decision |
| `membersRev` | *(04a, internal)* Incremented by every member change. Submit requires it unchanged, so the approver snapshot is exact |
| `executionToken` | Step Functions execution ARN / task token reference [REC] |
| `createdAt`, `updatedAt`, `closedAt`, `version` | |

GSIs:
- GSI1 (owner view): `GSI1PK=OWNER#<ownerId>`, `GSI1SK=<createdAt>#<requestId>`
- GSI2 (status/schedule list): `GSI2PK=STATUS#<status>`, `GSI2SK=<scheduleStart>#<requestId>`
- GSI3 (calendar / conflict window): `GSI3PK=SCHED#<yyyy-mm>`, `GSI3SK=<scheduleStart>#<requestId>`. An activity spanning months is written under each month (extra items `SK=SCHEDIDX#<yyyy-mm>`) [REC].

### 3.3 Attachment (documents) [SOW 4.2, 5.4]
`PK=REQ#<id>`  `SK=ATT#<attachmentId>`
`fileName`, `contentType`, `sizeBytes`, `s3Key`, `uploadedBy`, `uploadedAt`, `status` (`PENDING_UPLOAD`, `AVAILABLE`). Links are on the request item (above). Limits [OPEN 7].

### 3.4 Activity member: owner, participant, approver [SOW 2, 4.3, 4.5] (revised and implemented in TASK 04a)
`PK=REQ#<id>`  `SK=MEMBER#<userId>`. This replaces the earlier `PART#<userId>` design.

| Attribute | Notes |
|---|---|
| `activityRole` | `OWNER`, `PARTICIPANT` or `APPROVER`, **in this request only** |
| `status` | `ACTIVE` or `REMOVED` (soft remove; the item is never deleted) |
| `displayName`, `initials` | Snapshot at assignment |
| `specialty`, `responsibilities` | Participants (specialty from SOW teams) |
| `assignedBy`, `assignedByName`, `assignedByRole`, `assignedAt` | Who assigned, with their activity role (`OWNER` / `PLATFORM_ADMIN`) |
| `removedBy`, `removedByName`, `removedByRole`, `removedAt` | Set on removal |
| `inviteStatus`, `respondedAt`, `declineReason` | Participant confirmation (design only, not built) |

- **One role per person per request.** Because the key is (request, user), a person cannot be approver **and** owner or participant of the same request. That makes self-approval structurally impossible; the decision endpoint checks it again.
- **Different roles in different requests.** `REQ#A/MEMBER#sara=APPROVER`, `REQ#B/MEMBER#sara=PARTICIPANT` and `REQ#C/MEMBER#sara=OWNER` are independent items.
- **GSI1 (my activities):** `GSI1PK=MEMBER#<userId>`, `GSI1SK=<request createdAt>#<requestId>` (newest first). Removal deletes the GSI1 attributes, so removed memberships drop out of "my activities" while the item stays for history. The list resolves request data with a batched `GetItem`, so there is no denormalized copy that could go stale.
- **Caps:** 20 approvers and 50 members per request.
- Invited persons without an account: [OPEN 4].

### 3.5 Task [SOW 4.3]
`PK=REQ#<id>`  `SK=TASK#<taskId>`
`title`, `description`, `assigneeType` (`USER` or `TEAM`), `assigneeId` (userId or team name), `dueAt`, `status` (`TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`), `order`, `createdBy`, `completedAt`, `version`.
GSI3 (my tasks): `GSI3PK=ASSIGNEE#<assigneeId>`, `GSI3SK=<status>#<dueAt>#<taskId>`.

### 3.6 Approval [SOW 4.5] (revised and implemented in TASK 04a)
Authority comes from the request's `APPROVER` members (3.4), never from a global group. Approvers must also be in the `ApprovalEligible` Cognito group. Eligibility only allows assignment.

The approval items are:

- **Round header:** `PK=REQ#<id>`  `SK=APPRROUND#<round, 4 digits>`
  - `policy` (`ANY_ONE` / `ALL`), `status` (`OPEN`, `APPROVED`, `REJECTED`, `WITHDRAWN`), `withdrawReason`;
  - `approverIds`, `approverCount`;
  - `submittedAt`, `submittedBy`, `submittedByName`, `submittedByRole`;
  - `decidedAt`, `decidedBy`.
- **Decision record** (one per assigned approver per round): `PK=REQ#<id>`  `SK=APPR#<round>#<approverId>`
  - `approverName`, `approverInitials` (snapshot), `activityRole` (`APPROVER`);
  - `decision` (`PENDING`, `APPROVED`, `REJECTED`, `NOT_REQUIRED`);
  - `comment` (required on reject), `decidedAt`, `decidedBy`, `decidedByName`;
  - `closedReason` (`APPROVED_BY_OTHER` / `REJECTED_BY_OTHER` / `WITHDRAWN`) and `closedBy` for records closed as `NOT_REQUIRED`;
  - a snapshot of the request fields shown in the inbox: `requestNo`, `title`, `description` (300 chars), `category`, `priority`, `requestedBy` (owner), `submittedAt`.
- **GSI3 (personal inbox):** `GSI3PK=APPROVER#<approverId>`, `GSI3SK=<decision>#<submittedAt>#<requestId>`. A decision rewrites `GSI3SK`, so each tab is a `begins_with` query. KPI counts use `Select=COUNT` on the same index; there are no stored approval counters to drift.
- **History:** all rounds stay forever. A resubmission after rejection creates round `n + 1`. Step Functions `taskToken` is not used (deferred).

**Future approval groups** (data model only, not implemented):
- `PK=AGROUP#<groupId>  SK=META` holds `name`, `description`, `createdBy`, `createdAt`.
- `PK=AGROUP#<groupId>  SK=MEMBER#<userId>` holds the group membership, with a name snapshot and `addedBy` / `addedAt`.
- A request would reference groups as `approverGroupIds`. Submit would **expand** each group into individual `APPROVER` members and decision records, tagging each record with `viaGroupId`. Audit and authority therefore always name actual people, and later group edits never change an open round.
- Eligibility and the self-approval rules apply per expanded person.

### 3.7 Readiness checklist [SOW 4.6]
`PK=REQ#<id>`  `SK=CHK#<itemId>`
`group`, one of: `BACKUP`, `ACCESS`, `FIREWALL_CONNECTIVITY`, `TEAM_AVAILABILITY`, `APP_DEPENDENCIES`, `DOCUMENTATION` [SOW], `label`, `required` (bool), `status` (`PENDING`, `READY`, `NOT_READY`, `N/A`), `note`, `updatedBy`, `updatedAt`, `version`.
Default items are created from a template when the request enters the readiness phase. Template content is [OPEN]; I propose to store the template as `PK=TEMPLATE#READINESS`, `SK=<order>`.

### 3.8 Execution update [SOW 4.7 – details missing]
`PK=REQ#<id>`  `SK=EXEC#<timestamp>#<updateId>`
`type` (`STATUS_CHANGE`, `PROGRESS_NOTE`, `ISSUE`, `TASK_UPDATE`), `message`, `taskId` (optional), `issueSeverity` (optional), `authorId`, `createdAt`. Append-only. Fields beyond this are [OPEN 1].

### 3.9 Validation result [SOW 4.9]
`PK=REQ#<id>`  `SK=VAL#<domain>`  with `domain` in `APPLICATION`, `DATABASE`, `OPERATING_SYSTEM`, `INFRASTRUCTURE` ("as applicable", so items exist only for relevant domains).
`result` (`PASSED`, `FAILED`, `PASSED_WITH_ISSUES`, `NOT_APPLICABLE`), `notes`, `confirmedBy`, `confirmedAt`, `version`.
Remaining issues: `PK=REQ#<id>`  `SK=ISSUE#<issueId>` – `description`, `severity`, `domain`, `status` (`OPEN`, `RESOLVED`), `reportedBy`, `createdAt`.

### 3.10 Notification [SOW 4.4, 5.5]
`PK=USER#<recipientId>`  `SK=NOTIF#<createdAt>#<notifId>`
`type` (`INVITATION`, `APPROVAL_REQUESTED`, `APPROVAL_DECIDED`, `TASK_ASSIGNED`, `REMINDER`, `CONFLICT_ALERT`, `REPORT_READY`, …), `title`, `body`, `requestId`, `channel` (`IN_APP`, `EMAIL`), `readAt` (null if unread), `emailStatus` (`SENT`, `FAILED`, `BOUNCED`), `ttl` (e.g. 180 days) [REC].
Unread count for the bell [FE]: query items with `readAt` absent, or keep an `unreadCount` on the user item updated by the stream [REC].

### 3.11 Report [SOW 4.8, 4.10, 5.4]
`PK=REQ#<id>`  `SK=REPORT#<reportId>`
`kind` (`AI_SUMMARY`, `FINAL`), `status` (`DRAFT`, `SAVED`), `s3Key`, `generatedAt`, `generatedBy`, `model` (Bedrock model ID), `inputRef` (what data was summarized), `reviewedBy`, `reviewedAt`, `editedText` flag.
The AI draft is only promoted to `SAVED` after the responsible employee reviews it [SOW]. Report body lives in S3; a short `preview` can be held in DynamoDB.
GSI2 for history/reporting: `GSI2PK=REPORT#<yyyy-mm>`, `GSI2SK=<generatedAt>#<reportId>`.

### 3.12 Aggregates (read models) [REC]
For dashboard and report numbers without scans:
- `PK=STATS#GLOBAL` (or per org / per user), `SK=STATUS#<status>` -> `count`.
- `PK=STATS#MONTH#<yyyy-mm>`, `SK=CATEGORY#<category>` -> `count`; and daily counts `SK=DAY#<yyyy-mm-dd>` for "Requests over time" [FE].
- Maintained by a DynamoDB Streams Lambda on request create/status change.
Alternative if volumes stay small: compute on demand with GSI2 queries.

### 3.13 Audit entry [REC]
`PK=REQ#<id>`  `SK=AUDIT#<timestamp>#<id>` – `actorId`, `action`, `before`, `after`, `ip`. Needed for approval history and compliance.

### 3.14 Counter
`PK=COUNTER#REQ`  `SK=SEQ` – atomic `ADD` to generate `requestNo`.

## 4. Relationships
```
User 1───* Request (owner)
Request 1───* Participant *───1 User
Request 1───* Task  *───1 User/Team
Request 1───* Approval (per round) *───1 User (approver)
Request 1───* Checklist item
Request 1───* Execution update
Request 1───* Validation result / Issue
Request 1───* Attachment (S3)
Request 1───* Report (S3)
User 1───* Notification
```
All child items share the request's partition (`PK=REQ#<id>`), so one `Query PK=REQ#<id>` returns the full activity. For very large activities, fetch by `begins_with(SK, 'TASK#')` etc.

## 5. Access patterns

| # | Pattern | Screen | Query |
|---|---|---|---|
| 1 | Get user profile by id | all | `GetItem USER#id / PROFILE` |
| 2 | Find user by email | invite | GSI1 `EMAIL#…` |
| 3 | Directory search / eligible approvers (pickers) | assign | GSI2 `DIRECTORY` or `ROLE#ApprovalEligible`, `begins_with <name prefix>` *(04a)* |
| 4 | Create request, allocate `requestNo` | New Request | Counter + `PutItem` |
| 5 | Get request detail | Details | `GetItem REQ#id / META` |
| 6 | Get everything for a request | Details tabs | `Query PK=REQ#id` (filter by SK prefix) |
| 7 | List my requests (owner) | Requests | GSI1 `OWNER#id` |
| 8 | List requests I am a member of (any or one activity role) | Requests | GSI1 `MEMBER#id` (filter `status=ACTIVE`, optional `activityRole`), then batch `GetItem` of the requests *(04a)* |
| 8a | My activity role in a request (authorization) | every request call | `GetItem REQ#id / MEMBER#me` *(04a)* |
| 8b | Members of a request | Details | `Query REQ#id`, `begins_with MEMBER#` *(04a)* |
| 9 | List requests by status, ordered by schedule | Requests tabs, dashboard | GSI2 `STATUS#s` |
| 10 | Text search by title / id | Requests search | Not natively supported. Start with filtering inside a status/owner query; use OpenSearch only if needed [OPEN]. |
| 11 | Upcoming activities (next N days) | Dashboard, Schedule | GSI3 `SCHED#yyyy-mm` range |
| 12 | Scheduling conflicts for a window | Create/edit, dashboard | GSI3 range over months, then overlap check (and shared `affectedSystems`) in Lambda |
| 13 | My approvals by decision (+ counts) | Approvals | GSI3 `APPROVER#me`, `begins_with <DECISION>#`; counts with `Select=COUNT` *(04a)* |
| 14 | Approval history of a request | Details > Approvals | `Query REQ#id`, `begins_with APPR` (round headers `APPRROUND#` + records `APPR#`) *(04a)* |
| 14a | Records of the current round (decision) | decide | `Query REQ#id`, `begins_with APPR#<round>#` *(04a)* |
| 15 | My tasks | Dashboard | GSI3 `ASSIGNEE#id` |
| 16 | Tasks of a request | Details | `Query REQ#id`, `begins_with TASK#` |
| 17 | Checklist for a request | Details | `begins_with CHK#` |
| 18 | Activity feed for a request | Details > Activity | `begins_with EXEC#`, newest first |
| 19 | Validation results | Details | `begins_with VAL#` / `ISSUE#` |
| 20 | Notifications for the bell | Topbar | `Query USER#id`, `begins_with NOTIF#`, descending |
| 21 | Mark notification read | Topbar | `UpdateItem` |
| 22 | Dashboard KPIs, donut | Dashboard | `GetItem` on `STATS#…` |
| 23 | Requests over time | Dashboard | `Query STATS#…`, `begins_with DAY#` |
| 24 | Requests by category | Dashboard | `Query STATS#MONTH#…` |
| 25 | Maintenance history (date range, filters) | Reports | GSI2 by status `COMPLETED` and date; additional filters in Lambda |
| 26 | List reports by month | Reports | GSI2 `REPORT#yyyy-mm` |

Dashboard totals in the UI ("12 total") should come from real aggregates, not the list length. [FE]

## 6. S3 layout (not a table, for completeness)
- `attachments/<requestId>/<attachmentId>/<filename>`
- `reports/<requestId>/<reportId>.<ext>`
- Private bucket, KMS, versioning on, lifecycle rules [OPEN: retention].

## 7. Open design questions
- Multi-tenant key prefix. [OPEN 6]
- Single table vs multiple tables.
- Search requirement for requests (title/ID substring). Needs a decision before choosing between filter-in-Lambda and OpenSearch.
- Whether activities may be reopened after closure (affects immutability of reports and audit).
- Data retention and deletion policy. [OPEN 12]
- Whether participants are users only. [OPEN 4]

## 8. Implementation notes (steps 1-2, `backend/`)

Differences between this design and the code written so far. The design above stays the target.

- **Table name** is `muead-<env>-main` (for example `muead-dev-main`). Three GSIs (`GSI1`, `GSI2`, `GSI3`), all projecting all attributes. KMS customer-managed key, PITR on, on-demand billing, retained on stack deletion.
- **Org-level groups** *(revised 04a)*: only `PlatformAdmin` and `ApprovalEligible`. They are mirrored as one item per group: `PK=USER#<id>`, `SK=ROLE#<group>`, `GSI2PK=ROLE#<group>`, `GSI2SK=<lowercase displayName>#<id>`, with a name/email snapshot. They are synced from the token on `GET /me`; stale mirrors (including any `ROLE#MaintenanceOwner` / `TechnicalParticipant` / `Approver`) are deleted on the next sign-in. Consequence: a group change made in Cognito shows up in directory searches only after that user signs in again. Decisions use the live token claim instead.
- **Statistics** are written in the same transaction as the request write (not by a stream Lambda). Items: `STATS#GLOBAL / STATUS#<status>`, `STATS#GLOBAL / CATEGORY#<name>`, `STATS#MONTH#<yyyy-mm> / DAY#<yyyy-mm-dd>`. The category count under `STATS#GLOBAL` was added to support "Requests by Category".
- **GSI3 (schedule)** only holds non-draft requests and indexes an activity under its **start month** only. Activities spanning months are not duplicated yet, so "upcoming" can miss an activity that started in an earlier month and is still running.
- **GSI2 sort** is `<scheduleStart or createdAt>#<id>`, so the admin "all requests" list is ordered by schedule within each status, not by creation date. The owner list (GSI1) is newest first.
- **Audit** items (`AUDIT#<timestamp>#<id>`) store the action and the names of changed fields, not full before/after values.
- **Attachments**: `s3Key` is `attachments/<requestId>/<attachmentId>/<fileName>`, and `status` moves from `PENDING_UPLOAD` to `AVAILABLE` only after the object is verified in S3.
- **Activity membership and approvals (04a)**: implemented as in 3.4 and 3.6. Creating a request also writes the creator's `OWNER` member item in the same transaction.
  - **Status counters:** submit and final decisions update them through `statsOnStatusChange`.
  - **Transaction limits:** submit and decision transactions are at most 25 items (request + round + ≤20 records + audit + 2 counters). A guard refuses anything above DynamoDB's limit of 100 before sending.
  - **Indexes:** no new GSI was needed; the new key prefixes reuse GSI1, GSI2 and GSI3. They were checked against every index write and query: no two entity types share a partition-key prefix.
  - **Consistency** *(review fix)*: submit, decide and withdraw use strongly consistent reads (request, membership, members, round records). Lists and inbox reads stay eventually consistent; index reads always are.
  - **Expression names** *(review fix)*: several stored attribute names are DynamoDB reserved words (`comment`, `status`, `count`, `timezone`). Every update, condition or filter expression must alias them through `ExpressionAttributeNames`. The test suite lints all expressions that the handlers send.
  - **Directory privacy** *(review fix)*: profiles and group mirror items still store `email` (needed for exact lookup), but no endpoint returns another user's email.
- **Not built yet**: tasks, checklist, execution updates, validation, notifications, reports, approval groups, participant invitation responses, and post-approval status transitions.
