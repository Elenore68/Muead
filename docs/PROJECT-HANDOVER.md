# Mue'ad (Cloud Maintenance Planner): Project Handover

**Audience:** a developer who has never seen this project.
**Repository folder (original machine):** `D:\Meaed\Muead`. **GitHub:** `Elenore68/Muead`.
**Latest completed work:** TASK 01 to 13. TASK 01 to 07 are merged into `main` on GitHub. TASK 08 to 13 are on stacked branches (`task-08-readiness-checklist` … `task-13-team-settings-reports`), each built on the one before; merge them in order (sections 14.5 to 14.10). Sections 7 and 12 describe the state up to TASK 05 and were not rewritten.
**Deployment:** the `Muead-dev` stack was deployed to AWS (us-east-1) on 2026-11-17 and passed a 28-step end-to-end smoke test with two real Cognito users (section 14.11).

> ## Start here
> **"Do not start coding immediately. First read this handover document, inspect the repository and Git status, review the SOW and design reference, and understand the completed tasks. Then ask the project owner to confirm the next task before making changes."**
>
> - **Recommended next task:** **TASK 14: Deployment and operations** (section 14.2), after merging the TASK 08 to 13 branches in order and getting the owner's approval to deploy. **The dev stack is deployed (14.11); email, AI summaries, hosting, alarms and reminders are not.**
> - **Decisions to confirm:** the product decisions in 14.1 were confirmed by the project owner. The rules chosen for TASK 06 to 13 (sections 14.3 to 14.10) were decided during implementation because the SOW is silent; ask the owner to confirm them.

Every Git fact in this document was checked with Git commands when it was written. Re-check before relying on it (section 17, step 3).

---

## Contents
1. [Project overview and purpose](#1-project-overview-and-purpose)
2. [SOW requirements (sections 4.1–4.10)](#2-sow-requirements-sections-41410)
3. [Design reference and visual guidelines](#3-design-reference-and-visual-guidelines)
4. [Technology stack and architecture](#4-technology-stack-and-architecture)
5. [Repository folder structure](#5-repository-folder-structure)
6. [Local setup and exact commands](#6-local-setup-and-exact-commands)
7. [Completed work: TASK 01 to TASK 05](#7-completed-work-task-01-to-task-05)
8. [Roles and permissions](#8-roles-and-permissions)
9. [Approval workflow (ANY_ONE and ALL)](#9-approval-workflow-any_one-and-all)
10. [Notifications and email status](#10-notifications-and-email-status)
11. [Database design and API structure](#11-database-design-and-api-structure)
12. [Git branches and verified commits](#12-git-branches-and-verified-commits)
13. [Current implementation status](#13-current-implementation-status)
14. [Remaining work, confirmed decisions and dependencies](#14-remaining-work-confirmed-decisions-and-dependencies)
15. [Known limitations, risks and untested behavior](#15-known-limitations-risks-and-untested-behavior)
16. [Security decisions and AWS deployment restrictions](#16-security-decisions-and-aws-deployment-restrictions)
17. [Step-by-step instructions for the next developer](#17-step-by-step-instructions-for-the-next-developer)
18. [Handover checklist](#18-handover-checklist)

---

## 1. Project overview and purpose

**Name:** Mue'ad (Arabic ميعاد, "appointment"). The SOW calls it the **Cloud Maintenance Planner**. It was built for the AWS Builder Accelerator by Amal AlShammari, Sara Alzannan and Shahad Aljohani.

**Purpose:** one web workspace to plan, coordinate, approve and track infrastructure maintenance activities across cloud environments.

**Problems it solves** (SOW section 3):
- Information scattered across email, chat, spreadsheets and documents.
- Manual coordination between teams.
- Slow approvals.
- Scheduling conflicts.
- No single dashboard.
- Unclear task ownership.
- Manual reporting after maintenance.
- No AI-assisted summaries.

**Users** (SOW section 2). In this implementation, all roles except Platform Administrator are **per activity**; see section 8.

| User | Responsibility |
|---|---|
| Maintenance Owner | Creates the activity, defines its scope, invites participants, coordinates |
| Technical Participants | Engineers (Cloud, Database, Application, OS, Security / Network) who do the work |
| Approvers | Managers or authorized people who review and approve the plan |
| Platform Administrator | Manages user access, roles and platform settings |

**User journey.** ✅ = implemented, ⏳ = not built yet.
1. ✅ Sign in (Amazon Cognito).
2. ✅ The owner creates a maintenance request (a draft) and can attach files.
3. ✅ The owner adds participants and approvers, and chooses the approval policy.
4. ✅ The owner submits it for approval. Approvers receive an in-app notification.
5. ✅ Approvers approve or reject, with comments and full history. The owner can withdraw a pending request.
6. ✅ Schedule the activity (with conflict warnings), assign tasks, complete the readiness checklist.
7. ✅ Execute the maintenance and track progress (notes and issues).
8. ✅ Validate systems after maintenance; the AI summary is built but disabled.
9. ✅ Produce a final report and close the activity.

---

## 2. SOW requirements (sections 4.1–4.10)

The **SOW** (`Cloud-Maintenance-Planner-SOW.pdf`) is the **functional source of truth**. It is **not in the repository**; see section 15.7. Its requirements are summarized here and in `docs/backend/backend-architecture.md` section 2.

| Section | Requirement (summarized) | State |
|---|---|---|
| 4.1 Website and user access | Web app for authorized users; role-based access to activities | ✅ Done |
| 4.2 Request management | Create and manage requests; capture environment, cloud platform, affected systems, maintenance type, scope, schedule; documents and links; track status | ⚠️ Partial. Create, the edit API, attachments and approval statuses are done. The SOW fields are accepted by the API but **not on the form**; links have no UI; post-approval transitions aren't built. |
| 4.3 Invitations and task assignment | Invite members; notify them; members confirm participation; assign tasks; track owners, deadlines, completion | ⚠️ Partial. Assignment and in-app notifications are done. **Not built:** participation confirmation, tasks, email (built but disabled). |
| 4.4 Centralized dashboard | All activities, participants, approvals, schedules; task progress; upcoming activities and conflicts; notifications, alerts, reports | ⚠️ Partial. KPIs, charts, the upcoming list and the bell are done. **Not built:** conflicts, task progress, alerts, reports. |
| 4.5 Approval workflow | Review, approve or reject, comments, approval history | ✅ Done |
| 4.6 Readiness checklist | Backup, access, firewall/connectivity, team availability, dependencies, documentation; participants update items | ❌ Not built |
| 4.7 Maintenance execution tracking | **Heading only. The SOW has no detailed acceptance criteria.** | ❌ Not built; needs product decisions |
| 4.8 AI assistant and reporting | AI summary after each activity, reviewed before saving | ❌ Not built |
| 4.9 Post-maintenance validation | Confirm readiness after maintenance; application, database, OS and infrastructure results; remaining issues | ❌ Not built |
| 4.10 Final report and closure | **Heading only. The SOW has no detailed acceptance criteria.** | ❌ Not built; needs product decisions |

- **Section 5:** proposes Amplify, Cognito, IAM, API Gateway, Lambda, DynamoDB, S3, SNS, SES, Step Functions, EventBridge, Bedrock, KMS and CloudWatch.
- **Section 6:** states that **the platform runs in its own AWS account and does not connect directly to customer AWS accounts.**

**Requirements vs. implementation choices.** These were **decided with the project owner during implementation**; they are not in the SOW:
- activity-scoped roles;
- ANY_ONE / ALL approval policies;
- reject requires a comment;
- withdraw;
- the `ApprovalEligible` group;
- email disabled by default;
- the notification event list;
- single-table DynamoDB;
- REST API under `/v1`;
- region `us-east-1`;
- TypeScript on Node.js 22 with AWS CDK;
- the lifecycle and dropdown values in section 14.1.

The docs folder uses these labels:
- **[SOW]**: stated in the SOW.
- **[FE]**: needed by the frontend.
- **[REC]**: a recommendation.
- **[OPEN]**: missing information.

---

## 3. Design reference and visual guidelines

- **Visual source of truth:** `Muead-UI-Reference.pdf` (6 pages: Maintenance Requests, Approvals, a 4-screen overview, two Dashboard versions, the logo sheet). It is **not in the repository**.
- **Its analysis:** `docs/design/design-system.md` (tokens, components, responsive rules) and `docs/design/screen-specifications.md` (screen-by-screen).
- **Look and feel:**
  - Purple-to-coral brand gradient on a soft lavender/pink background.
  - Translucent white rounded cards, pill-shaped tabs and status chips.
  - Plus Jakarta Sans as the closest match; the real font is unconfirmed.
  - Lucide outline icons.
  - A left sidebar with the logo, navigation and team list.
- **Rules:**
  - Don't redesign the reference screens.
  - Don't invent a new brand.
  - Use the existing CSS tokens (`frontend/src/styles/tokens.css`); don't add new colors.
  - Colors are approximate; sample the original files for exact values.
  - The in-app logo is a **placeholder SVG** until the official asset is supplied.
  - **Mock mode** (section 5.2) must keep rendering exactly as before. Earlier tasks checked this with byte-for-byte HTML comparisons.

---

## 4. Technology stack and architecture

### 4.1 Stack
| Layer | Technology (version) | Used for | State |
|---|---|---|---|
| Frontend | React 19.3.1, TypeScript 5.9.3, Vite 8.3.8, react-router-dom 7.18.5, lucide-react, Plus Jakarta Sans | Single-page app, plain CSS with design tokens | ✅ Implemented |
| Frontend auth | `amazon-cognito-identity-js` 6.3.22 | Sign-in, forced new password on first login, ID token | ✅ Implemented (never run against a real pool) |
| Frontend tests | Vitest 5.1.0, jsdom 31.0.0, Testing Library | Component, permission and API-contract tests | ✅ |
| Backend | Node.js 22 Lambdas in TypeScript, bundled by esbuild through CDK | All business logic | ✅ Implemented, ⏳ not deployed |
| API | Amazon API Gateway REST API, stage `v1`, Cognito authorizer | 30 routes (section 11.3) | ✅ Defined, ⏳ not deployed |
| Database | Amazon DynamoDB, one table `muead-<env>-main`: 3 GSIs, on-demand, PITR, KMS, stream (NEW_IMAGE), TTL `ttl` | All data | ✅ Defined, ⏳ not deployed |
| Authentication | Amazon Cognito user pool. Groups: `PlatformAdmin`, `ApprovalEligible`. No self sign-up | Identity | ✅ Defined, ⏳ not deployed |
| Storage | Amazon S3: private, KMS, versioned, CORS for pre-signed URLs | Attachments | ✅ Defined, ⏳ not deployed |
| Encryption | AWS KMS customer-managed key with rotation | Table and bucket | ✅ Defined |
| Notifications | DynamoDB stream → notifier Lambda; Amazon SES (`@aws-sdk/client-sesv2`) | In-app notifications; optional email | ✅ In-app defined; email **disabled** |
| Logs | Amazon CloudWatch Logs (1-month retention per Lambda) | Logging | ✅ Defined. **No alarms.** |
| Infrastructure as code | AWS CDK 2 (`aws-cdk-lib` 2.276.0, CLI 2.1148.1), one stack `Muead-dev` | Everything above | ✅ Synthesizes locally |
| Hosting (SOW 5.1) | AWS Amplify | Frontend hosting | ❌ Not set up |
| Workflow (SOW 5.6) | AWS Step Functions | Orchestration | ❌ Deferred: approvals use DynamoDB transactions |
| Scheduling (SOW 5.6) | Amazon EventBridge | Reminders | ❌ Not built |
| Pub/sub (SOW 5.5) | Amazon SNS | External subscribers | ❌ Not used |
| AI (SOW 5.7) | Amazon Bedrock | AI activity summary | ❌ Not built |

### 4.2 Request flow
```
Browser (React)
  1. Sign in with Cognito -> ID token (JWT, contains cognito:groups)
  2. fetch https://<api-id>.execute-api.us-east-1.amazonaws.com/v1/...   Authorization: Bearer <ID token>
API Gateway (Cognito authorizer validates the JWT)
  3. Lambda proxy -> router in backend/src/lib/http.ts ("METHOD /resource/{param}")
Lambda handler
  4. getCaller(): organization groups from the token (src/lib/auth.ts)
  5. Activity access: GetItem REQ#<id> / MEMBER#<caller> (src/lib/members.ts)
  6. DynamoDB writes, usually one TransactWriteItems with condition expressions + an AUDIT item
DynamoDB stream (AUDIT inserts only) -> notifier Lambda -> notification items (+ email if enabled)
Files: POST /attachments -> pre-signed S3 URL -> browser PUTs directly to S3 -> POST /confirm
```

### 4.3 AWS architecture
- **Account boundary:** one platform-owned AWS account. The platform **never** connects to customers' AWS accounts: no cross-account roles, no customer credentials, no inbound access to customer networks. People do the maintenance; the platform plans and records it.
- **Implemented as code, never deployed** (`backend/infra/lib/muead-stack.ts`):
  - 10 Lambdas: `me`, `requests`, `attachments`, `dashboard`, `reference`, `users`, `members`, `approvals`, `notifications`, `notifier`;
  - the REST API with 30 methods;
  - the Cognito pool, its client and 2 groups;
  - the DynamoDB table with stream and TTL;
  - the S3 bucket and KMS key;
  - log groups;
  - the stream event source, filtered to AUDIT inserts.
- **Proposed, not built:** Amplify, Step Functions, EventBridge, SNS, Bedrock, CloudWatch alarms, a dead-letter queue, a WAF.
- **Retained resources:** the table, bucket, user pool and KMS key use `RETAIN`, so they survive stack deletion and keep costing money.
- **Region:** `us-east-1`. The AWS account is taken from the deploying user's credentials; it is never hard-coded.

---

## 5. Repository folder structure

### 5.1 Layout
```
README.md                         one line (initial commit)
docs/
  PROJECT-HANDOVER.md             this document (committed on task-05-notifications; see section 12)
  design/design-system.md         brand, colors, typography, components, responsive rules
  design/screen-specifications.md
  backend/backend-architecture.md requirements, AWS services, open questions (OPEN 1..18)
  backend/database-design.md      data model; section 8 = notes on what is actually implemented
  backend/api-specification.md    endpoints; sections 11-13 = what is actually implemented
backend/
  infra/bin/app.ts                CDK app entry
  infra/config.ts                 region, allowed origins, email settings (disabled)
  infra/lib/muead-stack.ts        the whole stack
  src/handlers/*.ts               one Lambda per file, each exports `handler`
  src/lib/*.ts                    shared logic: pure rules + DynamoDB helpers
  test/*.test.ts                  node:test suites; test/helpers/fakeDb.ts = in-memory DynamoDB fake
frontend/
  .env.example                    VITE_API_BASE_URL, VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_CLIENT_ID (no values)
  vite.config.ts                  dev server port 8002; define global=globalThis (needed by the Cognito library)
  vitest.config.ts
  src/main.tsx, App.tsx, config.ts
  src/api/*.ts                    typed API calls (client.ts adds the token and maps errors)
  src/auth/                       AuthContext (Cognito), RequireAuth
  src/data/*.ts                   hooks (live vs mock); permissions.ts = UI permission hints
  src/components/*.tsx            Layout, ui atoms, dialogs, member cards, decision panel, notification bell
  src/pages/*.tsx                 Dashboard, Requests, NewRequest, RequestDetails, Approvals, Login, ComingSoon
  src/styles/tokens.css, global.css
  src/__tests__/*.test.ts(x)
```

### 5.2 Mock mode vs. live mode
- If any of the three `VITE_*` variables is missing, the frontend runs in **mock mode**: static demo data and no sign-in, matching the design screens.
- If all three are set in `frontend/.env.local` (git-ignored), it runs in **live mode** against a deployed API. That isn't possible yet, because nothing is deployed.

### 5.3 Where to look before changing a feature
1. `docs/backend/api-specification.md` sections 11–13: what is implemented, and how it differs from the original design.
2. `docs/backend/database-design.md` section 8: key formats, the reserved-word rule, consistency rules.
3. The handler in `backend/src/handlers/` and its pure rules in `backend/src/lib/`.
4. The tests in `backend/test/` and `frontend/src/__tests__/`.
5. For UI: `docs/design/*.md` and the existing CSS tokens.

---

## 6. Local setup and exact commands

**Prerequisites:** Node.js 22 and npm 10 (original machine: v22.20.0, npm 10.9.3). The AWS CLI and credentials are only needed for deployment, which is **not allowed without approval**; neither is installed or configured on the original machine.

```powershell
# 1. install (once)
cd backend;  npm install
cd ..\frontend; npm install

# 2. backend checks
cd ..\backend
npx tsc --noEmit                                   # type check (same as: npm run typecheck)
npm test                                           # node:test + tsx; makes no AWS calls
$env:CDK_DISABLE_VERSION_CHECK="1"; npx cdk synth --quiet   # local CloudFormation template only; creates nothing

# 3. frontend
cd ..\frontend
npm run dev                                        # http://localhost:8002 (mock mode without .env.local)
npm test                                           # vitest run
npm run build                                      # tsc -b && vite build

# NEVER without explicit approval: npx cdk bootstrap / npx cdk deploy / npx cdk destroy
```

**Expected results at handover:**
- backend type check passes;
- backend tests: **68 / 68**;
- `cdk synth` passes;
- frontend tests: **41 / 41**;
- frontend build passes.

**Notes:**
- `npm run build` rewrites `frontend/tsconfig.tsbuildinfo` every time. That file is untracked and is **not** git-ignored, so **never use `git add .`**; stage files by name.
- If the C: drive is full, the original machine once used `npm install --cache D:\Meaed\npm-cache`.

---

## 7. Completed work: TASK 01 to TASK 05

According to the project records, TASK 01 through TASK 05 are complete and tested locally. Commit hashes were verified with `git log`. **None of it has been deployed.**

### Foundations (before TASK 01, no task number)
- **Design analysis:** `docs/design/*.md`.
- **Frontend screens:** Dashboard, Requests, New Request, Request Details, Approvals; Schedule, Reports, Team and Settings are placeholders.
- **Backend steps 1–2:** CDK stack, Cognito, API, `GET/PATCH /me`, requests, attachments (pre-signed S3 URLs), dashboard endpoints, reference data.

### TASK 01: Backend analysis and architecture
- **Objective:** analyze the frontend and the SOW, then propose the architecture, data model and API.
- **Delivered:** `docs/backend/backend-architecture.md`, `database-design.md`, `api-specification.md`.
- **Tests:** none (documentation).

### Frontend–backend integration: Requests and New Request
- **Built:**
  - API client with the Cognito ID token, and the sign-in page with forced new password;
  - Requests list connected (tabs, counts, search, cursor pagination);
  - New Request: create, then upload files;
  - loading, error and success states;
  - environment-variable configuration;
  - a fix for the `global is not defined` error from the Cognito library;
  - a fix for a stale-response race in `useRequestList.ts`.
- **Checks:** frontend build.

### TASK 02: Request Details integration
- **Built:** `GET /requests/{id}`, the attachments list and pre-signed downloads (https only); loading, error, not-found and retry states; mock mode unchanged.
- **Files:** `src/pages/RequestDetails.tsx`, `src/data/useRequestDetails.ts`.

### TASK 03: Dashboard integration
- **Built:** KPI cards, status donut (3 slices; the center is their sum), 17-day chart, category bars, upcoming schedule. Admins see global data; others see their own requests.
- **Files:** `src/api/dashboard.ts`, `src/data/useDashboard.ts`, `src/pages/Dashboard.tsx`.
- **Checks:** build passes; mock mode byte-identical.

**Commit for everything above:** `b34be25` "Complete frontend API integration including Dashboard" (55 files), on `main` and on GitHub.

### TASK 04a: Activity-scoped members and approvals (backend)
- **Built:**
  - Cognito groups reduced to `PlatformAdmin` and `ApprovalEligible`;
  - activity members;
  - user directory with no emails;
  - submit, decide, withdraw, history, personal inbox and summary;
  - ANY_ONE / ALL policies;
  - audit log;
  - caps (20 approvers, 50 members);
  - the transaction-size guard.
- **Review fixes:**
  - **C1:** the reserved word `comment` made every rejection fail; all attribute names are now aliased.
  - **C2:** stale reads could leave an ALL round pending; approval steps now use strongly consistent reads.
  - Also: attachment lock during approval, batch-write retry, directory privacy, `nextToken` partition checks.
- **Files:** `backend/src/lib/{members,approvals,audit,users,db,http,requests}.ts`, `backend/src/handlers/{members,approvals,users,requests,attachments,me}.ts`.
- **Tests:** 43 backend tests; type check, `cdk synth` and the frontend build passed.
- **Commit:** `16583b6` on `task-04` (25 files).

### TASK 04b: Frontend members and approvals
- **Built:**
  - **Request Details:** Approvers and Participants cards (add, remove, policy, submit, withdraw), the decision panel (only for the assigned, eligible approver with a pending decision), and the Approvals history tab.
  - **Approvals page:** your own inbox, counts, tabs, search, pagination, dialogs, 409 handling.
- **Files:** `src/api/{approvals,members}.ts`, `src/data/{permissions,useActivity,useApprovalInbox,useResource}.ts`, `src/components/{ActivityCards,AddMemberDialog,ApprovalHistory,ConfirmDialog,DecisionPanel,Modal,TextActionDialog}.tsx`.
- **Tests:** 33 Vitest tests; the build passed; mock mode byte-identical.
- **Commit:** `1367309` on `task-04` (25 files).

### TASK 05: In-app notifications and optional email
- **Built:**
  - DynamoDB stream → notifier Lambda;
  - the event catalogue and recipient rules;
  - idempotent writes and 180-day TTL;
  - the notifications API (own data only);
  - the bell (60-second polling, panel, mark read);
  - SES email support, **disabled by default**, with no SES permission granted.
- **Files:** `backend/src/lib/{notifications,email}.ts`, `backend/src/handlers/{notifier,notifications}.ts`, `backend/infra/config.ts`, `frontend/src/components/NotificationBell.tsx`, `frontend/src/api/notifications.ts`.
- **Tests:**
  - backend 68 / 68 (25 new);
  - frontend 41 / 41 (8 new);
  - frontend build, backend type check and `cdk synth` all passed. Synth confirmed: stream and TTL on, the filter allows AUDIT inserts only, no `ses:` permission, `EMAIL_ENABLED=false`.
- **Commit:** `87482934380fe33978aae2000aa0da5b16efa3a8` on `task-05-notifications` (19 files), pushed to GitHub together with this document.

---

## 8. Roles and permissions

**Why per activity:** SOW section 2 says participants depend on "the type and scope of each maintenance activity". The same person can approve activity A, work on B and own C. Global roles would give approval power everywhere and could not stop self-approval.

### 8.1 Organization level (Cognito groups)
| Group | Grants | Does **not** grant |
|---|---|---|
| `PlatformAdmin` | Read every request, list all requests, manage members on any request, global dashboard | Approval authority; self-assignment as approver; approving own or participated requests |
| `ApprovalEligible` | May be **assigned** as an approver | Any authority by itself |
| none | Sign in, create requests (and become owner), be a participant | — |

The former groups `MaintenanceOwner`, `TechnicalParticipant` and `Approver` were removed before any deployment.

### 8.2 Activity level (`REQ#<id> / MEMBER#<userId>`)
| Role | View | Edit request / attachments / submit / withdraw | Manage members | Approve / reject |
|---|---|---|---|---|
| `OWNER` (the creator) | ✔ | ✔ (editable states) | ✔ | ✘ never |
| `PARTICIPANT` | ✔ | ✘ | ✘ | ✘ never |
| `APPROVER` | ✔ (read-only) | ✘ | ✘ | ✔ only in the current round, with a pending decision, while `ApprovalEligible` |
| PlatformAdmin, not a member | ✔ | ✔ | ✔ (never themselves as approver) | ✘ unless assigned by someone else **and** eligible |
| Anyone else | ✘ (`404`) | ✘ | ✘ | ✘ |

**Rules:**
- **One role per person per request.** The key is (request, user), so an owner or participant can never approve that request. Self-approval is checked again on every decision, with no admin exception.
- **Assignment checks:** the target has signed in at least once, is active, isn't already a member, and isn't the caller when assigning an approver. Approvers must be eligible. Caps are 20 approvers and 50 members.
- **Locks:**
  - all member changes are blocked while `PENDING_APPROVAL`;
  - approvers change only in `DRAFT` / `REJECTED`;
  - nothing changes in `COMPLETED` / `CANCELLED`;
  - attachments are locked while pending, completed or cancelled.
- **Removal is soft**; the owner can't be removed.
- **Audit log:** every change writes an append-only audit entry with the actor, the actor's activity role, the target, name snapshots and a timestamp. Nothing is ever deleted.
- **Privacy:** no endpoint returns another user's email. Directory search needs at least 2 characters.

---

## 9. Approval workflow (ANY_ONE and ALL)

- **Policies** (set by the owner while `DRAFT` / `REJECTED`):
  - **ANY_ONE** (default): the first approval approves the request at once, and other pending decisions become `NOT_REQUIRED`. A rejection is recorded, but the request **stays pending** while others can still decide. It's rejected only when **every** approver has rejected.
  - **ALL:** everyone must approve; any rejection rejects at once.
- **Comments:** reject **requires** a comment (max 1000 characters); approve takes an optional one.
- **Rounds:** submit creates round *n + 1*: a round header (`APPRROUND#000n`) plus one decision record per approver (`APPR#000n#<approverId>`). Earlier rounds are kept.
- **Submit** (`POST /v1/requests/{id}/submit` `{version}`): owner or admin, from `DRAFT` / `REJECTED`, with 1–20 active, eligible approvers. One transaction, conditioned on `version`, status and the membership revision (`membersRev`).
- **Decide** (`POST /v1/requests/{id}/approvals/decision` `{decision, comment?}`): no `version` is needed. The server re-reads everything with strongly consistent reads and retries up to 3 times, then returns `409 CONCURRENT_UPDATE`.
- **Withdraw** (`POST /v1/requests/{id}/withdraw` `{reason, version}`): owner or admin, while pending.
  - The request goes back to `DRAFT` with `approvalState=WITHDRAWN`.
  - The round becomes `WITHDRAWN`, and pending records become `NOT_REQUIRED`. Decisions already made are kept in the history.
  - This already matches the confirmed decision in section 14.1.
- **Resubmit:** change the approvers, then submit again as a new round.
- **Concurrency protections:** every decision bumps the request version, which serialises decisions. Conditions cover record and round state, and each step is one transaction of at most 25 items (DynamoDB's limit is 100).
- **Testing limitation:** these are tested against an in-memory fake that **does not evaluate most condition expressions or apply transactions**. Real DynamoDB behaviour is **unverified**.

---

## 10. Notifications and email status

- **Flow:** audit entry → DynamoDB stream (filtered to `INSERT` of `entityType=AUDIT`) → notifier Lambda → notification items `USER#<recipient> / NOTIF#<auditUlid>` with a 180-day TTL.
- **Events now active:**
  - member assigned or removed;
  - submitted (approvers get *approval required*, participants and the owner get *submitted*);
  - decision recorded (owner only, while the round is open);
  - request approved or rejected;
  - request withdrawn.

  "Request created" has a rule but normally no recipient, because the creator is the owner.
- **Reserved events, waiting for future features:** status changed, task assigned or completed, readiness updated, maintenance completed, validation completed, final report available. The rules and tests exist; each future feature only has to write the audit entry with the fields in `api-specification.md` section 13.2.
- **Recipients and exclusions:**
  - the actor is never notified;
  - only ACTIVE members of that request are notified; platform admins and other non-members are not;
  - the exception is the removed person, who gets one notification without a link;
  - minor field edits are not notified;
  - notifications contain no comments or reasons.
- **Duplicate prevention:** the notification id is the audit entry's ULID, and writes are create-only.
- **API (own data only):** `GET /v1/notifications?unread=&limit=&nextToken=`, `GET /v1/notifications/unread-count`, `POST /v1/notifications/{id}/read`, `POST /v1/notifications/read-all`. Another user's id returns `404`.
- **Bell:**
  - The red dot shows only when there are unread notifications; it polls every 60 seconds while the tab is visible.
  - The panel shows the latest 20. Clicking an item marks it read and opens the request. There's "Mark all read", and Escape or clicking outside closes it.
  - Mock mode shows the original static bell.
- **Email status: built, DISABLED by default.**
  - Setting: `backend/infra/config.ts` → `email: { enabled: false, fromAddress: "" }`.
  - While disabled: no SES permission, no SES client, and `emailStatus=DISABLED`.
  - To enable later, with approval: verify the sender in SES (us-east-1), request production access, set both fields, then deploy.
- **Missing:** reminders, a dead-letter queue, a preferences UI, a full history page, SNS.

---

## 11. Database design and API structure

Full details: `docs/backend/database-design.md` (section 8 = implemented notes) and `docs/backend/api-specification.md` (sections 11–13 = implemented).

### 11.1 Single table
The table is `muead-<env>-main` (for example `muead-dev-main`):
- key `PK` / `SK`;
- 3 GSIs (`GSI1`, `GSI2`, `GSI3`), each with string partition and sort keys, projecting all attributes;
- stream NEW_IMAGE, TTL attribute `ttl`.

### 11.2 Key formats in use
| Item | PK | SK | Indexes |
|---|---|---|---|
| User profile | `USER#<cognitoSub>` | `PROFILE` | GSI1 `EMAIL#<email>` / `USER`; GSI2 `DIRECTORY` / `<lowercase name>#<id>` |
| Org-group mirror | `USER#<id>` | `ROLE#<group>` | GSI2 `ROLE#<group>` / `<lowercase name>#<id>` |
| Notification | `USER#<id>` | `NOTIF#<ulid>` | none (TTL) |
| Request | `REQ#<id>` | `META` | GSI1 `OWNER#<owner>` / `<createdAt>#<id>`; GSI2 `STATUS#<status>` / `<schedule or created>#<id>`; GSI3 `SCHED#<yyyy-mm>` / `<start>#<id>` (non-draft) |
| Member | `REQ#<id>` | `MEMBER#<userId>` | GSI1 `MEMBER#<userId>` / `<request createdAt>#<requestId>` (removed on soft delete) |
| Attachment | `REQ#<id>` | `ATT#<attachmentId>` | — |
| Approval round | `REQ#<id>` | `APPRROUND#<nnnn>` | — |
| Approval record | `REQ#<id>` | `APPR#<nnnn>#<approverId>` | GSI3 `APPROVER#<userId>` / `<decision>#<submittedAt>#<requestId>` |
| Audit entry | `REQ#<id>` | `AUDIT#<timestamp>#<ulid>` | — (feeds the stream) |
| Stats | `STATS#GLOBAL` or `STATS#MONTH#<yyyy-mm>` | `STATUS#…`, `CATEGORY#…`, `DAY#…` | — |
| Request counter | `COUNTER#REQ` | `SEQ` | — |

**Request statuses already defined in code:** `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SCHEDULED`, `READINESS`, `IN_PROGRESS`, `VALIDATION`, `COMPLETED`, `CANCELLED`.

**Implementation rules to keep:**
- Alias **every** attribute name in expressions; `comment`, `status`, `count` and `timezone` are reserved words, and a test linter checks this.
- Use strongly consistent reads for state transitions.
- One transaction per state change, including its audit entry.

### 11.3 API (REST, stage `/v1`, Cognito ID token)
Thirty implemented routes, verified in the stack:

| Area | Routes |
|---|---|
| Me | `GET /me`, `PATCH /me` |
| Requests | `GET /requests`, `POST /requests`, `GET /requests/counts`, `GET /requests/{requestId}`, `PATCH /requests/{requestId}` |
| Attachments | `GET`/`POST /requests/{requestId}/attachments`, `POST …/{attachmentId}/confirm`, `GET …/{attachmentId}/download-url`, `DELETE …/{attachmentId}` |
| Dashboard | `GET /dashboard/summary`, `GET /dashboard/requests-over-time`, `GET /dashboard/upcoming` |
| Reference | `GET /reference-data` |
| Directory | `GET /users` |
| Members | `GET`/`POST /requests/{requestId}/members`, `DELETE /requests/{requestId}/members/{userId}` |
| Approvals | `POST /requests/{requestId}/submit`, `POST /requests/{requestId}/withdraw`, `POST /requests/{requestId}/approvals/decision`, `GET /requests/{requestId}/approvals`, `GET /approvals`, `GET /approvals/summary` |
| Notifications | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`, `POST /notifications/{notificationId}/read` |

**Error format:** `{ error: { code, message, details?, requestId } }`. Common codes: `VALIDATION_ERROR` (400), `FORBIDDEN` (403), `NOT_FOUND` (404), `VERSION_CONFLICT` / `CONCURRENT_UPDATE` / `ALREADY_DECIDED` (409).

---

## 12. Git branches and verified commits

Verified with `git status`, `git branch -vv`, `git log --graph --all`, `git ls-remote --heads origin` and `git fetch`. The pull-request check used the public GitHub API.

| Item | Value |
|---|---|
| Current branch | `task-05-notifications` |
| HEAD | `87482934380fe33978aae2000aa0da5b16efa3a8`, "TASK 05: implement in-app notifications and optional email support" |
| History | `8748293` (TASK 05) → `1367309` (TASK 04b) → `16583b6` (TASK 04a) → `b34be25` (`main`) → `7c49127` (initial commit) |
| `main` / `origin/main` | `b34be25938abc5b23d06662988ec33fb085d3e52` (same on GitHub) |
| `task-04` / `origin/task-04` | `136730980f96caf3c6c16c1d06a9f651ea1ac3ed`, **on GitHub** |
| `task-05-notifications` / `origin/task-05-notifications` | TASK 05 commit `87482934380fe33978aae2000aa0da5b16efa3a8`, then the handover commit "docs: add comprehensive project handover guide" (the branch's newest commit; its parent is the TASK 05 commit). **On GitHub:** https://github.com/Elenore68/Muead/tree/task-05-notifications |
| Pull requests | **None.** GitHub's API returned an empty list (open and closed). No PR exists for `task-04` or `task-05-notifications`, and nothing has been merged into `main`. |
| Uncommitted tracked changes | none |
| Untracked files | `frontend/tsconfig.tsbuildinfo` (build cache, must stay out of commits) |
| Ignored (expected) | `backend/node_modules/`, `backend/cdk.out/`, `frontend/node_modules/`, `frontend/dist/` |
| Stashes | none |

**For a developer on another computer:** clone the repository and check out the latest branch:
```powershell
git clone https://github.com/Elenore68/Muead.git
cd Muead
git switch task-05-notifications      # contains TASK 04a, 04b, 05 and this document
```
`main` does **not** contain TASK 04 or TASK 05 yet; nothing has been merged.

**Branch naming plan (recommendation; nothing renamed or created):**

| Work | Branch |
|---|---|
| main | `main` |
| TASK 04 | `task-04` today; recommended rename `task-04-activity-roles-and-approvals` (needs approval, because it changes GitHub) |
| TASK 05 | `task-05-notifications` |
| TASK 06 (next) | `task-06-request-lifecycle` (**not created**) |
| Later | `task-07-participation-and-tasks`, `task-08-readiness-checklist`, `task-09-maintenance-execution`, `task-10-validation-and-final-report`, `task-11-ai-summary`, `task-12-scheduling-and-conflicts`, `task-13-team-settings-and-reports`, `task-14-deployment-and-operations` |

Branches are stacked (`task-05-notifications` is built on `task-04`). Merge in order, 04 then 05, or rebase onto `main` after each merge.

---

## 13. Current implementation status

| Feature | Backend | Frontend | Tests | Deployed |
|---|---|---|---|---|
| Sign-in, profile (`/me`) | ✅ | ✅ | partial | ❌ |
| Create / list / view requests, counts, search | ✅ | ✅ | ✅ | ❌ |
| Edit request (`PATCH`) | ✅ | ✅ Edit dialog (Draft / Rejected only) | ✅ | ❌ |
| SOW request fields (environment, platform, systems, type, scope, schedule, links) | ✅ validated against the confirmed lists | ✅ New Request and Edit (live mode only) | ✅ | ❌ |
| Attachments (upload, list, download, delete, lock) | ✅ | ✅ (delete has no UI) | ✅ | ❌ |
| Dashboard | ✅ | ✅ | build + byte check | ❌ |
| Activity members and directory | ✅ | ✅ | ✅ | ❌ |
| Approvals (policies, submit, decide, withdraw, history, inbox) | ✅ | ✅ | ✅ | ❌ |
| In-app notifications and bell | ✅ | ✅ | ✅ | ❌ |
| Email notifications | ✅ built, **disabled** | — | ✅ (test sender) | ❌ |
| Lifecycle after approval (Scheduled … Completed, Cancelled) | ✅ `/transition`, `/cancel` | ✅ Lifecycle card | ✅ | ❌ |
| Participation confirmation, tasks | ❌ | ❌ | — | ❌ |
| Readiness, execution, validation, final report, AI summary | ❌ | ❌ | — | ❌ |
| Schedule, Reports, Team, Settings pages, conflicts | ❌ | placeholders | — | ❌ |
| Hosting, reminders, alarms, dead-letter queue | ❌ | ❌ | — | ❌ |

---

## 14. Remaining work, confirmed decisions and dependencies

### 14.1 Confirmed product decisions (approved by the project owner, NOT implemented yet)
Implement these in TASK 06. Don't ask the owner about them again.

**Request lifecycle**
```
Draft → Pending Approval → Approved → Scheduled → Readiness → In Progress → Validation → Completed
```
- **Approved** must remain a **visible, separate request status**; it doesn't skip straight to Scheduled.
- **Exceptional statuses:**
  - **Rejected**: the request can be edited and resubmitted as a new round (already implemented).
  - **Withdrawn**: returns the request to **Draft** while **preserving the withdrawn approval round in history**. This already works this way in code: `DRAFT` with `approvalState=WITHDRAWN`, and the round marked `WITHDRAWN`.
  - **Cancelled**.

**Dropdown values**
| Field | Values |
|---|---|
| Environment | Development, Testing, Staging, Production, Disaster Recovery |
| Cloud Platform | AWS, Azure, Google Cloud, Hybrid, Other |
| Maintenance Type | Planned Maintenance, Emergency Maintenance, Preventive Maintenance, Corrective Maintenance, Upgrade, Patching |

Today `GET /reference-data` returns empty lists for these three fields; TASK 06 should fill them.

### 14.3 TASK 06 as implemented (branch `task-06-request-lifecycle`, uncommitted)
- **Transitions:** `POST /v1/requests/{id}/transition {to, version}` moves exactly one step: Approved → Scheduled → Readiness → In Progress → Validation → Completed. `POST /v1/requests/{id}/cancel {reason, version}` cancels. Each call is one DynamoDB transaction (version and status conditions, a `REQUEST_STATUS_CHANGED` audit entry, status counters). Every active member except the actor is notified; the cancel reason is not put in the notification.
- **Rules chosen for the open points (confirm with the owner):**
  - Who: the owner or a platform admin (same as editing). Participants and approvers cannot.
  - Required before submit: environment, cloud platform, maintenance type and a schedule start date (`REQUEST_INCOMPLETE`, 400).
  - Cancel is allowed from Draft, Rejected, Approved, Scheduled and Readiness. Not from Pending Approval (withdraw first), In Progress, Validation, Completed or Cancelled. A reason is required.
  - Moving to Scheduled needs a schedule start date (`SCHEDULE_REQUIRED`).
- **Form:** environment, cloud platform and maintenance type accept only the confirmed values; `GET /reference-data` returns them. New Request and a new Edit dialog (Draft / Rejected) have these fields plus scope, affected systems (comma-separated) and links (one URL per line). Mock mode is unchanged.
- **Request Details:** a Lifecycle card shows the stepper and offers next step, Edit and Cancel, based on `viewer.lifecycle` from `GET /requests/{id}`.
- **Checks run:** backend type check, 90 / 90 tests, `cdk synth`; frontend 53 / 53 tests and build. Still unverified against real AWS (nothing is deployed).
- **Not done:** editing a request after approval (rescheduling); the Dashboard still groups Readiness and Validation under "In Progress".

### 14.4 TASK 07 as implemented (branch `task-07-participation-and-tasks`)
- **Participation:** `POST /v1/requests/{id}/participation {response: CONFIRMED|DECLINED, note?}`. Only the signed-in participant, for themselves, while the request is not Completed or Cancelled. Members now carry `participation` (`PENDING` until answered; `null` for owner and approvers). The owner is notified. **Declining keeps the person on the request**; they get no new tasks and can confirm later (the owner decides whether to remove them).
- **Member details:** `PATCH /v1/requests/{id}/members/{userId} {specialty?, responsibilities?}` by the owner or an admin (`null` clears). Audit only, no notification.
- **Tasks (one request each, no team-level tasks):** `GET/POST /v1/requests/{id}/tasks`, `PATCH/DELETE /v1/requests/{id}/tasks/{taskId}`. Fields: title, description, assignee, due date, status (`TODO`, `IN_PROGRESS`, `DONE`). Max 100 per request.
  - Owner or admin create, edit, reassign and delete. The assignee may change only the status of their own task.
  - The assignee must be an active owner or participant who has not declined (not an approver).
  - Blocked once the request is Completed or Cancelled. Each write is one transaction with checks that the request is still open and the assignee is still valid.
  - Notifications: assignee on assignment, owner and task creator on completion, owner on a participation answer.
- **Frontend:** a Tasks tab (live mode only; mock mode keeps its tabs) with progress bar, overdue marker, create/edit/delete dialogs; confirm/decline buttons and answer badges in the Participants card; edit-details dialog.
- **Checks run:** backend type check, 112 / 112 tests, `cdk synth` (new Tasks Lambda, 6 new routes); frontend 73 / 73 tests and build. Not run against real AWS.
- **Not done:** task progress on the Dashboard (needs an aggregate across requests and a decision on "mine" vs "all"); reminders for due tasks (needs EventBridge, TASK 14).

### 14.5 TASK 08 as implemented (branch `task-08-readiness-checklist`)
- **Template (decision):** the six SOW groups, one default item each (Backup, Access, Firewall and connectivity, Team availability, Application dependencies, Documentation), wording in `backend/src/lib/readiness.ts`. It is copied onto the request in the same transaction that moves it Scheduled → Readiness, so later template edits never change running requests.
- **Items:** state `PENDING`, `DONE` or `NOT_APPLICABLE` (a reason is required). The owner or an admin can add custom items (max 30) and delete them; template items cannot be deleted.
- **Who updates (decision):** owner, admin and participants (SOW: "participants update items"). Approvers only read. Items change only while the request is in Readiness.
- **Gate:** Readiness → In Progress is refused with `409 READINESS_INCOMPLETE` while any item is pending; the transaction re-checks every item so a concurrent un-check cannot slip through.
- **Notifications:** every update writes `READINESS_UPDATED`; the owner is told (the existing rule), never the person who made it.
- **API:** `GET/POST /v1/requests/{id}/readiness`, `PATCH/DELETE /v1/requests/{id}/readiness/{itemId}`. **Frontend:** a Readiness tab (live mode only).
- **Checks run:** backend type check, 129 / 129 tests, `cdk synth`; frontend 85 / 85 tests and build. Not run against real AWS.

### 14.6 TASK 09 as implemented (branch `task-09-execution-tracking`, stacked on 08)
SOW 4.7 is only a heading, so these are **decisions to confirm with the owner**:
- The Activity tab is an append-only log of **progress notes** and **issues** for the request. Entries are never edited or deleted.
- An issue has a severity (Low, Medium, High) and is Open until someone resolves it with a description. A resolved issue can be reopened.
- Owner, admin and participants write and resolve; approvers only read. Entries can be added while the request is In Progress or in Validation; everything stays readable afterwards.
- Notifications: a new issue notifies the owner and participants; a resolution notifies the owner and the person who reported it. Notes notify nobody. The text of an entry is never copied into audit entries or notifications.
- API: `GET/POST /v1/requests/{id}/activity`, `PATCH /v1/requests/{id}/activity/{entryId}`. Max 500 entries per request.
- Checks run: backend 142 / 142 tests and `cdk synth`; frontend 94 / 94 tests and build.

### 14.7 TASK 10 as implemented (branch `task-10-validation-and-final-report`, stacked on 09)
SOW 4.9 names the domains; SOW 4.10 is only a heading, so the closure rules are **decisions to confirm with the owner**:
- **Validation:** four checks (Application, Database, Operating system, Infrastructure), created in the same transaction that moves the request to Validation. Each ends as Passed, Failed (note required) or Not applicable (reason required). Owner, admin and participants record results, only while the request is in Validation; approvers read.
- **Closing (Validation → Completed):** every check needs a result and a closing summary (max 5000). If a check failed or an issue is still open, the "remaining issues" text is also required. The transaction re-checks every result, so a concurrent change cannot slip through. Owner or admin only.
- **Final report:** written once in the same transaction (`REPORT#FINAL`, never changed). It is a snapshot: request details, people, approval, timeline, tasks, readiness, validation, issues (open first, max 50, texts shortened to fit DynamoDB's 400 KB item limit). `GET /v1/requests/{id}/report` returns it (404 until the request is completed).
- **Notifications:** closing notifies every member except the actor through the normal status-change notice. The last validation result also writes `VALIDATION_COMPLETED` (owner and participants).
- **Frontend:** Validation and Report tabs (live mode only) and a closing dialog on the "Mark as completed" button.
- **Checks run:** backend 160 / 160 tests and `cdk synth`; frontend 105 / 105 tests and build. Not run against real AWS.
- **Not done:** PDF/export of the report (TASK 13); AI summary (TASK 11).

### 14.8 TASK 11 as implemented (branch `task-11-ai-summary`, stacked on 10)
- **Disabled by default, like email.** `backend/infra/config.ts` → `ai: { enabled: false, modelId: "" }`. While disabled the stack grants no `bedrock:*` permission and no Bedrock client is created; the generate call answers `503 AI_DISABLED` and people can still write the summary by hand. To enable later (needs the owner's approval): enable a Bedrock model for the account, set both fields, deploy. The permission is limited to `bedrock:InvokeModel` on that one model (synth verified both ways). Some models are reachable only through an inference profile; if so, the policy resource must be adjusted when enabling.
- **Flow (decisions):** `POST /v1/requests/{id}/report/summary/generate {language: en|ar}` returns a **draft** from the stored final report and saves nothing. `PUT /v1/requests/{id}/report/summary {text, aiAssisted, language}` saves the text the person reviewed. Owner or admin only; the request must be Completed.
- **"Responsible employee" (decision):** whoever saves the reviewed summary. Their name and the time are stored with it (`aiSummary` on the report).
- **Safety:** the report text is user-written, so it is sent to the model as delimited data and the system prompt says to ignore instructions inside it; the client cannot choose the model; model errors become `502 AI_UNAVAILABLE` without details; the text is not copied into audit entries.
- **Dependencies:** `@aws-sdk/client-bedrock-runtime` 3.1167.0 (same version as the other AWS SDK clients).
- **Frontend:** an "Activity summary" panel in the Report tab: language, Generate, edit, Save, Discard; the saved summary shows who reviewed it and whether AI helped.
- **Not verified:** a real Bedrock call (nothing is deployed). Prompt quality and the Arabic output need a human check once enabled.
- **Not done:** storing the summary in S3 (SOW 5.7 mentions it); it is stored in the table with the report.
- **Checks run:** backend 174 / 174 tests and `cdk synth`; frontend 110 / 110 tests and build.

### 14.9 TASK 12 as implemented (branch `task-12-scheduling-and-conflicts`, stacked on 11)
The SOW does not define a conflict, so this is a **decision to confirm with the owner**. Conflicts are **warnings only**; nothing is blocked.
- **Definition:** two planned or running activities (Pending Approval to Validation; not Draft, Rejected, Cancelled, Completed) conflict when their time windows overlap **and** either (a) they are in the same environment and share an affected system (names compared ignoring case and spaces), or (b) the same person is an active owner or participant of both (approvers do not count). A window is start..end, or the 24 hours after the start when there is no end. Touching windows do not overlap.
- **Per request:** `GET /v1/requests/{id}/conflicts` (also for drafts, so a clash is visible before submitting). A conflict with an activity the caller is not part of is **redacted**: no number, title, systems or names (only the time window and the kind of clash).
- **Schedule:** `GET /v1/schedule?from=&to=` (max 62 days, default next 30). Admins see every activity; everyone else sees the activities they belong to. Each item has `conflictCount` computed against all planned activities, returned only as a count.
- **Frontend:** a Schedule page (live mode only; mock mode keeps the placeholder) with a month switcher, activities grouped by day, conflict badges; a "Schedule conflicts" card on Request Details.
- **Limitation:** activities are indexed by start month only. The previous month is also read, so activities running up to about a month are found; longer ones can be missed. At most 200 activities are compared per call (`truncated` is returned).
- **Not done:** Dashboard alerts for conflicts (kept out so the Dashboard and its mock mode stay unchanged), a calendar grid view, reminders (TASK 14).
- **Checks run:** backend 191 / 191 tests and `cdk synth` (the new Schedule Lambda is read-only); frontend 120 / 120 tests and build.

### 14.10 TASK 13 as implemented (branch `task-13-team-settings-reports`, stacked on 12)
No new backend routes: the pages use `GET /users`, `GET /requests`, `PATCH /me` and `GET /requests/{id}/report`. All three pages exist in live mode only; mock mode keeps its placeholders.
- **Team:** a name search over the people directory (at least 2 letters, "can approve" filter). People appear after their first sign-in; no email addresses are shown.
- **Settings:** change your display name and the email-notification preference (`PATCH /me`). The email address is read-only. Email is sent only when the platform has email turned on (still disabled).
- **Reports (decision on formats):** finished requests (Completed or Cancelled) with search and paging, a link that opens the request's **Report** tab, and a **CSV export** of the list. Cells that start with `=`, `+`, `-` or `@` are prefixed with an apostrophe so spreadsheets never run them as formulas; the file has a UTF-8 BOM so Arabic opens correctly. One final report can be **printed or saved as PDF** from the Report tab (browser print, print styles hide the menus). No server-side PDF.
- **Not done:** reports across many requests (charts, per-team statistics), a PDF generated on the server, a notification history page, a profile picture.
- **Checks run:** frontend 135 / 135 tests and build; backend unchanged (191 / 191).

### 14.11 TASK 14: deployment (done for `dev`, 2026-11-17)
- **What:** `cdk deploy` of `Muead-dev` into one AWS account (the one behind the `signin` profile), region `us-east-1`; the account already held other stacks and an existing CDK bootstrap, so `cdk bootstrap` was not needed. Resources are all prefixed `muead-dev-`.
- **Public identifiers** (not secrets; also printed by `cdk deploy`): API `https://5s19fiqr8g.execute-api.us-east-1.amazonaws.com/v1/`, user pool `us-east-1_Ob74tMeX5`, app client `7tbib7phcl7dl7umjpdf8tpt3j`, table `muead-dev-main`.
- **Verified against real AWS** by `backend/scripts/e2e-smoke.mjs` (28 steps, all passed): SRP sign-in, profile creation, create with all SOW fields, directory search without emails, approver assignment, submit, inbox, **DynamoDB stream → notifier → bell notifications**, approval, schedule and conflicts, Scheduled → Readiness (checklist created), the readiness gate, tasks, activity log, Validation, the closing gate, closing with the final report, the report read by the approver, AI disabled (503) with a written summary saved, dashboard and lists. This confirms the transactions, condition expressions, indexes, authorizer and stream filter on the real services.
- **Not covered by the smoke test:** file upload to S3 with pre-signed URLs from a browser (CORS), participation confirmation with a third user, ALL approval policy with several approvers, email, AI, and the UI itself in a browser against the real API.
- **Test data left behind:** two users `e2e.owner@muead-test.example` and `e2e.approver@muead-test.example` (passwords were not stored in the repository) and one completed request. Delete them before real use.
- **Runbook:** `docs/DEPLOYMENT.md`. Local connection: `frontend/.env.local` (git-ignored).
- **Still open:** hosting (Amplify) and the production CORS origin, SES and Bedrock decisions, CloudWatch alarms, a dead-letter queue, EventBridge reminders, MFA in the UI, deploying with a named IAM user instead of the account root (the `signin` session used for this deploy was the root user).

### 14.12 Approvers are the managers, assigned automatically (change requested by the owner, 2026-11-17)
This **replaces** the earlier rule that the owner chooses approvers (sections 8, 9 and TASK 04 describe the old behaviour for adding approvers; everything else there still holds).
- **Who is a manager:** everyone in the Cognito group `ApprovalEligible` (the group name is unchanged; the UI calls them managers) who has signed in at least once (the group mirror is written at sign-in) and whose profile is active.
- **At submit** (`POST /v1/requests/{id}/submit`) the backend picks the managers, in the same transaction creates the round, one decision record per manager **and** an `APPROVER` member for each (`assignedByRole: SYSTEM`), and removes approvers of an earlier round who are no longer managers. Skipped: the **owner**, the **person submitting** (nobody makes themselves an approver, admins included), and anyone who already has another role in the request (a manager who is a participant stays a participant). The list is recomputed on every submission.
- **Errors:** `409 NO_APPROVERS` when nobody is left (managers must sign in once); `409 APPROVER_LIMIT` above 30 managers (`MAX_APPROVERS` was 20; the submit transaction writes up to 3 items per manager).
- **Choosing is gone:** `POST /requests/{id}/members` with `activityRole: APPROVER` and removing an approver answer `409 APPROVERS_AUTOMATIC`. Participants are unchanged. The approval policy (ANY_ONE / ALL) is still chosen by the owner; with ALL every manager must approve.
- **Frontend:** the Approvers card is titled "Approvers (managers)", has no Add/Remove, explains that the request goes to the managers, and "Submit for approval" no longer needs an approver first. The add dialog is participants-only.
- **Limitations:** a manager appears only after their first sign-in; a revoked group membership takes effect at that person's next sign-in (mirror refresh) and, for decisions, within the token lifetime; there is no per-team or per-department routing (every manager gets every request).
- **Verified:** backend 197 / 197 tests, frontend 137 / 137, and the 28-step smoke test against the deployed stack (the stack was updated in place).

### 14.2 Roadmap
> **Recommendation**, not SOW text: acceptance criteria are suggestions to confirm with the owner.

| # | Task | SOW | What's missing | Depends on | Still needs a decision |
|---|---|---|---|---|---|
| **06 (A)** | **Request lifecycle and complete request form. DONE locally on branch `task-06-request-lifecycle` (not committed, not pushed).** See section 14.3. | 4.2, 4.4 | — | — | Rules chosen for the open points are listed in 14.3; confirm them with the owner |
| 07 (B) | Participation and tasks. **DONE locally on branch `task-07-participation-and-tasks`.** See section 14.4. | 4.3, 4.4 | — | — | Rules chosen for the open points are in 14.4; Dashboard task progress is not built |
| 08 (C) | Readiness checklist. **DONE locally on branch `task-08-readiness-checklist`.** See section 14.5. | 4.6 | — | — | Template wording and who may mark items were decided in 14.5; confirm with the owner |
| 09 (D) | Maintenance execution tracking. **DONE locally on branch `task-09-execution-tracking` (built on 08).** See section 14.6. | 4.7 (heading only) | — | — | The SOW has no criteria: everything in 14.6 is a decision to confirm with the owner |
| 10 (E) | Validation, final report and closure. **DONE locally on branch `task-10-validation-and-final-report` (stacked on 09).** See section 14.7. | 4.9, 4.10 (heading only) | — | — | SOW 4.10 has no criteria: the closure rules in 14.7 are decisions to confirm with the owner |
| 11 (F) | AI activity summary. **DONE locally on branch `task-11-ai-summary` (stacked on 10), DISABLED by default.** See section 14.8. | 4.8, 5.7 | — | 07, 09, 10 | Model id and who may enable it (14.8) |
| 12 (G) | Scheduling and conflicts. **DONE locally on branch `task-12-scheduling-and-conflicts` (stacked on 11).** See section 14.9. | 4.4 | — | 06 | The conflict definition in 14.9 is a decision to confirm; Dashboard conflict alerts are not built |
| 13 (H) | Team, Settings and Reports pages. **DONE locally on branch `task-13-team-settings-reports` (stacked on 12).** See section 14.10. | 4.4 | — | 10, 11 | Report formats were decided in 14.10 (CSV list, print/PDF for one report) |
| 14 (I) | Deployment and operations | 5.1, 5.5, 5.6, 5.9 | First deploy (by the owner), test users, end-to-end test with two users, Amplify plus CORS update, EventBridge reminders, Step Functions decision, enable SES, alarms, dead-letter queue, MFA in the UI, token-storage review | — (reminders need 06 and 07) | When to deploy; SES sender |

**Suggested acceptance criteria for TASK 06:**
- Every transition is allowed only from the previous status, by an authorized activity role, with a `version` check.
- Approved stays visible.
- Cancelled stops further transitions.
- Each transition writes an audit entry and notifies members.
- The form saves all SOW fields with the confirmed dropdowns.
- Mock mode is unchanged.
- There are tests for every allowed and forbidden transition.

**Recommended order:** 06 → 07 → 08 → 09 → 10 → 11, with 12 after 06 and 13 at the end. 14 (deploy and end-to-end test) as soon as the owner approves, ideally early, to validate the real AWS behaviour.

---

## 15. Known limitations, risks and untested behavior

1. **Fake database:** `backend/test/helpers/fakeDb.ts` doesn't evaluate most condition expressions, doesn't apply transactions, and supports only simple key conditions. Concurrency, retries, conditional failures and index queries are therefore **not proven against DynamoDB**.
2. **Never deployed:** Cognito sign-in, the API Gateway authorizer, CORS, pre-signed S3, the DynamoDB stream, its filter and TTL have never run for real. There has been no end-to-end AWS test.
3. **Email / SES:** disabled; only tested with an injected test sender.
4. **No dead-letter queue:** notifications that fail all retries are lost (logged only).
5. **Stale eligibility:** the stored `ApprovalEligible` copy refreshes on the user's next sign-in. Decisions use the live token, so revocation takes effect within an hour.
6. **Directory:** users appear after their first sign-in; search matches only the start of a name.
7. **Missing source files:** the **SOW PDF and the UI-reference PDF are not in the repository or anywhere in the project workspace**, and the official logo asset is missing.
8. **Limits:**
   - counts and dashboard read at most 2,000 items;
   - the unread count scans the user's notifications from the last 180 days;
   - upcoming activities are indexed by their start month only;
   - days are counted in UTC;
   - the target date is stored without a timezone.
9. **Frontend:** tokens are in `localStorage`; no MFA in the UI; CORS allows only `http://localhost:8002`; categories come from the visual reference; the "Assigned to" column always shows "—"; the filter button and the ⋮ menus do nothing.
10. **Dependencies:** backend `npm audit` shows 2 moderate findings in a build-time-only library inside `aws-cdk-lib`; frontend shows 0.
11. **Git:** TASK 04 and TASK 05 are pushed but **not merged**. There are no pull requests, and the branches are stacked (`task-05-notifications` is built on `task-04`).
12. **Test account:** the owner's test user hasn't been created; create it only after deployment, with no group by default.

---

## 16. Security decisions and AWS deployment restrictions

- **No customer account access.** The platform never connects directly to customers' AWS accounts.
- **No secrets** (passwords, keys, tokens, account ids) in code, commits, docs or reports. `.env` files are git-ignored except `.env.example`, which holds no values. Users get temporary passwords set outside the code.
- **Email is disabled by default.** Enabling it needs a verified sender and the owner's approval.
- **No AWS deployment** (`cdk bootstrap`, `cdk deploy`, `cdk destroy`) and no resource changes without explicit approval. The owner deploys.
- **No commits, pushes, merges, branch renames or deletions** without approval. Stage files by name.
- **Local tests don't prove AWS behaviour.** Treat real DynamoDB, Cognito, S3, stream and SES behaviour as unverified until tested after deployment.
- **Roles are per activity.** Never add global approval authority, and never let admins bypass the self-approval rules.
- **Keep the design fixed** and mock mode unchanged.

---

## 17. Step-by-step instructions for the next developer

> **"Do not start coding immediately. First read this handover document, inspect the repository and Git status, review the SOW and design reference, and understand the completed tasks. Then ask the project owner to confirm the next task before making changes."**

1. **Get the repository:** `git clone https://github.com/Elenore68/Muead.git`, then `git switch task-05-notifications` (section 12). Work in this existing repository; don't start a new project.
2. **Read this document fully**, then `docs/backend/api-specification.md` sections 11–13, `docs/backend/database-design.md` section 8, and `docs/design/*.md`.
3. **Inspect Git:** `git status`, `git branch -vv`, `git log --oneline --graph --all -8`, `git fetch origin`. Compare with section 12. You should be on `task-05-notifications`; its newest commit adds this document, and the commit before it is TASK 05 (`8748293`).
4. **Get the SOW PDF and the UI-reference PDF** from the project owner and read them.
5. **Install and run the local checks** (section 6). Expect 68 / 68 backend tests, 41 / 41 frontend tests, and a passing build and synth.
6. **Understand the completed tasks** (section 7) and the role and approval rules (sections 8–9).
7. **Ask the owner to confirm the next task.** The recommendation is TASK 06, with its decisions already confirmed in section 14.1, but confirm the open points in 14.2 first.
8. **After confirmation**, create the task branch (`task-06-request-lifecycle`) only with the owner's approval, and implement one task at a time. Follow the existing patterns:
   - pure rules in `backend/src/lib/`;
   - transactions with conditions and an audit entry;
   - aliased attribute names;
   - consistent reads for transitions;
   - abort-safe frontend hooks;
   - mock mode unchanged.
9. **Run all checks** and write down the results, including anything you couldn't verify.
10. **Never deploy, push or merge without approval.**

---

## 18. Handover checklist

- [ ] Cloned the repository and switched to `task-05-notifications` (TASK 05 commit `8748293` plus this document)
- [ ] Received the SOW PDF and the UI-reference PDF (and the official logo, if available)
- [ ] Read this document, `api-specification.md` sections 11–13, `database-design.md` section 8 and `docs/design/*.md`
- [ ] Verified the Git state matches section 12
- [ ] Installed dependencies in `backend/` and `frontend/`
- [ ] Backend: `npx tsc --noEmit` passes
- [ ] Backend: `npm test` → 68 / 68
- [ ] Backend: `npx cdk synth --quiet` passes (local only)
- [ ] Frontend: `npm test` → 41 / 41
- [ ] Frontend: `npm run build` passes
- [ ] Checked mock mode at http://localhost:8002 (`npm run dev`)
- [ ] Understood the confirmed decisions in section 14.1 (lifecycle with a visible **Approved**, Withdrawn → Draft with history kept, dropdown values)
- [ ] Asked the owner to confirm the next task and the open points in 14.2
- [ ] Agreed with the owner whether and when to open pull requests and merge TASK 04 and TASK 05 into `main`
- [ ] Agreed when the first deployment and end-to-end test will happen
- [ ] Never committed `frontend/tsconfig.tsbuildinfo`, `.env.local`, build output or secrets
- [ ] Never deployed, pushed or merged without approval
