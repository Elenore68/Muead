import type { Item } from "./db";
import { progressOf as taskProgress } from "./tasks";
import { progressOf as readinessProgress } from "./readiness";
import { summaryOf as activitySummary } from "./activity";
import { toValidationApi, validationProgress, type Closure } from "./validation";

/**
 * TASK 10: the final report, written once when a request is closed (VALIDATION -> COMPLETED) and never changed.
 * It is a snapshot, so later renames or removals do not rewrite history.
 */
export const MAX_REPORT_ISSUES = 50;
const clip = (v: unknown, n = 300) => (typeof v === "string" && v.length > n ? `${v.slice(0, n)}…` : (v ?? null));
const reportIssues = (activity: Item[]) =>
  activity
    .filter((e) => e.type === "ISSUE")
    .sort((a, b) => Number(b.state === "OPEN") - Number(a.state === "OPEN") || String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, MAX_REPORT_ISSUES)
    .map((e) => ({ text: clip(e.text), severity: e.severity, state: e.state, resolutionNote: clip(e.resolutionNote) }));

export const reportKey = (requestId: string) => ({ PK: `REQ#${requestId}`, SK: "REPORT#FINAL" });

export const buildReport = (p: {
  request: Item;
  members: Item[];
  tasks: Item[];
  readiness: Item[];
  validation: Item[];
  activity: Item[];
  closure: Closure;
  completedBy: { userId: string; displayName: string };
  now: string;
}): Item => {
  const r = p.request;
  const active = p.members.filter((m) => m.status === "ACTIVE");
  const person = (m: Item) => ({ id: m.userId, displayName: m.displayName, specialty: m.specialty ?? null, participation: m.activityRole === "PARTICIPANT" ? m.participation ?? "PENDING" : null });
  return {
    ...reportKey(r.id),
    entityType: "FINAL_REPORT",
    requestId: r.id,
    generatedAt: p.now,
    completedBy: p.completedBy.userId,
    completedByName: p.completedBy.displayName,
    summary: p.closure.summary,
    remainingIssues: p.closure.remainingIssues,
    request: {
      requestNo: r.requestNo,
      title: r.title,
      description: r.description,
      category: r.category ?? null,
      priority: r.priority ?? null,
      environment: r.environment ?? null,
      cloudPlatform: r.cloudPlatform ?? null,
      maintenanceType: r.maintenanceType ?? null,
      scope: r.scope ?? null,
      affectedSystems: r.affectedSystems ?? [],
      schedule: r.scheduleStart ? { start: r.scheduleStart, end: r.scheduleEnd ?? null } : null,
    },
    people: {
      owner: { id: r.ownerId, displayName: r.ownerName },
      participants: active.filter((m) => m.activityRole === "PARTICIPANT").map(person),
      approvers: active.filter((m) => m.activityRole === "APPROVER").map((m) => ({ id: m.userId, displayName: m.displayName })),
    },
    approval: { policy: r.approvalPolicy ?? "ANY_ONE", rounds: r.approvalRound ?? 0, decidedAt: r.approvalDecidedAt ?? null },
    timeline: {
      createdAt: r.createdAt,
      submittedAt: r.submittedAt ?? null,
      approvedAt: r.approvalDecidedAt ?? null,
      scheduledAt: r.scheduledAt ?? null,
      readinessStartedAt: r.readinessStartedAt ?? null,
      startedAt: r.startedAt ?? null,
      validationStartedAt: r.validationStartedAt ?? null,
      completedAt: p.now,
    },
    tasks: {
      ...taskProgress(p.tasks),
      items: p.tasks.map((t) => ({ title: t.title, assignee: t.assigneeName, status: t.status, dueDate: t.dueDate ?? null })),
    },
    readiness: { ...readinessProgress(p.readiness), items: p.readiness.map((i) => ({ group: i.group, title: i.title, state: i.state, note: i.note ?? null })) },
    validation: { ...validationProgress(p.validation), items: p.validation.map(toValidationApi).map((i) => ({ domain: i.domain, result: i.result, note: i.note })) },
    activity: {
      ...activitySummary(p.activity),
      // DynamoDB items are limited to 400 KB: open issues first, at most MAX_REPORT_ISSUES, long texts shortened.
      issues: reportIssues(p.activity),
      issuesShown: reportIssues(p.activity).length,
    },
  };
};

export const toReportApi = (item: Item) => {
  const { PK, SK, entityType, ...rest } = item;
  void PK; void SK; void entityType;
  return rest;
};
