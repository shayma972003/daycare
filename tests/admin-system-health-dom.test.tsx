// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("axios", () => ({
  default: { get: mocks.get, isAxiosError: () => false },
}));

import SystemHealthPage from "@/app/admin/(protected)/system-health/page";

const fixture = {
  checkedAt: "2026-10-26T16:00:00.000Z",
  responseTimeMs: 42,
  services: [
    { key: "database", label: "قاعدة البيانات", state: "healthy", detail: "استجابة ناجحة", configured: true },
    { key: "email", label: "البريد الإلكتروني", state: "warning", detail: "الإرسال الخارجي متوقف", configured: false },
  ],
  metrics24h: { failedJobRuns: 1, failedPush: 2, failedOutbound: 0, pendingPush: 3, oldestPendingPushAt: null },
  jobs: [
    { key: "push_queue", label: "استعادة طابور الإشعارات", schedule: "يوميًا 04:00 UTC", state: "healthy", lastRunAt: "2026-10-26T04:00:00.000Z", finishedAt: "2026-10-26T04:00:01.000Z", durationMs: 1000, errorCode: null },
  ],
  recentJobFailures: [],
  storage: { schoolsTracked: 1, schoolCount: 1, staleSchoolCount: 0, totalBytes: 1024 },
  versions: { web: "0.1.0", mobile: "1.0.0", deployment: "local", databaseMigration: "health", databaseMigratedAt: null },
  monitoring: { sentryConfigured: false, webhookConfigured: false, note: "ملاحظة المراقبة" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ data: fixture });
});

afterEach(cleanup);

describe("system health admin page", () => {
  it("shows service, queue, scheduled-job, and version diagnostics", async () => {
    render(<SystemHealthPage />);

    expect(await screen.findByRole("heading", { name: "مركز صحة النظام" })).toBeTruthy();
    expect(screen.getByText("قاعدة البيانات")).toBeTruthy();
    expect(screen.getByText("البريد الإلكتروني")).toBeTruthy();
    expect(screen.getByText("استعادة طابور الإشعارات")).toBeTruthy();
    expect(screen.getByText("إصدار التطبيق")).toBeTruthy();
    expect(screen.getByText("1 نقطة تحتاج متابعة")).toBeTruthy();
  });

  it("refreshes the health snapshot on demand", async () => {
    render(<SystemHealthPage />);
    await screen.findByText("قاعدة البيانات");

    await userEvent.click(screen.getByRole("button", { name: "تحديث الفحص" }));

    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  });
});
