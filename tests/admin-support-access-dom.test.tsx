// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), push: vi.fn() }));

vi.mock("axios", () => ({ default: { get: mocks.get, post: mocks.post, patch: mocks.patch, isAxiosError: () => false } }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "access-1" }), useRouter: () => ({ push: mocks.push }) }));

import SecureSupportAccessPage from "@/app/admin/(protected)/support/[id]/page";

const accessFixture = {
  access: { id: "access-1", reason: "التحقق من مشكلة الدخول", createdAt: "2026-10-27T12:00:00Z", expiresAt: "2099-10-27T12:30:00Z", ticket: null },
  school: { id: "school-1", name: "مدرسة النور", plan: "standard", subscription_status: "active", renewal_date: null, last_login_at: null, settings: { careReportReviewRequired: true } },
  summary: { activeStudents: 8, activeTeachers: 2, activeClasses: 2, activeGuardians: 6, staff: { total: 3, disabled: 0, pending: 0 }, devices: { total: 4, failed: 0 }, pendingCareReports: 0, arrivalRecipients: 1, failedPushLast30Days: 0 },
  recentLogs: [],
  restrictions: { readOnly: true, sensitiveHealthHidden: true, personalRecordsHidden: true, writesAllowed: false },
};

const previewFixture = {
  view: "overview",
  auditedAt: "2026-10-27T12:05:00Z",
  sections: [{ title: "ملخص المنشأة", description: "أعداد مجمعة فقط", metrics: [{ label: "الأطفال النشطون", value: 8 }] }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith("/preview") ? previewFixture : accessFixture }));
  mocks.post.mockResolvedValue({ data: { success: true } });
});

afterEach(cleanup);

describe("secure support workspace", () => {
  it("shows a persistent read-only banner, safe tabs and a guarded support tool", async () => {
    render(<SecureSupportAccessPage />);

    expect(await screen.findByText("الدعم الفني يشاهد حساب المنشأة — قراءة فقط")).toBeTruthy();
    expect(screen.getByRole("button", { name: "الدخول إلى حساب المنشأة مؤقتًا" })).toBeTruthy();
    expect(await screen.findByRole("tab", { name: "الحضور" })).toBeTruthy();
    expect(screen.getByText(/لا تُنشأ جلسة موظف/)).toBeTruthy();

    const tool = screen.getByRole("button", { name: "تحديث حساب مساحة التخزين" }) as HTMLButtonElement;
    expect(tool.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("سبب تنفيذ الأداة"), "التحقق من مساحة التخزين الحالية");
    await userEvent.click(screen.getByRole("checkbox"));
    expect(tool.disabled).toBe(false);
  });

  it("loads and audits each selected preview tab through the dedicated endpoint", async () => {
    render(<SecureSupportAccessPage />);
    await screen.findByText("ملخص المنشأة");

    await userEvent.click(screen.getByRole("tab", { name: "الحضور" }));

    expect(mocks.get).toHaveBeenCalledWith("/api/admin/support-access/access-1/preview", { params: { view: "attendance" } });
  });
});
