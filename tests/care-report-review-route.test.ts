import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  transaction: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  notify: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/care-report-notify", () => ({ notifyGuardiansOfReport: mocks.notify }));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.log }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: vi.fn() }));

import { POST } from "@/app/api/care-reports/[id]/review/route";

const tx = {
  careReport: {
    findFirst: mocks.findFirst,
    findMany: mocks.findMany,
    updateMany: mocks.updateMany,
  },
};

function request(action: "APPROVE" | "REJECT", note?: string) {
  return new Request("http://localhost/api/care-reports/report-1/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, note }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    user: { id: "manager-1", schoolId: "school-1", name: "Manager" },
    teacherId: null,
    teacherClassIds: null,
    permissions: ["students.manage"],
    can: (permission: string) => permission === "students.manage",
  });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.findFirst.mockResolvedValue({ id: "report-1", dailyBatchId: "batch-1", reviewStatus: "PENDING_REVIEW" });
  mocks.findMany.mockResolvedValue([
    { id: "report-1", reviewStatus: "PENDING_REVIEW" },
    { id: "report-2", reviewStatus: "PENDING_REVIEW" },
  ]);
  mocks.updateMany.mockResolvedValue({ count: 2 });
  mocks.notify.mockResolvedValue(2);
  mocks.log.mockResolvedValue(undefined);
});

describe("care report review workflow", () => {
  it("approves the complete daily batch and notifies guardians after the transaction", async () => {
    const response = await POST(request("APPROVE"), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "APPROVED", changed: 2 });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewStatus: "APPROVED", reviewedById: "manager-1" }),
    }));
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledWith("school-1", ["report-1", "report-2"]));
  });

  it("returns a batch for changes without notifying guardians", async () => {
    const response = await POST(request("REJECT", "راجعي وقت النوم"), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewStatus: "REJECTED", reviewNote: "راجعي وقت النوم" }),
    }));
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("does not approve a returned batch before the teacher resubmits it", async () => {
    mocks.findFirst.mockResolvedValue({ id: "report-1", dailyBatchId: "batch-1", reviewStatus: "REJECTED" });
    mocks.findMany.mockResolvedValue([
      { id: "report-1", reviewStatus: "REJECTED" },
      { id: "report-2", reviewStatus: "REJECTED" },
    ]);

    const response = await POST(request("APPROVE"), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "RETURNED_REPORT_REQUIRES_RESUBMISSION",
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("does not allow a classroom-scoped account to review", async () => {
    mocks.session.mockResolvedValue({
      user: { id: "teacher-user", schoolId: "school-1" },
      teacherId: "teacher-1",
      teacherClassIds: ["class-1"],
      permissions: ["students.manage"],
      can: () => true,
    });
    const response = await POST(request("APPROVE"), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
