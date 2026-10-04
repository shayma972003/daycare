import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    settings: { findUnique: mocks.findUnique, upsert: mocks.upsert },
  },
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.log }));
vi.mock("@/lib/care-report-notify", () => ({ notifyGuardiansOfReport: vi.fn() }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: vi.fn() }));

import { GET, PUT } from "@/app/api/care-reports/settings/route";

function session({ scoped = false, manager = true } = {}) {
  return {
    user: { id: "user-1", schoolId: "school-1", name: "Manager" },
    teacherId: scoped ? "teacher-1" : null,
    teacherClassIds: scoped ? ["class-1"] : null,
    permissions: manager ? ["students.manage", "attendance.students"] : ["attendance.students"],
    can(permission: string) {
      return this.permissions.includes(permission);
    },
  };
}

function updateRequest(reviewRequired: boolean) {
  return new Request("http://localhost/api/care-reports/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewRequired }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(session());
  mocks.findUnique.mockResolvedValue(null);
  mocks.upsert.mockImplementation(async ({ create }: { create: { careReportReviewRequired: boolean } }) => ({
    careReportReviewRequired: create.careReportReviewRequired,
  }));
  mocks.log.mockResolvedValue(undefined);
});

describe("care report delivery setting", () => {
  it("defaults existing schools to manager review", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reviewRequired: true });
  });

  it("lets an unscoped manager enable direct delivery", async () => {
    const response = await PUT(updateRequest(false));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reviewRequired: false });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: "school-1" },
      update: { careReportReviewRequired: false },
    }));
    expect(mocks.log).toHaveBeenCalledTimes(1);
  });

  it("does not let a classroom-scoped teacher change the school policy", async () => {
    mocks.session.mockResolvedValue(session({ scoped: true, manager: true }));
    const response = await PUT(updateRequest(false));
    expect(response.status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
