import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import UserMenu from "../components/UserMenu";

afterEach(cleanup);
const menu = (roles: string[] = []) => {
  const onSignOut = vi.fn();
  render(<MemoryRouter><UserMenu name="Demo Maintenance" initials="DM" email="maintenance@muead-test.example" roles={roles} onSignOut={onSignOut} /></MemoryRouter>);
  return onSignOut;
};

describe("account menu", () => {
  test("clicking the name opens a menu and does NOT sign out", () => {
    const onSignOut = menu();
    fireEvent.click(screen.getByRole("button", { name: /Demo Maintenance/ }));
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.getByRole("menu", { name: "Account" }).textContent).toContain("maintenance@muead-test.example");
    expect(screen.getByText("Maintenance")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Settings/ }).getAttribute("href")).toBe("/settings");
  });
  test("Sign out is a separate, explicit choice", () => {
    const onSignOut = menu();
    fireEvent.click(screen.getByRole("button", { name: /Demo Maintenance/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Sign out/ }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
  test("Escape and clicking outside close it", () => {
    menu(["ApprovalEligible"]);
    fireEvent.click(screen.getByRole("button", { name: /Demo Maintenance/ }));
    expect(screen.getByText("Manager (approves requests)")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Demo Maintenance/ }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  test("shows Administrator for admins", () => {
    menu(["PlatformAdmin", "ApprovalEligible"]);
    fireEvent.click(screen.getByRole("button", { name: /Demo Maintenance/ }));
    expect(screen.getByText("Administrator")).toBeTruthy();
  });
});
