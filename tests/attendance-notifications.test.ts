import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  student: vi.fn(),
  accounts: vi.fn(),
  push: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findFirst: mocks.student },
    guardianAccount: { findMany: mocks.accounts },
  },
}));
vi.mock("@/lib/push", () => ({ enqueuePush: mocks.push }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: mocks.log }));

import { notifyGuardiansOfAttendance } from "@/lib/attendance-notifications";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.student.mockResolvedValue({
    guardianId: "guardian-1",
    guardianLinks: [{ guardianId: "guardian-1" }, { guardianId: "guardian-2" }],
  });
  mocks.accounts.mockResolvedValue([{ id: "account-1" }, { id: "account-2" }]);
  mocks.push.mockResolvedValue(1);
});

describe("attendance guardian notifications", () => {
  it.each([
    ["checkin" as const, "تم تسجيل دخول سارة."],
    ["checkout" as const, "تم تسجيل خروج سارة."],
  ])("queues %s for every linked guardian", async (event, body) => {
    const queued = await notifyGuardiansOfAttendance({
      schoolId: "school-1",
      studentId: "student-1",
      studentName: "سارة",
      event,
    });

    expect(queued).toBe(2);
    expect(mocks.accounts).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        schoolId: "school-1",
        guardianId: { in: expect.arrayContaining(["guardian-1", "guardian-2"]) },
        notifyAttendance: true,
      }),
    }));
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.push.mock.calls[0][1]).toMatchObject({
      title: "الحضور",
      body,
      data: { studentId: "student-1", kind: `student_${event}` },
    });
  });

  it("does not notify when the child is unavailable", async () => {
    mocks.student.mockResolvedValue(null);
    const queued = await notifyGuardiansOfAttendance({
      schoolId: "school-1",
      studentId: "student-1",
      studentName: "سارة",
      event: "checkin",
    });
    expect(queued).toBe(0);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("isolates one failed device queue from the other guardians", async () => {
    mocks.push.mockRejectedValueOnce(new Error("queue failed")).mockResolvedValueOnce(1);
    const queued = await notifyGuardiansOfAttendance({
      schoolId: "school-1",
      studentId: "student-1",
      studentName: "سارة",
      event: "checkout",
    });
    expect(queued).toBe(1);
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.log).toHaveBeenCalledTimes(1);
  });
});
