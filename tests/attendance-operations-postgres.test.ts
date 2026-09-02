import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.ATTENDANCE_TEST_SCHEMA;
const suite = schema ? describe.sequential : describe.skip;

suite("attendance operations on isolated PostgreSQL", () => {
  let prisma: PrismaClient;
  let operations: typeof import("@/lib/attendance-operations");
  const suffix = randomBytes(5).toString("hex");
  const schoolId = "codex_attendance_school_" + suffix;
  const studentId = "codex_attendance_student_" + suffix;
  const teacherId = "codex_attendance_teacher_" + suffix;

  beforeAll(async () => {
    if (!schema || !/^codex_attendance_[a-z0-9_]+$/.test(schema) || schema === "public") {
      throw new Error("Unsafe or missing ATTENDANCE_TEST_SCHEMA");
    }
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !new URL(connectionString).hostname.toLowerCase().includes("neon")) {
      throw new Error("Attendance PostgreSQL test only accepts the isolated Neon test target");
    }
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }, { schema }),
    });
    vi.doMock("@/lib/prisma", () => ({ prisma }));
    operations = await import("@/lib/attendance-operations");

    await prisma.school.create({ data: { id: schoolId, name: "Attendance isolated test" } });
    await prisma.student.create({
      data: { id: studentId, schoolId, name: "Attendance student" },
    });
    await prisma.teacher.create({
      data: { id: teacherId, schoolId, name: "Attendance teacher" },
    });
  });

  afterAll(async () => {
    vi.doUnmock("@/lib/prisma");
    await prisma?.$disconnect();
  });

  function rejectionSummary(results: PromiseSettledResult<unknown>[]) {
    return results.flatMap((result) => result.status === "rejected"
      ? [{
          name: result.reason instanceof Error ? result.reason.name : "UnknownError",
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          code: typeof result.reason === "object" && result.reason && "code" in result.reason
            ? String(result.reason.code)
            : undefined,
        }]
      : []);
  }

  it("serializes concurrent student check-ins and checkouts across the subject lock", async () => {
    const date = new Date("2026-08-28T00:00:00.000Z");
    const checkinAt = new Date("2026-08-28T08:00:00.000Z");
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () =>
      operations.checkInStudent({ studentId, schoolId, date, now: checkinAt })
    ));
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
      JSON.stringify(rejectionSummary(attempts))
    ).toHaveLength(1);
    expect(await prisma.attendance.count({
      where: { studentId, schoolId, checkinAt: { not: null }, checkoutAt: null },
    })).toBe(1);

    const checkoutAt = new Date("2026-08-28T10:00:00.000Z");
    const closes = await Promise.allSettled(Array.from({ length: 4 }, () =>
      operations.checkoutStudent({ studentId, schoolId, now: checkoutAt, timeZone: "UTC" })
    ));
    expect(closes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(student.attendanceHours).toBeCloseTo(2, 8);
    expect(await prisma.attendance.count({
      where: { studentId, schoolId, checkoutAt },
    })).toBe(1);
  }, 30_000);

  it("serializes teacher attendance and rejects a cross-tenant scope", async () => {
    const date = new Date("2026-08-28T00:00:00.000Z");
    const checkinAt = new Date("2026-08-28T08:00:00.000Z");
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () =>
      operations.checkInTeacher({ teacherId, schoolId, date, now: checkinAt, timeZone: "UTC" })
    ));
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
      JSON.stringify(rejectionSummary(attempts))
    ).toHaveLength(1);

    const otherSchool = await prisma.school.create({
      data: { id: schoolId + "_other", name: "Other tenant" },
    });
    await expect(operations.checkoutTeacher({
      teacherId,
      schoolId: otherSchool.id,
      now: new Date("2026-08-28T10:00:00.000Z"),
      timeZone: "UTC",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const closes = await Promise.allSettled(Array.from({ length: 4 }, () =>
      operations.checkoutTeacher({
        teacherId,
        schoolId,
        now: new Date("2026-08-28T10:00:00.000Z"),
        timeZone: "UTC",
      })
    ));
    expect(closes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } });
    expect(teacher.attendanceHours).toBeCloseTo(2, 8);
  }, 30_000);
});
