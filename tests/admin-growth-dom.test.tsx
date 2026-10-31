// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("axios", () => ({
  default: { get: mocks.get, isAxiosError: () => false },
}));

import GrowthForecastPage from "@/app/admin/(protected)/growth/page";

const fixture = {
  generatedAt: "2026-10-27T10:00:00Z",
  months: 12,
  summary: {
    mrr: 1250,
    arr: 15000,
    paidSchools: 4,
    trialSchools: 2,
    averageRevenuePerPaidSchool: 312.5,
    trialToPaidPercent: 67,
    paymentSuccessPercent: 92,
  },
  growth: { schoolsThreeMonthPercent: 20, studentsThreeMonthPercent: 15, revenueThreeMonthPercent: -5 },
  series: [
    { key: "2026-09", label: "سبتمبر 2026", partial: false, newSchools: 2, newStudents: 12, newTeachers: 3, revenue: 1200, paidPayments: 4, failedPayments: 0 },
    { key: "2026-10", label: "أكتوبر 2026", partial: true, newSchools: 1, newStudents: 5, newTeachers: 1, revenue: 500, paidPayments: 2, failedPayments: 1 },
  ],
  forecast: {
    months: [
      { key: "2026-11", label: "نوفمبر 2026", newSchools: 2, newStudents: 11, revenue: 1300 },
      { key: "2026-12", label: "ديسمبر 2026", newSchools: 2, newStudents: 12, revenue: 1350 },
      { key: "2027-01", label: "يناير 2027", newSchools: 3, newStudents: 13, revenue: 1400 },
    ],
    confidence: { schools: "MEDIUM", students: "HIGH", revenue: "LOW" },
    method: "DAMPED_SIX_MONTH_TREND",
    excludesPartialCurrentMonth: true,
  },
  plans: [
    { name: "الشهري", schools: 3, students: 50, mrr: 900 },
    { name: "التجريبي", schools: 2, students: 15, mrr: 0 },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ data: fixture });
});

afterEach(cleanup);

describe("growth and forecast admin page", () => {
  it("labels actuals, forecasts, confidence, and the estimation warning", async () => {
    render(<GrowthForecastPage />);

    expect(await screen.findByRole("heading", { name: "النمو والتوقعات" })).toBeTruthy();
    expect(screen.getByText("الإيراد الشهري المتكرر")).toBeTruthy();
    expect(screen.getByText("توقع الأشهر الثلاثة القادمة")).toBeTruthy();
    expect(screen.getAllByText("نوفمبر 2026").length).toBeGreaterThan(0);
    expect(screen.getByText(/التوقعات تقديرات تشغيلية وليست ضمانًا ماليًا/)).toBeTruthy();
    expect(screen.getByText("توزيع الخطط الحالية")).toBeTruthy();
  });

  it("reloads the API when the historical period changes", async () => {
    render(<GrowthForecastPage />);
    await screen.findByText("الإيراد الشهري المتكرر");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "الفترة التاريخية" }), "6");

    await waitFor(() => expect(mocks.get).toHaveBeenLastCalledWith("/api/admin/growth?months=6"));
  });
});
