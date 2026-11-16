import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
vi.mock("../api/tasks", async (orig) => ({ ...(await orig<typeof import("../api/tasks")>()), createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn() }));
vi.mock("../api/members", async (orig) => ({
  ...(await orig<typeof import("../api/members")>()),
  respondToParticipation: vi.fn(),
  updateMember: vi.fn(),
  removeMember: vi.fn(),
}));
import * as tasksApi from "../api/tasks";
import * as membersApi from "../api/members";
import { ApiClientError, configureClient } from "../api/client";
import type { Member } from "../api/members";
import type { Task, TaskList } from "../api/tasks";
import TasksTab from "../components/TasksTab";
import { ParticipantsCard, type ActivityContext } from "../components/ActivityCards";
import { assignableToTasks, canChangeTaskStatus, canEditMemberDetails, canManageTasks, canRespondToParticipation, type Viewer } from "../data/permissions";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const OWNER = "u-owner", PART = "u-part", OTHER = "u-other";
const member = (userId: string, activityRole: Member["activityRole"], extra: Partial<Member> = {}): Member => ({
  userId, displayName: userId.replace("u-", ""), initials: "XX", activityRole, status: "ACTIVE", specialty: null, responsibilities: null, participation: activityRole === "PARTICIPANT" ? "PENDING" : null,
  assignedBy: { id: OWNER, displayName: "Owner", activityRole: "OWNER" }, assignedAt: "2026-11-12T00:00:00Z", removedBy: null, removedAt: null, ...extra,
});
const owner: Viewer = { activityRole: "OWNER", canEdit: true, canManageMembers: true };
const participant: Viewer = { activityRole: "PARTICIPANT", canEdit: false, canManageMembers: false };
const task = (o: Partial<Task> = {}): Task => ({
  id: "T1", title: "Take backup", description: null, status: "TODO", assignee: { id: PART, displayName: "part", initials: "PA" }, dueDate: null, overdue: false,
  createdBy: { id: OWNER, displayName: "Owner" }, createdAt: "2026-11-12T00:00:00Z", updatedAt: "2026-11-12T00:00:00Z", completedAt: null, version: 3, ...o,
});
const ready = (items: Task[], done = 0): { kind: "ready"; data: TaskList } => ({
  kind: "ready",
  data: { items, progress: { total: items.length, done, inProgress: 0, percent: items.length ? Math.round((done / items.length) * 100) : 0 } },
});

describe("task permissions", () => {
  test("owner/admin manage tasks, not on finished requests; assignees change only their own status", () => {
    expect(canManageTasks(owner, "APPROVED")).toBe(true);
    expect(canManageTasks(owner, "COMPLETED")).toBe(false);
    expect(canManageTasks(participant, "APPROVED")).toBe(false);
    expect(canChangeTaskStatus(participant, "IN_PROGRESS", PART, PART)).toBe(true);
    expect(canChangeTaskStatus(participant, "IN_PROGRESS", PART, OTHER)).toBe(false);
    expect(canChangeTaskStatus(participant, "CANCELLED", PART, PART)).toBe(false);
    expect(canChangeTaskStatus(owner, "IN_PROGRESS", PART, OWNER)).toBe(true);
    expect(canChangeTaskStatus(undefined, "IN_PROGRESS", PART, PART)).toBe(false);
  });
  test("assignable people: owner and participants who have not declined; never approvers or removed members", () => {
    const list = [
      member(OWNER, "OWNER"), member(PART, "PARTICIPANT"), member("u-declined", "PARTICIPANT", { participation: "DECLINED" }),
      member("u-appr", "APPROVER"), member("u-gone", "PARTICIPANT", { status: "REMOVED" }),
    ];
    expect(assignableToTasks(list).map((m) => m.userId)).toEqual([OWNER, PART]);
  });
  test("participation: only for yourself, as a participant, on an unfinished request", () => {
    expect(canRespondToParticipation(member(PART, "PARTICIPANT"), PART, "APPROVED")).toBe(true);
    expect(canRespondToParticipation(member(PART, "PARTICIPANT"), OTHER, "APPROVED")).toBe(false);
    expect(canRespondToParticipation(member(OWNER, "OWNER"), OWNER, "APPROVED")).toBe(false);
    expect(canRespondToParticipation(member(PART, "PARTICIPANT"), PART, "COMPLETED")).toBe(false);
    expect(canRespondToParticipation(undefined, PART, "APPROVED")).toBe(false);
  });
  test("editing member details: owner/admin, not the owner row", () => {
    expect(canEditMemberDetails(owner, "APPROVED", member(PART, "PARTICIPANT"))).toBe(true);
    expect(canEditMemberDetails(owner, "APPROVED", member(OWNER, "OWNER"))).toBe(false);
    expect(canEditMemberDetails(participant, "APPROVED", member(PART, "PARTICIPANT"))).toBe(false);
    expect(canEditMemberDetails(owner, "CANCELLED", member(PART, "PARTICIPANT"))).toBe(false);
  });
});

describe("TasksTab", () => {
  const props = (o: Partial<Parameters<typeof TasksTab>[0]> = {}) => ({
    requestId: "R1", status: "APPROVED" as const, viewer: owner, userId: OWNER, tasks: ready([task()]), members: [member(OWNER, "OWNER"), member(PART, "PARTICIPANT")],
    retry: vi.fn(), onChanged: vi.fn(), notify: vi.fn(), ...o,
  });

  test("shows tasks with progress and the owner's controls", () => {
    render(<TasksTab {...props({ tasks: ready([task(), task({ id: "T2", title: "Check", status: "DONE" })], 1) })} />);
    expect(screen.getByText("1 of 2 done (50%)")).toBeTruthy();
    expect(screen.getByRole("button", { name: /new task/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Take backup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Take backup" })).toBeTruthy();
  });

  test("marks overdue tasks", () => {
    render(<TasksTab {...props({ tasks: ready([task({ dueDate: "2020-01-01", overdue: true })]) })} />);
    expect(screen.getByText(/Overdue/)).toBeTruthy();
  });

  test("a participant sees only a status picker on their own task, and no management buttons", async () => {
    vi.mocked(tasksApi.updateTask).mockResolvedValue(task({ status: "DONE", version: 4 }));
    const p = props({ viewer: participant, userId: PART, tasks: ready([task(), task({ id: "T2", title: "Not mine", assignee: { id: OWNER, displayName: "owner", initials: "OW" } })]) });
    render(<TasksTab {...p} />);
    expect(screen.queryByRole("button", { name: /new task/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByLabelText("Status of Not mine")).toBeNull();
    fireEvent.change(screen.getByLabelText("Status of Take backup"), { target: { value: "DONE" } });
    await waitFor(() => expect(tasksApi.updateTask).toHaveBeenCalledWith("R1", "T1", 3, { status: "DONE" }));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
  });

  test("a refused status change is reported and the list reloads", async () => {
    vi.mocked(tasksApi.updateTask).mockRejectedValue(new ApiClientError(409, "VERSION_CONFLICT", "The task was changed by someone else."));
    const p = props({ viewer: participant, userId: PART });
    render(<TasksTab {...p} />);
    fireEvent.change(screen.getByLabelText("Status of Take backup"), { target: { value: "DONE" } });
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith("error", expect.stringContaining("changed by someone else")));
    expect(p.onChanged).toHaveBeenCalled();
  });

  test("create: title and assignee are required, then the API is called", async () => {
    vi.mocked(tasksApi.createTask).mockResolvedValue(task());
    const p = props();
    render(<TasksTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /new task/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /create task/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/title is required/i);
    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "Run tests" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create task/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/choose who/i);
    expect(tasksApi.createTask).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Assigned to/), { target: { value: PART } });
    fireEvent.change(within(dialog).getByLabelText(/Due date/), { target: { value: "2026-12-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create task/i }));
    await waitFor(() => expect(tasksApi.createTask).toHaveBeenCalledWith("R1", { title: "Run tests", assigneeId: PART, dueDate: "2026-12-01" }));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
  });

  test("a participant who declined is not offered as assignee", () => {
    render(<TasksTab {...props({ members: [member(OWNER, "OWNER"), member(PART, "PARTICIPANT", { participation: "DECLINED" })] })} />);
    fireEvent.click(screen.getByRole("button", { name: /new task/i }));
    const select = screen.getByLabelText(/Assigned to/) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", OWNER]);
  });

  test("delete asks for confirmation", async () => {
    vi.mocked(tasksApi.deleteTask).mockResolvedValue(undefined);
    const p = props();
    render(<TasksTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Take backup" }));
    expect(tasksApi.deleteTask).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(tasksApi.deleteTask).toHaveBeenCalledWith("R1", "T1"));
  });

  test("finished requests: no management, no status pickers", () => {
    render(<TasksTab {...props({ status: "COMPLETED" })} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText("Status of Take backup")).toBeNull();
  });

  test("load error offers a retry", () => {
    const p = props({ tasks: { kind: "error", message: "boom" } });
    render(<TasksTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(p.retry).toHaveBeenCalled();
  });
});

describe("participation in the Participants card", () => {
  const ctx = (callerId: string, members: Member[], o: Partial<ActivityContext> = {}): ActivityContext => ({
    requestId: "R1", status: "APPROVED", version: 3, policy: "ANY_ONE", viewer: callerId === OWNER ? owner : participant, callerId,
    members: { kind: "ready", data: { items: members, limits: { maxApprovers: 20, maxMembers: 50 } } }, retryMembers: vi.fn(), onChanged: vi.fn(), notify: vi.fn(), ...o,
  });
  const all = [member(OWNER, "OWNER"), member(PART, "PARTICIPANT"), member(OTHER, "PARTICIPANT", { participation: "DECLINED", participationNote: "On leave" })];

  test("each participant's answer is visible to everyone", () => {
    render(<ParticipantsCard ctx={ctx(OWNER, all)} />);
    expect(screen.getByText("Awaiting answer")).toBeTruthy();
    expect(screen.getByText("Declined")).toBeTruthy();
    expect(screen.getByText(/On leave/)).toBeTruthy();
  });

  test("the participant sees confirm and decline for themselves only; the owner sees neither", () => {
    render(<ParticipantsCard ctx={ctx(PART, all)} />);
    expect(screen.getByRole("button", { name: /confirm participation/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^decline$/i })).toBeTruthy();
    cleanup();
    render(<ParticipantsCard ctx={ctx(OWNER, all)} />);
    expect(screen.queryByRole("button", { name: /confirm participation/i })).toBeNull();
  });

  test("confirm calls the API and reloads", async () => {
    vi.mocked(membersApi.respondToParticipation).mockResolvedValue({ requestId: "R1", userId: PART, participation: "CONFIRMED", participationAt: "x", participationNote: null });
    const c = ctx(PART, all);
    render(<ParticipantsCard ctx={c} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm participation/i }));
    await waitFor(() => expect(membersApi.respondToParticipation).toHaveBeenCalledWith("R1", "CONFIRMED"));
    await waitFor(() => expect(c.onChanged).toHaveBeenCalled());
  });

  test("decline asks for an optional note and sends it", async () => {
    vi.mocked(membersApi.respondToParticipation).mockResolvedValue({ requestId: "R1", userId: PART, participation: "DECLINED", participationAt: "x", participationNote: "Busy" });
    const c = ctx(PART, all);
    render(<ParticipantsCard ctx={c} />);
    fireEvent.click(screen.getByRole("button", { name: /^decline$/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: "Busy" } });
    fireEvent.click(dialog.querySelector("button[type=submit]")!);
    await waitFor(() => expect(membersApi.respondToParticipation).toHaveBeenCalledWith("R1", "DECLINED", "Busy"));
  });

  test("after confirming, only the decline button remains", () => {
    render(<ParticipantsCard ctx={ctx(PART, [member(OWNER, "OWNER"), member(PART, "PARTICIPANT", { participation: "CONFIRMED" })])} />);
    expect(screen.queryByRole("button", { name: /confirm participation/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^decline$/i })).toBeTruthy();
  });

  test("owner edits specialty and responsibilities", async () => {
    vi.mocked(membersApi.updateMember).mockResolvedValue(member(PART, "PARTICIPANT"));
    const c = ctx(OWNER, all);
    render(<ParticipantsCard ctx={c} />);
    fireEvent.click(screen.getByRole("button", { name: `Edit ${PART.replace("u-", "")}` }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Specialty/), { target: { value: "Database" } });
    fireEvent.change(within(dialog).getByLabelText(/Responsibilities/), { target: { value: " Backups " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(membersApi.updateMember).toHaveBeenCalledWith("R1", PART, { specialty: "Database", responsibilities: "Backups" }));
  });
});

describe("API contract", () => {
  test("tasks and participation use the documented method, path and body", async () => {
    vi.unstubAllGlobals();
    const calls: { url: string; method: string; body: unknown }[] = [];
    configureClient({ getToken: async () => "t", onUnauthorized: () => {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response("{}", { status: 200 });
    }));
    const t = await vi.importActual<typeof import("../api/tasks")>("../api/tasks");
    const m = await vi.importActual<typeof import("../api/members")>("../api/members");
    await t.listTasks("R1");
    await t.createTask("R1", { title: "x", assigneeId: "U1" });
    await t.updateTask("R1", "T1", 2, { status: "DONE" });
    await t.deleteTask("R1", "T1");
    await m.respondToParticipation("R1", "DECLINED", "busy");
    await m.respondToParticipation("R1", "CONFIRMED");
    await m.updateMember("R1", "U1", { specialty: null });
    const B = "https://api.test/v1/requests/R1";
    expect(calls).toEqual([
      { url: `${B}/tasks`, method: "GET", body: undefined },
      { url: `${B}/tasks`, method: "POST", body: { title: "x", assigneeId: "U1" } },
      { url: `${B}/tasks/T1`, method: "PATCH", body: { status: "DONE", version: 2 } },
      { url: `${B}/tasks/T1`, method: "DELETE", body: undefined },
      { url: `${B}/participation`, method: "POST", body: { response: "DECLINED", note: "busy" } },
      { url: `${B}/participation`, method: "POST", body: { response: "CONFIRMED" } },
      { url: `${B}/members/U1`, method: "PATCH", body: { specialty: null } },
    ]);
    vi.unstubAllGlobals();
  });
});
