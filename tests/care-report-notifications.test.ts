import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reports: vi.fn(),
  accounts: vi.fn(),
  updateReports: vi.fn(),
  push: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    careReport: { findMany: mocks.reports, updateMany: mocks.updateReports },
    guardianAccount: { findMany: mocks.accounts },
  },
}));
vi.mock("@/lib/push", () => ({ enqueuePush: mocks.push }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: mocks.log }));

import { notifyGuardiansOfReport } from "@/lib/care-report-notify";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reports.mockResolvedValue([{
    id: "report-1",
    type: "MEAL",
    studentId: "student-1",
    student: {
      name: "سارة",
      guardianId: "guardian-1",
      guardianLinks: [{ guardianId: "guardian-2" }],
    },
  }]);
  mocks.accounts.mockResolvedValue([{ id: "account-1" }, { id: "account-2" }]);
  mocks.push.mockResolvedValue(1);
  mocks.updateReports.mockResolvedValue({ count: 1 });
});

describe("care report guardian notifications", () => {
  it("notifies only opted-in guardians after approval without exposing care details", async () => {
    await expect(notifyGuardiansOfReport("school-1", ["report-1"])).resolves.toBe(2);
    expect(mocks.reports).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        reviewStatus: "APPROVED",
        guardianNotifiedAt: null,
      }),
    }));
    expect(mocks.accounts).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        guardianId: { in: expect.arrayContaining(["guardian-1", "guardian-2"]) },
        notifyCareReport: true,
      }),
    }));
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.push.mock.calls[0][1]).toMatchObject({
      title: "سارة",
      data: { kind: "care_report", reportId: "report-1", studentId: "student-1" },
    });
    expect(mocks.push.mock.calls[0][1].body).not.toContain("guardian-1");
    expect(mocks.updateReports).toHaveBeenCalledWith(expect.objectContaining({
      data: { guardianNotifiedAt: expect.any(Date) },
    }));
  });

  it("records the opted-out delivery decision without queueing a push", async () => {
    mocks.accounts.mockResolvedValue([]);
    await expect(notifyGuardiansOfReport("school-1", ["report-1"])).resolves.toBe(0);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.updateReports).toHaveBeenCalledTimes(1);
  });
});
