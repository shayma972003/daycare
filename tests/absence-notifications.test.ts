import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  student: vi.fn(),
  accounts: vi.fn(),
  createMessage: vi.fn(),
  findMessage: vi.fn(),
  updateMessage: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    activityMessage: { findFirst: mocks.findMessage, update: mocks.updateMessage },
  },
}));
vi.mock("@/lib/push", () => ({ enqueuePush: mocks.push }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: vi.fn() }));

import { createAbsenceNotification } from "@/lib/absence-notifications";

const tx = {
  student: { findFirst: mocks.student },
  guardianAccount: { findMany: mocks.accounts },
  activityMessage: { create: mocks.createMessage },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.student.mockResolvedValue({
    id: "student-1",
    guardianId: "guardian-1",
    guardianLinks: [{ guardianId: "guardian-1" }, { guardianId: "guardian-2" }],
  });
  mocks.accounts.mockResolvedValue([{ id: "account-1" }, { id: "account-2" }]);
  mocks.createMessage.mockResolvedValue({
    id: "message-1",
    recipients: [
      { schoolId: "school-1", guardianAccountId: "account-1" },
      { schoolId: "school-1", guardianAccountId: "account-2" },
    ],
  });
  mocks.push.mockResolvedValue(1);
  mocks.updateMessage.mockResolvedValue({});
});

describe("absence notifications", () => {
  it("allows exactly one activity, calendar, or student source in the database", () => {
    const migration = readFileSync(
      "prisma/migrations/20260918120000_absence_message_source_constraint/migration.sql",
      "utf8"
    );
    expect(migration.trimStart().startsWith("-- Absence notifications")).toBe(true);
    expect(migration).toContain("BEGIN;");
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain('num_nonnulls("activityId", "calendarEventId", "studentId") = 1');
    expect(migration).toContain('(("studentId" IS NOT NULL) = ("absenceDate" IS NOT NULL))');
  });

  it("stores one durable message for all active guardian accounts and queues a generic push", async () => {
    const result = await createAbsenceNotification({
      schoolId: "school-1",
      studentId: "student-1",
      date: new Date("2026-09-17T00:00:00.000Z"),
      createdById: "user-1",
    });

    expect(result).toEqual({ created: true, messageId: "message-1", guardians: 2 });
    expect(mocks.accounts).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        guardianId: { in: expect.arrayContaining(["guardian-1", "guardian-2"]) },
        notifyAbsence: true,
      }),
    }));
    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        studentId: "student-1",
        absenceDate: new Date("2026-09-17T00:00:00.000Z"),
        guardianRecipientCount: 2,
        body: "تم تسجيل غياب طفلك عن الحضانة لهذا اليوم.",
      }),
    }));
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.push.mock.calls[0][1].body).not.toContain("student-1");
  });

  it("replays the database uniqueness winner without another push", async () => {
    mocks.transaction.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    mocks.findMessage.mockResolvedValue({ id: "message-existing", guardianRecipientCount: 2 });

    const result = await createAbsenceNotification({
      schoolId: "school-1",
      studentId: "student-1",
      date: new Date("2026-09-17T00:00:00.000Z"),
      createdById: "user-1",
    });

    expect(result).toEqual({ created: false, messageId: "message-existing", guardians: 2 });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("stores the message without a nested empty recipient create", async () => {
    mocks.accounts.mockResolvedValue([]);
    mocks.createMessage.mockResolvedValue({ id: "message-no-guardians", recipients: [] });

    const result = await createAbsenceNotification({
      schoolId: "school-1",
      studentId: "student-1",
      date: new Date("2026-09-17T00:00:00.000Z"),
      createdById: "user-1",
    });

    expect(result).toEqual({ created: true, messageId: "message-no-guardians", guardians: 0 });
    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ recipients: expect.anything() }),
    }));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("does not create a message for an unavailable or cross-tenant child", async () => {
    mocks.student.mockResolvedValue(null);
    const result = await createAbsenceNotification({
      schoolId: "school-1",
      studentId: "student-outside",
      date: new Date("2026-09-17T00:00:00.000Z"),
      createdById: "user-1",
    });
    expect(result).toEqual({ created: false, messageId: null, guardians: 0 });
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });
});
