import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../config", () => ({ config: { apiEnabled: true, apiBaseUrl: "https://api.test/v1", userPoolId: "p", clientId: "c" } }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "u1", email: "x", displayName: "Sara", initials: "Sa", roles: [] }, signOut: () => {} }) }));
vi.mock("../components/NotificationBell", () => ({ default: () => null }));
vi.mock("../api/requests", async (orig) => ({
  ...(await orig<typeof import("../api/requests")>()),
  createRequest: vi.fn(),
  uploadAttachment: vi.fn(),
  getReferenceData: vi.fn(async () => ({ categories: ["IT"], priorities: [], environments: ["Staging"], cloudPlatforms: ["AWS"], maintenanceTypes: ["Patching"] })),
}));
import * as api from "../api/requests";
import NewRequest from "../pages/NewRequest";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const Where = () => {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}|{JSON.stringify(loc.state)}</div>;
};

test("after creating, the new request itself opens (not the list that may be a moment behind), with a message", async () => {
  vi.mocked(api.createRequest).mockResolvedValue({ id: "01JNEW", requestNo: "REQ-0005" });
  render(
    <MemoryRouter initialEntries={["/requests/new"]}>
      <Routes>
        <Route path="/requests/new" element={<NewRequest />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Patch production database" } });
  fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: "Monthly patch" } });
  fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "IT" } });
  fireEvent.change(screen.getByLabelText(/^Priority/), { target: { value: "MEDIUM" } });
  fireEvent.change(screen.getByLabelText("Target date"), { target: { value: "2026-12-20" } });
  fireEvent.change(screen.getByLabelText(/^Environment/), { target: { value: "Staging" } });
  fireEvent.change(screen.getByLabelText(/^Cloud Platform/), { target: { value: "AWS" } });
  fireEvent.change(screen.getByLabelText(/^Maintenance Type/), { target: { value: "Patching" } });
  fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
  const where = await screen.findByTestId("where");
  await waitFor(() => expect(where.textContent).toMatch(/^\/requests\/01JNEW\|/));
  expect(where.textContent).toContain("REQ-0005 was created as a draft");
  expect(where.textContent).toContain('"kind":"success"');
});
