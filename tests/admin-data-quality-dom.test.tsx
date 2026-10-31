// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("axios", () => ({
  default: { get: mocks.get, isAxiosError: () => false },
}));

import DataQualityPage from "@/app/admin/(protected)/data-quality/page";

const fixture = {
  checkedAt: "2026-10-27T12:00:00Z",
  summary: { totalIssues: 4, highIssues: 3, warnings: 1, affectedSchools: 1, cleanSchools: 2, schoolCount: 3 },
  checks: [
    {
      key: "students_without_class",
      label: "أطفال نشطون بلا فصل",
      description: "وصف الربط",
      severity: "HIGH",
      category: "STRUCTURE",
      total: 3,
      affectedSchools: 1,
    },
    {
      key: "failed_device_tokens",
      label: "أجهزة توقفت عن استقبال الإشعارات",
      description: "وصف الأجهزة",
      severity: "WARNING",
      category: "DELIVERY",
      total: 1,
      affectedSchools: 1,
    },
  ],
  schools: [
    {
      id: "school-1",
      name: "روضة النور",
      totalIssues: 4,
      highIssues: 3,
      warnings: 1,
      issues: [
        { key: "students_without_class", count: 3, severity: "HIGH", category: "STRUCTURE" },
        { key: "failed_device_tokens", count: 1, severity: "WARNING", category: "DELIVERY" },
      ],
    },
  ],
  privacy: { aggregateOnly: true, note: "لا يعرض الفحص أسماء الأطفال أو الموظفين أو بيانات التواصل أو المعلومات الصحية." },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ data: fixture });
});

afterEach(cleanup);

describe("data quality admin page", () => {
  it("shows aggregate checks, privacy note, and affected schools", async () => {
    render(<DataQualityPage />);

    expect(await screen.findByRole("heading", { name: "سلامة البيانات" })).toBeTruthy();
    expect(screen.getByText("أطفال نشطون بلا فصل")).toBeTruthy();
    expect(screen.getAllByText("أجهزة توقفت عن استقبال الإشعارات").length).toBeGreaterThan(0);
    expect(screen.getByText("روضة النور")).toBeTruthy();
    expect(screen.getByText(/لا يعرض الفحص أسماء الأطفال/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "فتح ملف المنشأة" }).getAttribute("href")).toBe("/admin/schools/school-1");
  });

  it("filters checks and reruns the scan", async () => {
    render(<DataQualityPage />);
    await screen.findByText("أطفال نشطون بلا فصل");

    await userEvent.click(screen.getByRole("button", { name: "الإشعارات والتقارير" }));
    expect(screen.queryByText("أطفال نشطون بلا فصل")).toBeNull();
    expect(screen.getAllByText("أجهزة توقفت عن استقبال الإشعارات").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "إعادة الفحص" }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  });
});
