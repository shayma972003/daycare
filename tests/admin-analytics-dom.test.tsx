// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("axios", () => ({
  default: { get: mocks.get, isAxiosError: () => false },
}));

import UsageAnalyticsPage from "@/app/admin/(protected)/analytics/page";

const fixture = {
  periodDays: 30,
  generatedAt: "2026-10-26T18:00:00.000Z",
  summary: { activeSchools: 2, usingCoreFeatures: 1, dormantSchools: 1, averageActivationPercent: 69 },
  features: [
    { key: "attendance", label: "الحضور", schoolsUsing: 1, adoptionRate: 50, totalActions: 18 },
    { key: "care_reports", label: "تقارير الرعاية", schoolsUsing: 1, adoptionRate: 50, totalActions: 8 },
  ],
  careReports: { submitted: 8, approved: 5, returned: 1, pending: 2, overdue: 1, averageReviewMinutes: 35 },
  funnel: [
    { key: "school", label: "إنشاء المنشأة", count: 2, conversionRate: 100 },
    { key: "manager", label: "تفعيل المديرة", count: 1, conversionRate: 50 },
  ],
  schools: [
    {
      id: "school-1",
      name: "روضة النور",
      subscriptionStatus: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      daysSinceCreated: 298,
      completedSteps: 8,
      activationPercent: 100,
      currentStage: "أول تقرير رعاية",
      nextStep: null,
      dormant: false,
      usage: { attendance: 18, care_reports: 8 },
    },
    {
      id: "school-2",
      name: "مركز المستقبل",
      subscriptionStatus: "trial",
      createdAt: "2026-10-20T00:00:00.000Z",
      daysSinceCreated: 6,
      completedSteps: 3,
      activationPercent: 38,
      currentStage: "إضافة معلم",
      nextStep: "إنشاء فصل",
      dormant: true,
      usage: { attendance: 0, care_reports: 0 },
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ data: fixture });
});

afterEach(cleanup);

describe("usage analytics admin page", () => {
  it("shows feature adoption, activation funnel, and care-review indicators", async () => {
    render(<UsageAnalyticsPage />);

    expect(await screen.findByRole("heading", { name: "تحليلات الاستخدام والتفعيل" })).toBeTruthy();
    expect(screen.getByText("استخدام الميزات")).toBeTruthy();
    expect(screen.getByText("مسار التفعيل")).toBeTruthy();
    expect(screen.getByText("مؤشرات تقارير الرعاية")).toBeTruthy();
    expect(screen.getByText("روضة النور")).toBeTruthy();
    expect(screen.getByText("مركز المستقبل")).toBeTruthy();
  });

  it("filters dormant schools and searches by school name", async () => {
    render(<UsageAnalyticsPage />);
    await screen.findByText("روضة النور");

    await userEvent.click(screen.getByRole("button", { name: "بدون استخدام حديث" }));
    expect(screen.queryByText("روضة النور")).toBeNull();
    expect(screen.getByText("مركز المستقبل")).toBeTruthy();

    await userEvent.type(screen.getByPlaceholderText("اكتبي اسم المنشأة..."), "النور");
    expect(screen.queryByText("مركز المستقبل")).toBeNull();
    expect(screen.getByText("لا توجد منشآت مطابقة.")).toBeTruthy();
  });

  it("refreshes the analytics snapshot on demand", async () => {
    render(<UsageAnalyticsPage />);
    await screen.findByText("روضة النور");

    await userEvent.click(screen.getByRole("button", { name: "تحديث البيانات" }));

    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  });
});
