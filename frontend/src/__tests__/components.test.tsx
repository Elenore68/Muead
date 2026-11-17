import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ profile: { id: "u-sara", email: "x", displayName: "Sara", initials: "Sa", roles: ["ApprovalEligible"] }, signOut: () => {} }),
}));
vi.mock("../api/approvals", async (orig) => ({
  ...(await orig<typeof import("../api/approvals")>()),
  decide: vi.fn(),
  submitRequest: vi.fn(),
  withdrawRequest: vi.fn(),
  setApprovalPolicy: vi.fn(),
  listApprovals: vi.fn(),
  getApprovalSummary: vi.fn(),
}));
vi.mock("../api/members", async (orig) => ({
  ...(await orig<typeof import("../api/members")>()),
  searchUsers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
}));

import * as approvalsApi from "../api/approvals";
import * as membersApi from "../api/members";
import type { Member, MembersResponse } from "../api/members";
import DecisionPanel from "../components/DecisionPanel";
import AddMemberDialog from "../components/AddMemberDialog";
import { ParticipantsCard, type ActivityContext } from "../components/ActivityCards";
import Approvals from "../pages/Approvals";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const member = (userId: string, activityRole: Member["activityRole"], extra: Partial<Member> = {}): Member => ({
  userId, displayName: userId.replace("u-", ""), initials: "XX", activityRole, status: "ACTIVE", specialty: null, responsibilities: null,
  assignedBy: { id: "u-owner", displayName: "Owner", activityRole: "OWNER" }, assignedAt: "2026-11-12T00:00:00Z", removedBy: null, removedAt: null, ...extra,
});
const membersState = (items: Member[]) => ({ kind: "ready" as const, data: { items, limits: { maxApprovers: 20, maxMembers: 50 } } satisfies MembersResponse });

/* ------------------------------------------------------------------ decision controls */
describe("DecisionPanel", () => {
  const props = { requestId: "R1", requestNo: "REQ-0001", onDecided: vi.fn(), onConflict: vi.fn() };

  test("renders nothing for anyone who may not decide", () => {
    const { container } = render(<DecisionPanel {...props} canDecide={false} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("button", { name: /approve|reject/i })).toBeNull();
  });

  test("shows the caller's own past decision instead of controls", () => {
    render(<DecisionPanel {...props} canDecide={false} myRecord={{ decision: "APPROVED", decidedAt: "2026-11-12T10:00:00Z" }} />);
    expect(screen.getByText(/Your decision: Approved/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
  });

  test("reject requires a comment; then calls the API with it", async () => {
    vi.mocked(approvalsApi.decide).mockResolvedValue({ requestId: "R1", round: 1, decision: "REJECTED", requestStatus: "PENDING_APPROVAL", roundStatus: "OPEN", version: 5 });
    render(<DecisionPanel {...props} canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("dialog", { name: "Reject REQ-0001" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(within(dialog).getByRole("alert").textContent).toMatch(/Comment is required/);
    expect(approvalsApi.decide).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Rollback plan missing" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Reject" })));
    expect(approvalsApi.decide).toHaveBeenCalledWith("R1", "REJECTED", "Rollback plan missing");
    expect(props.onDecided).toHaveBeenCalled();
  });

  test("approve without a comment sends no comment", async () => {
    vi.mocked(approvalsApi.decide).mockResolvedValue({ requestId: "R1", round: 1, decision: "APPROVED", requestStatus: "APPROVED", roundStatus: "APPROVED", version: 5 });
    render(<DecisionPanel {...props} canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await act(async () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" })));
    expect(approvalsApi.decide).toHaveBeenCalledWith("R1", "APPROVED", undefined);
  });

  test("409 keeps the dialog open with the backend message and asks the page to reload", async () => {
    const { ApiClientError } = await import("../api/client");
    vi.mocked(approvalsApi.decide).mockRejectedValue(new ApiClientError(409, "NOT_PENDING", "This request is not waiting for approval"));
    render(<DecisionPanel {...props} canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await act(async () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" })));
    expect(screen.getByRole("dialog").textContent).toMatch(/not waiting for approval/);
    expect(props.onConflict).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ member cards */
describe("Participants card", () => {
  const ctx = (o: Partial<ActivityContext>): ActivityContext => ({
    requestId: "R1", status: "DRAFT", version: 3, policy: "ANY_ONE", callerId: "u-sara",
    viewer: { activityRole: "OWNER", canEdit: true, canManageMembers: true },
    members: membersState([member("u-owner", "OWNER"), member("u-ali", "APPROVER"), member("u-part", "PARTICIPANT", { specialty: "SecurityNetwork", responsibilities: "Firewall" })]),
    retryMembers: vi.fn(), onChanged: vi.fn(), notify: vi.fn(), ...o,
  });
  test("owner in DRAFT can add and remove participants; approvers are not listed here", () => {
    render(<ParticipantsCard ctx={ctx({})} />);
    expect(screen.getByRole("button", { name: /Add participant/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove part" })).toBeTruthy();
    expect(screen.getByText("Security / Network · Firewall")).toBeTruthy();
    expect(screen.queryByText("ali")).toBeNull();
  });
  test("a member who is not the owner is read-only", () => {
    const c = ctx({ viewer: { activityRole: "APPROVER", canEdit: false, canManageMembers: false }, status: "PENDING_APPROVAL" });
    render(<ParticipantsCard ctx={c} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
  test("participants are locked while the request waits for approval", () => {
    render(<ParticipantsCard ctx={ctx({ status: "PENDING_APPROVAL" })} />);
    expect(screen.queryByRole("button", { name: /Add participant|Remove/ })).toBeNull();
  });
});
/* ------------------------------------------------------------------ directory */
describe("AddMemberDialog", () => {
  test("participant search hides people already in the request and the caller's own role rules, and never shows email", async () => {
    vi.mocked(membersApi.searchUsers).mockResolvedValue({
      items: [
        { id: "u-ali", displayName: "Ali", initials: "Al", approvalEligible: true },
        { id: "u-saad", displayName: "Saad", initials: "Sa", approvalEligible: false },
      ],
      nextToken: null,
    });
    vi.mocked(membersApi.addMember).mockResolvedValue(member("u-saad", "PARTICIPANT"));
    const onAdded = vi.fn();
    render(<AddMemberDialog requestId="R1" role="PARTICIPANT" members={[member("u-owner", "OWNER"), member("u-ali", "APPROVER")]} callerId="u-sara" onAdded={onAdded} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Add participant" })).toBeTruthy();
    expect(document.body.textContent).toMatch(/goes to the managers when it is submitted/);
    fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "s" } });
    await new Promise((r) => setTimeout(r, 350));
    expect(membersApi.searchUsers).not.toHaveBeenCalled(); // < 2 characters
    fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "sa" } });
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(membersApi.searchUsers).toHaveBeenCalledWith({ q: "sa", approverEligible: false, limit: 20 }, expect.anything());
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["SaSaad"]); // Ali already approves this request
    expect(document.body.textContent).not.toMatch(/@/);
    fireEvent.click(screen.getByRole("button", { name: /Saad/ }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add Saad" })));
    expect(membersApi.addMember).toHaveBeenCalledWith("R1", { userId: "u-saad", activityRole: "PARTICIPANT" });
    expect(onAdded).toHaveBeenCalled();
  });
  test("participant: specialty and responsibilities are sent; backend errors are shown", async () => {
    const { ApiClientError } = await import("../api/client");
    vi.mocked(membersApi.searchUsers).mockResolvedValue({ items: [{ id: "u-noor", displayName: "Noor", initials: "No", approvalEligible: false }], nextToken: null });
    vi.mocked(membersApi.addMember).mockRejectedValue(new ApiClientError(409, "ROLE_CONFLICT", "This person is already the approver of this request."));
    render(<AddMemberDialog requestId="R1" role="PARTICIPANT" members={[]} callerId="u-sara" onAdded={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "no" } });
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(membersApi.searchUsers).toHaveBeenCalledWith({ q: "no", approverEligible: false, limit: 20 }, expect.anything());
    fireEvent.click(screen.getByRole("button", { name: /Noor/ }));
    fireEvent.change(screen.getByLabelText(/Specialty/), { target: { value: "Database" } });
    fireEvent.change(screen.getByLabelText(/Responsibilities/), { target: { value: "Run backups" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add Noor" })));
    expect(membersApi.addMember).toHaveBeenCalledWith("R1", { userId: "u-noor", activityRole: "PARTICIPANT", specialty: "Database", responsibilities: "Run backups" });
    expect(screen.getByRole("alert").textContent).toMatch(/already the approver/);
  });
});

/* ------------------------------------------------------------------ inbox page */
describe("Approvals page (live)", () => {
  const item = (o: Partial<approvalsApi.ApprovalItem>): approvalsApi.ApprovalItem => ({
    approvalId: "R1:1", requestId: "R1", requestNo: "REQ-0001", title: "Patch DB", description: "Monthly", requestedBy: { id: "u-owner", displayName: "Owner", initials: "Ow" },
    category: "IT", priority: "HIGH", round: 1, policy: "ANY_ONE", decision: "PENDING", comment: null, submittedAt: "2026-11-12T00:00:00Z", decidedAt: null,
    requestStatus: "PENDING_APPROVAL", canDecide: true, blockedReason: null, ...o,
  });

  test("counts from the summary; buttons only where canDecide", async () => {
    vi.mocked(approvalsApi.getApprovalSummary).mockResolvedValue({ pending: 2, approved: 5, rejected: 1 });
    vi.mocked(approvalsApi.listApprovals).mockResolvedValue({
      items: [item({}), item({ approvalId: "R2:1", requestId: "R2", requestNo: "REQ-0002", canDecide: false, blockedReason: "NOT_ELIGIBLE" })],
      nextToken: null,
    });
    render(<MemoryRouter><Approvals /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("REQ-0002")).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Pending (2)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Approved (5)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve REQ-0001" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve REQ-0002" })).toBeNull();
    expect(screen.getByText(/not in the ApprovalEligible group/)).toBeTruthy();
    expect(approvalsApi.listApprovals).toHaveBeenCalledWith({ decision: "PENDING", q: undefined, limit: 10, nextToken: undefined }, expect.anything());
  });

  test("rejected tab: decision shown, no controls; ANY_ONE request still pending is explained", async () => {
    vi.mocked(approvalsApi.getApprovalSummary).mockResolvedValue({ pending: 0, approved: 0, rejected: 1 });
    vi.mocked(approvalsApi.listApprovals).mockResolvedValue({ items: [], nextToken: null });
    render(<MemoryRouter><Approvals /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("All caught up.")).toBeTruthy());
    vi.mocked(approvalsApi.listApprovals).mockResolvedValue({
      items: [item({ decision: "REJECTED", canDecide: false, blockedReason: "DECIDED", decidedAt: "2026-11-12T01:00:00Z" })],
      nextToken: null,
    });
    fireEvent.click(screen.getByRole("tab", { name: "Rejected (1)" }));
    await waitFor(() => expect(screen.getByText(/still waiting for other approvers/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Approve REQ|Reject REQ/ })).toBeNull();
  });
});
