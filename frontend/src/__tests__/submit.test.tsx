import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
vi.mock("../api/approvals", async (orig) => ({ ...(await orig<typeof import("../api/approvals")>()), submitRequest: vi.fn(), withdrawRequest: vi.fn() }));
import * as approvalsApi from "../api/approvals";
import { ApiClientError } from "../api/client";
import LifecycleCard from "../components/LifecycleCard";
import { EMPTY_VALUES } from "../components/RequestFields";
import type { Viewer } from "../data/permissions";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const owner: Viewer = { activityRole: "OWNER", canEdit: true, canManageMembers: true, lifecycle: { next: null, canCancel: true } };
const participant: Viewer = { activityRole: "PARTICIPANT", canEdit: false, canManageMembers: false };
const card = (o: Partial<Parameters<typeof LifecycleCard>[0]> = {}) => {
  const p = { requestId: "R1", status: "DRAFT" as const, version: 3, viewer: owner, fields: EMPTY_VALUES, onChanged: vi.fn(), notify: vi.fn(), ...o };
  render(<LifecycleCard {...p} />);
  return p;
};

describe("submitting goes straight to the approval stage", () => {
  test("a draft shows Submit for approval: no approver has to be chosen, and there is no approver section", async () => {
    vi.mocked(approvalsApi.submitRequest).mockResolvedValue({ requestId: "R1", status: "PENDING_APPROVAL", approvalRound: 1, approvalPolicy: "ANY_ONE", approvers: 2, version: 4 });
    const p = card();
    expect(screen.queryByText(/Approvers/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Add approver/ })).toBeNull();
    expect(screen.queryByLabelText("Approval policy")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Submit for approval/ })));
    expect(approvalsApi.submitRequest).toHaveBeenCalledWith("R1", 3);
    expect(p.notify).toHaveBeenCalledWith("success", "The request was sent for approval.");
    expect(p.onChanged).toHaveBeenCalled();
  });

  test("a rejected request can be submitted again", () => {
    card({ status: "REJECTED" });
    expect(screen.getByRole("button", { name: /Submit for approval/ })).toBeTruthy();
    expect(screen.getByText(/Rejected. Edit the request and submit it again/)).toBeTruthy();
  });

  test("when nobody can approve yet, the backend message is shown and the page reloads", async () => {
    vi.mocked(approvalsApi.submitRequest).mockRejectedValue(new ApiClientError(409, "NO_APPROVERS", "No manager is available to approve this request yet."));
    const p = card();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Submit for approval/ })));
    expect(p.notify).toHaveBeenCalledWith("error", expect.stringContaining("No manager is available"));
    expect(p.onChanged).toHaveBeenCalled();
  });

  test("only the owner (or an admin) sees Submit; once pending nobody does", () => {
    card({ viewer: participant });
    expect(screen.queryByRole("button", { name: /Submit for approval/ })).toBeNull();
    cleanup();
    card({ status: "PENDING_APPROVAL" });
    expect(screen.queryByRole("button", { name: /Submit for approval/ })).toBeNull();
    expect(screen.getByText("Waiting for approval.")).toBeTruthy();
  });

  test("while waiting, the owner can withdraw with a reason", async () => {
    vi.mocked(approvalsApi.withdrawRequest).mockResolvedValue({ requestId: "R1", status: "DRAFT", approvalState: "WITHDRAWN", round: 1, closedRecords: 1, version: 5 });
    const p = card({ status: "PENDING_APPROVAL", version: 4 });
    fireEvent.click(screen.getByRole("button", { name: /Withdraw/ }));
    const dialog = screen.getByRole("dialog", { name: "Withdraw request" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw" }));
    expect(approvalsApi.withdrawRequest).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Wrong date" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw" })));
    expect(approvalsApi.withdrawRequest).toHaveBeenCalledWith("R1", "Wrong date", 4);
    expect(p.onChanged).toHaveBeenCalled();
  });

  test("participants cannot withdraw", () => {
    card({ status: "PENDING_APPROVAL", viewer: participant });
    expect(screen.queryByRole("button", { name: /Withdraw/ })).toBeNull();
  });
});
