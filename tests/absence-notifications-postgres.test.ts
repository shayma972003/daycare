import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString = process.env.LOCAL_POSTGRES_TEST_URL;
const suite = connectionString ? describe.sequential : describe.skip;

suite("absence notifications on local PostgreSQL", () => {
  let prisma: PrismaClient;
  let createAbsenceNotification: typeof import("@/lib/absence-notifications").createAbsenceNotification;
  const suffix = randomBytes(6).toString("hex");
  const schoolId = `codex_absence_school_${suffix}`;
  const studentId = `codex_absence_student_${suffix}`;

  beforeAll(async () => {
    if (!connectionString) throw new Error("LOCAL_POSTGRES_TEST_URL is required");
    const target = new URL(connectionString);
    const localHost = target.hostname === "127.0.0.1" || target.hostname === "localhost";
    if (!localHost || target.port !== "55432" || target.pathname !== "/daycare_test") {
      throw new Error("Absence PostgreSQL test only accepts local daycare_test on port 55432");
    }

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    vi.doMock("@/lib/prisma", () => ({ prisma }));
    vi.doMock("@/lib/push", () => ({ enqueuePush: vi.fn() }));
    ({ createAbsenceNotification } = await import("@/lib/absence-notifications"));

    await prisma.school.create({ data: { id: schoolId, name: "Absence local test" } });
    await prisma.student.create({ data: { id: studentId, schoolId, name: "Synthetic child" } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.activityMessage.deleteMany({ where: { schoolId } });
      await prisma.student.deleteMany({ where: { schoolId } });
      await prisma.school.deleteMany({ where: { id: schoolId } });
      await prisma.$disconnect();
    }
    vi.doUnmock("@/lib/prisma");
    vi.doUnmock("@/lib/push");
  });

  it("stores one durable absence message for concurrent repeats", async () => {
    const date = new Date("2026-09-18T00:00:00.000Z");
    const attempts = await Promise.all([
      createAbsenceNotification({ schoolId, studentId, date, createdById: "local-test" }),
      createAbsenceNotification({ schoolId, studentId, date, createdById: "local-test" }),
    ]);

    expect(attempts.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(attempts.map((result) => result.messageId)).size).toBe(1);
    const messages = await prisma.activityMessage.findMany({
      where: { schoolId, studentId, absenceDate: date },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      guardianRecipientCount: 0,
      studentId,
      absenceDate: date,
    });
  }, 30_000);
});
