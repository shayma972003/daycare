import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { astTimeOnDay } from "@/lib/datetime";
import { moneyMultiply, moneyNumber } from "@/lib/money";

export type AttendanceOperationCode =
  | "NOT_FOUND"
  | "NOT_ELIGIBLE"
  | "ALREADY_CHECKED_IN"
  | "NO_ACTIVE_ATTENDANCE"
  | "OVERLAPPING_OPEN_ATTENDANCE"
  | "ALREADY_CHECKED_OUT"
  | "INVALID_ATTENDANCE_TIME";

export class AttendanceOperationError extends Error {
  constructor(public code: AttendanceOperationCode, public status: number) {
    super(code);
  }
}

const conflict = (code: AttendanceOperationCode) =>
  new AttendanceOperationError(code, code === "NOT_FOUND" ? 404 : 409);

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function lockAttendanceSubject(
  tx: Prisma.TransactionClient,
  kind: "student" | "teacher",
  personId: string,
  schoolId: string
) {
  // A transaction-scoped PostgreSQL advisory lock is independent of the
  // adapter's schema/search_path. That matters in isolated test schemas and
  // avoids an unqualified raw table query escaping to public.
  const key = `${schoolId}:${kind}:${personId}`;
  await tx.$queryRaw<Array<{ locked: string }>>(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked
  `);
}

/** The tenant/person advisory key is the cross-day mutex. The per-day unique key alone cannot
 * prevent two requests on opposite sides of local midnight from opening two
 * sessions for the same person. */
export async function checkInStudent(input: {
  studentId: string;
  schoolId: string;
  date: Date;
  now: Date;
}) {
  return prisma.$transaction(async (tx) => {
    await lockAttendanceSubject(tx, "student", input.studentId, input.schoolId);

    const student = await tx.student.findFirst({
      where: {
        id: input.studentId,
        schoolId: input.schoolId,
        deletedAt: null,
        anonymizedAt: null,
        isActive: true,
        status: "ACTIVE",
        OR: [{ enrollmentEndDate: null }, { enrollmentEndDate: { gte: input.date } }],
      },
      select: { id: true, classId: true, name: true },
    });
    if (!student) throw new AttendanceOperationError("NOT_ELIGIBLE", 409);

    const open = await tx.attendance.findMany({
      where: {
        studentId: input.studentId,
        schoolId: input.schoolId,
        checkinAt: { not: null },
        checkoutAt: null,
      },
      select: { id: true },
      take: 2,
    });
    if (open.length > 1) throw conflict("OVERLAPPING_OPEN_ATTENDANCE");
    if (open.length === 1) throw conflict("ALREADY_CHECKED_IN");

    const existing = await tx.attendance.findUnique({
      where: { studentId_date: { studentId: input.studentId, date: input.date } },
      select: { id: true, checkinAt: true, checkoutAt: true },
    });
    if (existing?.checkinAt || existing?.checkoutAt) throw conflict("ALREADY_CHECKED_IN");
    if (existing) {
      const updated = await tx.attendance.updateMany({
        where: {
          id: existing.id,
          schoolId: input.schoolId,
          checkinAt: null,
          checkoutAt: null,
        },
        data: {
          checkinAt: input.now,
          status: "PRESENT",
          statusNote: null,
          classId: student.classId ?? null,
        },
      });
      if (updated.count !== 1) throw conflict("ALREADY_CHECKED_IN");
      const attendance = await tx.attendance.findUniqueOrThrow({ where: { id: existing.id } });
      return { ...attendance, personName: student.name };
    }

    let attendance;
    try {
      attendance = await tx.attendance.create({
        data: {
          studentId: input.studentId,
          schoolId: input.schoolId,
          classId: student.classId ?? null,
          checkinAt: input.now,
          status: "PRESENT",
          date: input.date,
        },
      });
    } catch (error) {
      if (isUniqueConflict(error)) throw conflict("ALREADY_CHECKED_IN");
      throw error;
    }
    return { ...attendance, personName: student.name };
  });
}

export async function checkInTeacher(input: {
  teacherId: string;
  schoolId: string;
  date: Date;
  now: Date;
}) {
  return prisma.$transaction(async (tx) => {
    await lockAttendanceSubject(tx, "teacher", input.teacherId, input.schoolId);

    const teacher = await tx.teacher.findFirst({
      where: {
        id: input.teacherId,
        schoolId: input.schoolId,
        deletedAt: null,
        anonymizedAt: null,
        isActive: true,
        status: "ACTIVE",
      },
      select: { id: true, name: true },
    });
    if (!teacher) throw new AttendanceOperationError("NOT_ELIGIBLE", 409);

    const open = await tx.teacherAttendance.findMany({
      where: {
        teacherId: input.teacherId,
        schoolId: input.schoolId,
        checkinAt: { not: null },
        checkoutAt: null,
      },
      select: { id: true },
      take: 2,
    });
    if (open.length > 1) throw conflict("OVERLAPPING_OPEN_ATTENDANCE");
    if (open.length === 1) throw conflict("ALREADY_CHECKED_IN");

    const existing = await tx.teacherAttendance.findUnique({
      where: { teacherId_date: { teacherId: input.teacherId, date: input.date } },
      select: { id: true },
    });
    if (existing) throw conflict("ALREADY_CHECKED_IN");

    let attendance;
    try {
      attendance = await tx.teacherAttendance.create({
        data: {
          teacherId: input.teacherId,
          schoolId: input.schoolId,
          checkinAt: input.now,
          date: input.date,
        },
      });
    } catch (error) {
      if (isUniqueConflict(error)) throw conflict("ALREADY_CHECKED_IN");
      throw error;
    }
    return { ...attendance, personName: teacher.name };
  });
}

export async function checkoutStudent(input: {
  studentId: string;
  schoolId: string;
  now: Date;
}) {
  return prisma.$transaction(async (tx) => {
    await lockAttendanceSubject(tx, "student", input.studentId, input.schoolId);
    const student = await tx.student.findFirst({
      where: {
        id: input.studentId,
        schoolId: input.schoolId,
        deletedAt: null,
        anonymizedAt: null,
      },
      select: { id: true, name: true, attendanceType: true },
    });
    if (!student) throw conflict("NOT_FOUND");

    const open = await tx.attendance.findMany({
      where: {
        studentId: input.studentId,
        schoolId: input.schoolId,
        checkinAt: { not: null },
        checkoutAt: null,
      },
      select: { id: true, checkinAt: true },
      orderBy: { checkinAt: "desc" },
      take: 2,
    });
    if (open.length > 1) throw conflict("OVERLAPPING_OPEN_ATTENDANCE");
    const existing = open[0];
    if (!existing?.checkinAt) throw conflict("NO_ACTIVE_ATTENDANCE");

    const totalHours = (input.now.getTime() - existing.checkinAt.getTime()) / 3_600_000;
    if (totalHours < 0) throw conflict("INVALID_ATTENDANCE_TIME");

    // This preserves the existing financial policy while making both public
    // route shapes use the exact same calculation. Replacing attendanceType or
    // the configured cutoff requires a separate, explicit billing decision.
    const school = await tx.school.findUnique({
      where: { id: input.schoolId },
      select: {
        studentCheckoutTime: true,
        settings: { select: { hourlyLateFee: true } },
      },
    });
    const cutoff = astTimeOnDay(school?.studentCheckoutTime ?? "17:00", input.now);
    const lateMinutes =
      student.attendanceType === "REGULAR" && cutoff && input.now > cutoff
        ? Math.floor((input.now.getTime() - cutoff.getTime()) / 60_000)
        : 0;
    const lateHours = lateMinutes / 60;
    const lateFee = moneyNumber(moneyMultiply(school?.settings?.hourlyLateFee, lateHours));

    const closed = await tx.attendance.updateMany({
      where: { id: existing.id, schoolId: input.schoolId, checkoutAt: null },
      data: { checkoutAt: input.now, lateMinutes, lateFee },
    });
    if (closed.count !== 1) throw conflict("ALREADY_CHECKED_OUT");
    await tx.student.update({
      where: { id: input.studentId, schoolId: input.schoolId },
      data: {
        attendanceHours: { increment: totalHours },
        lateHours: { increment: lateHours },
      },
    });
    return { attendanceId: existing.id, checkoutAt: input.now, totalHours, lateHours, lateFee, personName: student.name };
  });
}

export async function checkoutTeacher(input: {
  teacherId: string;
  schoolId: string;
  now: Date;
}) {
  return prisma.$transaction(async (tx) => {
    await lockAttendanceSubject(tx, "teacher", input.teacherId, input.schoolId);
    const teacher = await tx.teacher.findFirst({
      where: {
        id: input.teacherId,
        schoolId: input.schoolId,
        deletedAt: null,
        anonymizedAt: null,
      },
      select: { id: true, name: true },
    });
    if (!teacher) throw conflict("NOT_FOUND");

    const open = await tx.teacherAttendance.findMany({
      where: {
        teacherId: input.teacherId,
        schoolId: input.schoolId,
        checkinAt: { not: null },
        checkoutAt: null,
      },
      select: { id: true, checkinAt: true },
      orderBy: { checkinAt: "desc" },
      take: 2,
    });
    if (open.length > 1) throw conflict("OVERLAPPING_OPEN_ATTENDANCE");
    const existing = open[0];
    if (!existing?.checkinAt) throw conflict("NO_ACTIVE_ATTENDANCE");

    const school = await tx.school.findUnique({
      where: { id: input.schoolId },
      select: { teacherCheckinTime: true, teacherCheckoutTime: true },
    });
    const [inH, inM] = (school?.teacherCheckinTime ?? "08:00").split(":").map(Number);
    const [outH, outM] = (school?.teacherCheckoutTime ?? "17:00").split(":").map(Number);
    const requiredHours = (outH * 60 + outM - (inH * 60 + inM)) / 60;
    const totalHours = (input.now.getTime() - existing.checkinAt.getTime()) / 3_600_000;
    if (totalHours < 0) throw conflict("INVALID_ATTENDANCE_TIME");
    const compensated = requiredHours <= 0 || totalHours >= requiredHours;
    const lateHours = compensated ? 0 : requiredHours - totalHours;
    const lateMinutes = Math.round(lateHours * 60);

    const closed = await tx.teacherAttendance.updateMany({
      where: { id: existing.id, schoolId: input.schoolId, checkoutAt: null },
      data: { checkoutAt: input.now, lateMinutes, requiredHours, compensated },
    });
    if (closed.count !== 1) throw conflict("ALREADY_CHECKED_OUT");
    await tx.teacher.update({
      where: { id: input.teacherId, schoolId: input.schoolId },
      data: {
        attendanceHours: { increment: totalHours },
        lateHours: { increment: lateHours },
      },
    });
    return { attendanceId: existing.id, checkoutAt: input.now, totalHours, lateHours, personName: teacher.name };
  });
}
