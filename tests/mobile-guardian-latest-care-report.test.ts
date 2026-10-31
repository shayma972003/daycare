import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  childIds: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/mobile-guard", () => ({
  requireMobileAuth: mocks.guard,
  mobileAuthResponse: () => null,
  guardianChildIds: mocks.childIds,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    careReport: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
    },
  },
}));

vi.mock("@/lib/file-token", () => ({ stampFileUrl: (value: string | null) => value }));

import { GET } from "@/app/api/mobile/v1/care-reports/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({
    claims: { sub: "guardian-user", kind: "guardian" },
    schoolId: "school-1",
  });
  mocks.childIds.mockResolvedValue(["child-1", "child-2"]);
  mocks.findFirst
    .mockResolvedValueOnce({ id: "new-row-1", studentId: "child-1", dailyBatchId: "new-batch-1" })
    .mockResolvedValueOnce({ id: "new-row-2", studentId: "child-2", dailyBatchId: null });
  mocks.findMany.mockResolvedValue([]);
});

describe("guardian latest care report", () => {
  it("returns only the newest complete submission for every linked child", async () => {
    const response = await GET(new Request("http://localhost/api/mobile/v1/care-reports"));

    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        studentId: "child-1",
        deletedAt: null,
        reviewStatus: "APPROVED",
      }),
      orderBy: [{ createdAt: "desc" }, { occurredAt: "desc" }],
    }));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        reviewStatus: "APPROVED",
        OR: [
          { studentId: "child-1", dailyBatchId: "new-batch-1" },
          { studentId: "child-2", id: "new-row-2" },
        ],
      }),
    }));
  });

  it("uses submission time before section time so an older batch cannot reappear", async () => {
    await GET(new Request("http://localhost/api/mobile/v1/care-reports"));

    for (const [query] of mocks.findFirst.mock.calls) {
      expect(query.orderBy).toEqual([
        { createdAt: "desc" },
        { occurredAt: "desc" },
      ]);
    }
  });

  it("does not expose a previous report when there is no approved submission", async () => {
    mocks.findFirst.mockReset().mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/mobile/v1/care-reports"));

    await expect(response.json()).resolves.toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
