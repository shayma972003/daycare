// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), refresh: vi.fn() }));

vi.mock("axios", () => ({
  default: {
    get: mocks.get,
    put: mocks.put,
    delete: vi.fn(),
    post: vi.fn(),
    isAxiosError: () => false,
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/i18n-provider", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("@/lib/use-permissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("@/components/layout/Topbar", () => ({ Topbar: () => null }));
vi.mock("@/components/settings/AcademicStagesPanel", () => ({ AcademicStagesPanel: () => null }));
vi.mock("@/components/auth/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => children }));

import SettingsPage from "@/app/(dashboard)/settings/page";

const settingsResponse = {
  settings: {
    hourlyLateFee: 0,
    dailyStudentFee: 0,
    weeklyStudentFee: null,
    monthlyStudentFee: 0,
    yearlyStudentFee: null,
    reminderTemplate: "",
  },
  schoolName: "School",
  logoUrl: null,
  plan: "basic",
  schoolEmail: "school@example.invalid",
  loginEmail: "manager@example.invalid",
  teacherMorningCheckinTime: "",
  teacherMorningCheckoutTime: "",
  teacherEveningCheckinTime: "",
  teacherEveningCheckoutTime: "",
  studentMorningCheckinTime: "",
  studentMorningCheckoutTime: "",
  studentEveningCheckinTime: "",
  studentEveningCheckoutTime: "",
  commercialRegistration: "",
  vatNumber: "",
  contactNumber: "",
  phoneNumber: "",
  address: "",
  twoFaEnabled: false,
};

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  mocks.get.mockImplementation((url: string) => {
    if (url === "/api/settings") return Promise.resolve({ data: settingsResponse });
    if (url.startsWith("/api/trash/")) return Promise.resolve({ data: { items: [] } });
    return Promise.resolve({ data: { logs: [], total: 0 } });
  });
  mocks.put.mockResolvedValue({ data: { success: true } });
});

describe("settings password form", () => {
  async function openForm() {
    render(<SettingsPage />);
    await waitFor(() => expect(screen.queryByText("common.loading")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "settings.accountSecurity" }));
    await userEvent.click(screen.getByRole("button", { name: "settings.changePassword" }));
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
  }

  it("does not render password fields until requested and clears them on close", async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(screen.queryByText("common.loading")).toBeNull());
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    cleanup();

    const inputs = await openForm();
    expect(inputs).toHaveLength(3);
    expect(inputs.map((input) => input.value)).toEqual(["", "", ""]);
    expect(inputs.map((input) => input.defaultValue)).toEqual(["", "", ""]);
    expect(inputs.map((input) => input.autocomplete)).toEqual(["current-password", "new-password", "new-password"]);
    expect(inputs[0].form?.getAttribute("autocomplete")).toBe("off");

    fireEvent.change(inputs[0], { target: { value: "Current-password-1" } });
    fireEvent.change(inputs[1], { target: { value: "New-password-2" } });
    fireEvent.change(inputs[2], { target: { value: "New-password-2" } });
    await userEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "settings.changePassword" }));
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).map((input) => input.value)).toEqual(["", "", ""]);
  });

  it("clears and closes the form after a successful change", async () => {
    const inputs = await openForm();
    await userEvent.type(inputs[0], "Current-password-1");
    await userEvent.type(inputs[1], "New-password-2");
    await userEvent.type(inputs[2], "New-password-2");
    await userEvent.click(screen.getByRole("button", { name: "settings.changePassword" }));

    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith("/api/settings/password", {
      currentPassword: "Current-password-1",
      newPassword: "New-password-2",
    }));
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(screen.getByText("settings.passwordChanged")).toBeTruthy();
  });

  it("renders school identity as read-only and orders daily settings before administrative sections", async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(screen.queryByText("common.loading")).toBeNull());

    expect(screen.getByText("School")).toBeTruthy();
    for (const name of ["schoolName", "schoolEmail", "commercialRegistration", "vatNumber", "contactNumber", "phoneNumber", "address"]) {
      expect(document.querySelector(`[name="${name}"]`)).toBeNull();
    }
    fireEvent.change(screen.getByPlaceholderText("settings.search"), { target: { value: "settings" } });
    await waitFor(() => expect(document.getElementById("fees")).toBeTruthy());
    const order = (id: string) => Number((document.getElementById(id) as HTMLElement).style.order);
    expect(order("school-info")).toBeLessThan(order("school-hours"));
    expect(order("school-hours")).toBeLessThan(order("fees"));
    expect(order("fees")).toBeLessThan(order("academic-stages"));
    expect(order("academic-stages")).toBeLessThan(order("password"));
  });
});
