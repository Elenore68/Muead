# Mue'ad Backend Architecture (Task 01 – Analysis)

Status: **proposal, awaiting approval**. No backend code, AWS resources or deployments exist.

Labels used everywhere in the backend docs:

- **[SOW]** stated in `Cloud-Maintenance-Planner-SOW.pdf`.
- **[FE]** observed in the existing frontend code.
- **[REC]** my recommendation, not required by the SOW.
- **[OPEN]** missing information. I did not assume an answer.

Companion documents: `database-design.md` (data model), `api-specification.md` (REST API).

---

## 1. Existing frontend inspection [FE]

### 1.1 Stack
Vite 8, React 19, TypeScript 5.9, react-router-dom 7, lucide-react icons, `@fontsource/plus-jakarta-sans`. Plain CSS with design tokens. No state library, no HTTP client, no auth library, no test framework. Location: `frontend/`. Dev server on port 8002.
SOW 5.1 names AWS Amplify for hosting; nothing Amplify-specific exists in the project yet.

### 1.2 Pages and routes
| Route | File | State |
|---|---|---|
| `/` | `pages/Dashboard.tsx` | Mock, hard-coded numbers |
| `/requests` | `pages/Requests.tsx` | Mock list, working tab filter and text search |
| `/requests/new` | `pages/NewRequest.tsx` | Form with required-field check, submit does nothing but navigate |
| `/requests/:id` | `pages/RequestDetails.tsx` | Mock lookup by ID; only the Details tab exists |
| `/approvals` | `pages/Approvals.tsx` | Mock; Approve/Reject just remove the row |
| `/schedule`, `/reports`, `/team`, `/settings` | `pages/ComingSoon.tsx` | Placeholders (no design in the reference) |

Shared components: `Layout` (sidebar, team list, mobile drawer), `Topbar` (bell, user menu), `ui.tsx` (status/priority/category pills, avatars, tabs, pager, logo placeholder).

### 1.3 Static / mock data currently shown
From `src/data/mock.ts` and hard-coded JSX:

- **Team / current user**: Sara, Shahad, Amal; "Amal" is hard-coded as the logged-in user in `Topbar`; the sidebar Team list and "online" dots are static.
- **Requests** (5): `id, title, description, category, requestedBy, assignedTo, priority, status, created, targetDate`.
- **Approvals** (4): `id, title, description, requestedBy, category, priority, requestedOn`.
- **Schedule** (3 upcoming items), **requests-over-time** series (9 points), **requests-by-category** (4 bars).
- **Hard-coded counts**: dashboard KPIs (12 / 4 / 5 / 3), donut slices, request tab counts (computed from the 5 mock rows, so they do not match the dashboard's 12), approvals KPIs (4 / 8 / 2), approvals tab labels ("Pending (4)", "Approved (8)", "Rejected (2)"), pagination (1 page).
- **Notification bell**: always shows an unread dot; no panel exists.

### 1.4 User actions that need a backend
| # | Action in the UI | Today |
|---|---|---|
| 1 | Sign in / sign out / current user / user menu | Not implemented |
| 2 | Load dashboard KPIs, status split, schedule, trend, category split | Mock |
| 3 | List, filter by status, search, sort, paginate requests | Client-side on mock |
| 4 | Create request (title, description, category, priority, target date) | Navigates only |
| 5 | Upload attachments (dropzone, "PDF, DOC, XLS, PNG, max 10 MB") | Non-functional |
| 6 | Open request details | Mock lookup |
| 7 | Approve / Reject (list rows and detail page) | Local state only; no comment field |
| 8 | Bulk select on Approvals (checkboxes) | Visual only, no bulk action UI |
| 9 | "Generate Summary" (AI Activity Summary) | Button without handler |
| 10 | Notifications (bell) | Static dot |
| 11 | Row kebab menu, filter button, details-page menu, Activity / Approvals / Attachments tabs | Not implemented |
| 12 | Team list / presence | Static |

### 1.5 Gaps between the frontend and the SOW
The frontend follows the visual reference, which is a generic request tracker. The SOW describes a richer maintenance-planning product. The following SOW items have **no UI or data field today**:

- Request fields **environment, cloud platform, affected systems, maintenance type, scope, schedule (start/end)** (SOW 4.2). The form has title, description, category, priority, target date instead.
- **Links** as supporting material (SOW 4.2); only file upload is drawn.
- **Invitations, participant confirmation, tasks** with owners, deadlines and status (SOW 4.3).
- **Scheduling conflict** highlighting, **alerts**, **reports** on the dashboard (SOW 4.4).
- **Approval comments** and approval history (SOW 4.5).
- **Readiness checklist** (SOW 4.6).
- **Execution tracking** (SOW 4.7, heading only).
- **Post-maintenance validation** (SOW 4.9).
- **AI report review/save** and **final report and closure** (SOW 4.8, 4.10).
- **Roles**: none of the four SOW roles are reflected in the UI.
- The category list (Equipment, Facilities, IT, Office, HVAC) is from the reference. The SOW talks about Cloud, Database, Application, OS, Security / Network teams. [OPEN] which taxonomy is correct.
- Statuses in the UI are Pending / In Progress / Completed / Rejected. The SOW workflow implies more states (see section 3.2).

The frontend must be extended later (it is not modified in this task). The API in `api-specification.md` is designed for the SOW; the current UI only uses a subset.

---

## 2. Backend requirements

### 2.1 Stated in the SOW [SOW]
| Area | Requirement | SOW ref |
|---|---|---|
| Auth and roles | Web app for authorized users; role-based access; access to activities according to role. Roles: Maintenance Owner, Technical Participants, Approvers, Platform Administrator. Cognito for sign-in and user groups. *(04a interpretation: SOW §2 says participants vary "depending on the type and scope of each maintenance activity", so owner / participant / approver are per-activity roles; Platform Administrator is the only platform role, plus the `ApprovalEligible` eligibility group.)* | 2, 4.1, 5.2 |
| Maintenance requests | Create and manage requests; capture environment, cloud platform, affected systems, maintenance type, scope, schedule; attach documents and links; track status. | 4.2 |
| Participants / invitations | Owner invites team members; notifications with activity details, responsibilities and scheduled time; invitees confirm participation. | 4.3 |
| Tasks | Assign tasks to teams or individuals; track owner, deadline, completion status. | 4.3 |
| Dashboard | One view of all activities, participants, approvals, schedules, task progress, status; highlight upcoming activities and potential scheduling conflicts; show notifications, alerts, reports. | 4.4 |
| Approvals | Authorized managers/reviewers review plans; approve or reject; add comments; track approval history and status. | 4.5 |
| Readiness checklist | Checklists before maintenance: backup confirmation, access readiness, firewall and connectivity, team availability, application dependencies, required documentation; participants can update items. | 4.6 |
| Execution tracking | Heading only, **no detail provided**. | 4.7 [OPEN] |
| AI report | After each activity generate a simple report: completed tasks, issues, execution status, final results; the responsible employee reviews before saving. Bedrock. | 4.8, 5.7 |
| Post-maintenance validation | Relevant participants confirm system readiness; record application, database, OS, infrastructure results as applicable; record remaining issues. | 4.9 |
| Final report and closure | Heading only, **no detail provided**. | 4.10 [OPEN] |
| Notifications | SNS pub/sub; SES for invitations, reminders, approval notifications, activity updates. | 5.5 |
| Workflow | Step Functions for approvals and activity progression; EventBridge for scheduled reminders and event-based actions. | 5.6 |
| Storage | DynamoDB for requests, users, assignments, approvals, tasks, activity records; S3 for documents and generated reports. | 5.4 |
| Security / monitoring | KMS, IAM, CloudWatch. | 5.8, 5.9 |
| Isolation | Platform runs in its own AWS account and does not connect directly to customer accounts. | Section 6 diagram |

### 2.2 Additional recommendations [REC]
- **Audit trail** of every state change (who, when, before/after). Supports "track approval history" and troubleshooting.
- **Optimistic locking** (`version` attribute) on requests, tasks and checklist items, since several participants edit concurrently.
- **Idempotency keys** on create/approve/reject to survive retries.
- **Per-activity authorization** (role plus membership), not role alone.
- **Pre-signed S3 URLs** for upload/download so files never pass through Lambda or API Gateway limits.
- **Scheduling conflict detection** at create/update and on dashboard, based on overlapping time windows and shared affected systems.
- **Counters / read models** for dashboard numbers instead of scanning.
- **Soft delete / archive** instead of hard delete for maintenance records.
- **Notification preferences** per user (email on/off), plus an in-app notification inbox for the bell.
- **Bedrock guardrails and human review state** for AI output; store prompt inputs and model ID with the report for traceability.
- **Error format and API versioning** (`/v1`) described in `api-specification.md`.

### 2.3 Missing information [OPEN]
These need an answer before implementation. I did not assume them.

1. Details of SOW 4.7 (execution tracking) and 4.10 (final report and closure): which fields, states, who closes.
2. Maintenance request lifecycle: exact statuses and transitions, and whether rescheduling is allowed after approval.
3. ~~Approval model.~~ **Decided in TASK 04a.**
   - The owner (or an admin) assigns 1–20 `ApprovalEligible` approvers per request.
   - Policy is `ANY_ONE` (default) or `ALL`, decided in parallel.
     - `ANY_ONE`: one approval approves; the request is rejected only when every approver has rejected.
     - `ALL`: everyone must approve, and any rejection rejects.
   - Reject needs a comment.
   - Owners and participants of a request can never approve it, and platform admins get no bypass.
   - Approval groups are modelled for later.
   - See `api-specification.md` §12.
4. How users are created: self sign-up, admin-created, invitation only? Can external (non-platform) people be invited by email?
5. ~~Can a user have several roles?~~ **Decided in TASK 04a.** Yes, across activities: one activity role per request, which can differ between requests. Participant sub-types are stored as the member's `specialty` (Cloud, Database, Application, OS, SecurityNetwork).
6. Is the platform single-tenant (one organization) or multi-tenant (several customers in one deployment)? This changes keys and Cognito design. The SOW says customers exist but the platform has one account.
7. Allowed attachment types and sizes. The UI says PDF, DOC, XLS, PNG, max 10 MB; the SOW is silent. Are links first-class items?
8. Category / maintenance type / environment / cloud platform value lists (for example AWS, Azure, GCP? Production, Staging?).
9. Reminder schedule rules (how long before the window, to whom).
10. What "conflict" means: same time window only, or same affected system, or both?
11. AI report: language (English, Arabic or both), length, and whether Bedrock model and region are fixed by policy.
12. Data retention and audit requirements; KMS key policy owner.
13. AWS Region(s), environments (dev/test/prod) and account structure.
14. Lambda runtime and language, IaC tool (CDK, SAM, Terraform, CloudFormation), CI/CD. None of these exist in the project, and I am not choosing them.
15. Domain/branding for emails (SES sender identity), and whether email must also be Arabic.
16. Reports: which reports, which filters, export formats (PDF, CSV)? "Reports" screen has no design.
17. Should the "online presence" dots in the Team list be real-time? (Likely out of scope.)
18. How the frontend authenticates: Amplify libraries vs. hosted UI vs. custom form. The frontend currently has no auth code.

---

## 3. Proposed AWS architecture

### 3.1 Services
The SOW's service list is the baseline. For each service in the task brief, with purpose and how it is used:

| Service | Purpose here | Notes |
|---|---|---|
| **Amazon Cognito** [SOW] | User pool for sign-in. Issues JWTs (ID/access tokens) the frontend sends to the API. *(Revised in TASK 04a.)* Groups are **organization-level only**: `PlatformAdmin` (administration, read all) and `ApprovalEligible` (may be assigned as approver). Activity roles (owner / participant / approver) are **per request in DynamoDB**, not Cognito groups. The former `MaintenanceOwner`, `TechnicalParticipant` and `Approver` groups were removed before the first deployment. | Users are created by an administrator (no self sign-up). In-app user management is not built; use the Cognito console/CLI. MFA is [REC]. |
| **Amazon API Gateway** [SOW] | Single REST API (`/v1/...`). Cognito authorizer validates JWT before Lambda runs. Throttling, CORS, request validation, access logs. | REST API vs HTTP API is a choice [OPEN]; REST API is assumed in the spec because it has request validation and usage plans. |
| **AWS Lambda** [SOW] | Business logic: request CRUD, invitations, tasks, approvals, checklist, execution updates, validation, notifications, reports, dashboard reads. Authorization checks (role plus membership) happen here. | Language/runtime [OPEN]. |
| **Amazon DynamoDB** [SOW] | System of record. Single-table design recommended (see `database-design.md`). On-demand capacity [REC]. PITR [REC]. Encrypted with KMS. | Streams [REC] to feed counters and notifications. |
| **Amazon S3** [SOW] | Attachments and generated reports. Private bucket, KMS-encrypted, pre-signed URLs, versioning [REC]. | Object keys are scoped by request ID. |
| **Amazon SNS** [SOW] | Pub/sub for events such as `request.submitted`, `approval.decided`, `task.assigned`. Downstream subscribers (including email workers or webhooks later). | "Push notifications" appears in the SOW diagram. |
| **Amazon SES** [SOW] | Email: invitations, reminders, approval notices, activity updates. | Sender identity and sandbox exit [OPEN]. |
| **AWS Step Functions** [SOW] | Approval workflow (wait for decision using a task token, timeouts, reminders) and activity progression. | Standard workflows. **Deferred:** TASK 04a implements submit/decide as single DynamoDB transactions; a workflow can later wrap the same operations for reminders and timeouts. |
| **Amazon EventBridge** [SOW] | Scheduler for reminders (for example 24 h before window) and routing application events. | |
| **Amazon Bedrock** [SOW] | AI Activity Summary generation. Model choice [OPEN]. | Called from a Lambda; output saved as DRAFT until reviewed. |
| **AWS KMS / IAM / CloudWatch** [SOW] | Encryption keys, least-privilege roles per Lambda, logs/metrics/alarms. | |
| **AWS Amplify** [SOW] | Hosts the frontend. | Not changed by this task. |

### 3.2 Proposed request lifecycle [REC, confirm via OPEN 2]
`DRAFT → PENDING_APPROVAL → APPROVED | REJECTED → (SCHEDULED) → READINESS → IN_PROGRESS → VALIDATION → COMPLETED (closed)`; `CANCELLED` possible before `IN_PROGRESS`; `REJECTED` allows edit and resubmit.
The current UI labels map roughly as: Pending = `PENDING_APPROVAL`, In Progress = `IN_PROGRESS`, Completed = `COMPLETED`, Rejected = `REJECTED`. Remaining states are not shown in the reference and need UI decisions.

### 3.3 Request flow
```
Browser (React on Amplify)
  │ 1. sign in
  ▼
Amazon Cognito ──► JWT (ID/access token, cognito:groups)
  │ 2. HTTPS  Authorization: Bearer <JWT>
  ▼
API Gateway (/v1, Cognito authorizer, validation, throttling)
  ▼
Lambda (per domain) ── role + membership check ──► DynamoDB
  │                                                   │ stream
  ├─► S3 (pre-signed URL for uploads/downloads)       ▼
  ├─► Step Functions (approval / progression)    stream Lambda → counters, notifications
  ├─► SNS ──► SES (emails)         EventBridge ──► reminder Lambdas
  └─► Bedrock (AI summary)
CloudWatch logs/metrics/alarms · KMS encryption · IAM roles
```

How the frontend communicates:
- The frontend calls only the API Gateway URL (configured via an environment variable, not hard-coded). [REC]
- It sends the Cognito JWT in the `Authorization` header. It never uses AWS credentials directly.
- File upload: frontend asks the API for a pre-signed PUT URL, then uploads straight to S3, then confirms to the API.
- Notifications in the bell: polling `GET /v1/notifications` in the first iteration. [REC] WebSocket/AppSync only if real-time is later required.
- CORS allows only the Amplify domain(s) and `http://localhost:8002` for dev.

### 3.4 Account isolation [SOW]
Everything above lives in the platform's own AWS account. The backend never assumes roles in, or calls APIs of, customer accounts. Maintenance is *planned and tracked* here; execution in customer environments is done by humans, and the system records updates entered by participants. No cross-account IAM roles, no customer credentials, no inbound access to customer networks are proposed. If automated execution inside customer accounts is ever wanted, it is a separate decision. [OPEN]

### 3.5 Security [REC unless marked]
- Cognito JWT verified by API Gateway [SOW: Cognito]; Lambda re-checks group and activity membership.
- Least-privilege IAM role per Lambda; table access limited to needed actions [SOW: IAM].
- KMS customer-managed keys for DynamoDB, S3 [SOW: KMS].
- S3 Block Public Access; pre-signed URLs expire in minutes; content-type and size limits enforced; virus scanning is [OPEN].
- Input validation at API Gateway and in Lambda; no secrets in the frontend bundle.
- Sensitive data (credentials, keys) must not be stored in requests or checklists; UI and docs should say so.
- Audit log of decisions and role changes.
- WAF in front of API Gateway: optional [REC].

### 3.6 Monitoring [SOW: CloudWatch, REC for alarms]
Structured JSON logs with request ID, user ID and activity ID; alarms on 5xx rate, Lambda errors/throttles, Step Functions failures, DLQ depth, SES bounce/complaint rate.

### 3.7 Environments and deployment [OPEN]
Not specified. Not part of this task.

### 3.8 Suggested implementation order (after approval)
1. Cognito + API skeleton + `GET /me`.
2. Requests + attachments + dashboard reads (replaces current mock data).
3. Approvals (Step Functions) + notifications.
4. Participants, tasks, readiness checklist.
5. Execution tracking, validation, closure.
6. AI summary + reports/history.
