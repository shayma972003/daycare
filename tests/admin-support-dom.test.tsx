// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), push: vi.fn() }));

vi.mock("axios", () => ({
  default: { get: mocks.get, post: mocks.post, patch: mocks.patch, isAxiosError: () => false },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

import SupportCenterPage from "@/app/admin/(protected)/support/page";

const listFixture = {
  tickets: [{
    id: "ticket-1",
    reference: "SUP-001",
    title: "مشكلة في تسجيل الدخول",
    category: "الحسابات",
    status: "OPEN",
    priority: "HIGH",
    firstRespondedAt: null,
    resolvedAt: null,
    createdAt: "2026-10-26T12:00:00Z",
    updatedAt: "2026-10-26T12:00:00Z",
    school: { id: "school-1", name: "مدرسة النور" },
    requesterUser: null,
    assignedAdmin: { id: "admin-1", email: "support@example.test" },
    _count: { notes: 0, attachments: 0, accessSessions: 0 },
  }],
  schools: [{ id: "school-1", name: "مدرسة النور", subscription_status: "active" }],
  admins: [{ id: "admin-1", email: "support@example.test" }],
  summary: { open: 1, inProgress: 0, waiting: 0, resolved: 0, urgentOpen: 0 },
};

const detailFixture = {
  ...listFixture.tickets[0],
  description: "تعذر على المديرة فتح الحساب",
  school: { id: "school-1", name: "مدرسة النور", subscription_status: "active" },
  notes: [],
  attachments: [],
  accessSessions: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockImplementation((url: string) => Promise.resolve({
    data: url === "/api/admin/support-tickets" ? listFixture : detailFixture,
  }));
});

afterEach(cleanup);

describe("support center admin page", () => {
  it("shows ticket metrics and the selected ticket's safe access controls", async () => {
    render(<SupportCenterPage />);

    expect(await screen.findByRole("heading", { name: "مركز الدعم الفني" })).toBeTruthy();
    expect(await screen.findByText("SUP-001")).toBeTruthy();
    expect(screen.getByText("مشكلة في تسجيل الدخول")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /مشكلة في تسجيل الدخول/ }));

    expect(await screen.findByText("جلسة دعم آمنة")).toBeTruthy();
    expect(screen.getByText(/لا تعرض أسماء الأطفال أو معلوماتهم الصحية/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "بدء المعاينة الآمنة" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the new-ticket form with an explicit tenant selector", async () => {
    render(<SupportCenterPage />);
    await screen.findByText("SUP-001");

    await userEvent.click(screen.getByRole("button", { name: "تذكرة جديدة" }));

    expect(screen.getByRole("heading", { name: "إنشاء تذكرة دعم" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "المنشأة" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "مدرسة النور" })).toBeTruthy();
  });
});
