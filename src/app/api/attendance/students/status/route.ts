import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { calendarToday, requestTimeZone, storedDate } from "@/lib/device-date";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/attendance-schedule";
import { z } from "zod";

const schema = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(200),
  status: z.enum(["ABSENT", "LEAVE", "PRESENT", "NO_RECORD"]),
  note: z.string().max(200).nullish(),
  date: z.iso.date().optional(),
});

export async function POST(request: Request) {
  let session;
  try { session = await requireSession(); }
  catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.can("attendance.students")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const schoolId = session.user.schoolId;

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  let date: Date;
  let today: Date;
  try {
    const timeZone = requestTimeZone(request);
    today = calendarToday(new Date(), timeZone);
    date = parsed.data.date
      ? storedDate(parsed.data.date)
      : today;
  } catch {
    return Response.json({ error: "Invalid date or time zone" }, { status: 422 });
  }

  if (parsed.data.status === "PRESENT") {
    return Response.json({
      error: "Presence must be recorded using check-in",
      code: "MANUAL_PRESENT_NOT_ALLOWED",
    }, { status: 422 });
  }
  if (date > today) {
    return Response.json({
      error: "Future attendance cannot be edited",
      code: "FUTURE_ATTENDANCE_NOT_ALLOWED",
    }, { status: 422 });
  }

  const note = parsed.data.note?.trim() || null;
  const outcome = await prisma.$transaction(async (tx) => {
    const students = await tx.student.findMany({
      where: {
        id: { in: parsed.data.studentIds },
        schoolId,
        deletedAt: null,
        anonymizedAt: null,
      },
      select: { id: true, classId: true },
    });
    if (students.length === 0) return { kind: "missing" as const };

    const ids = students.map((student) => student.id);
    const existing = await tx.attendance.findMany({
      where: { studentId: { in: ids }, schoolId, date },
      select: {
        id: true,
        studentId: true,
        status: true,
        checkinAt: true,
        checkoutAt: true,
      },
    });
    const byStudent = new Map(existing.map((record) => [record.studentId, record]));
    const protectedRecords = existing.filter((record) => {
      if (!record.checkinAt && !record.checkoutAt) return false;
      return parsed.data.status === "NO_RECORD" || record.status !== parsed.data.status;
    });
    if (protectedRecords.length > 0) {
      return { kind: "protected" as const, count: protectedRecords.length };
    }

    let updated = 0;
    if (parsed.data.status === "NO_RECORD") {
      const deleted = await tx.attendance.deleteMany({
        where: {
          studentId: { in: ids },
          schoolId,
          date,
          checkinAt: null,
          checkoutAt: null,
        },
      });
      return { kind: "success" as const, updated: deleted.count };
    }

    for (const student of students) {
      const record = byStudent.get(student.id);
      if (record) {
        await tx.attendance.update({
          where: { id: record.id },
          data: { status: parsed.data.status, statusNote: note },
        });
      } else {
        await tx.attendance.create({
          data: {
            studentId: student.id,
            schoolId,
            classId: student.classId ?? null,
            date,
            status: parsed.data.status,
            statusNote: note,
            // A weekly register mark is not a physical check-in. The server
            // records times only through the explicit check-in route.
            checkinAt: null,
            checkoutAt: null,
          },
        });
      }
      updated++;
    }
    return { kind: "success" as const, updated };
  });

  if (outcome.kind === "missing") {
    return Response.json({ error: "No eligible students found" }, { status: 404 });
  }
  if (outcome.kind === "protected") {
    return Response.json({
      error: "A recorded check-in or checkout cannot be replaced from the weekly status grid",
      code: "ATTENDANCE_TIMES_PROTECTED",
    }, { status: 409 });
  }

  await logAction({
    school_id: schoolId,
    action: parsed.data.status === "NO_RECORD"
      ? "إزالة حالة يدوية من سجل الحضور"
      : "تحديد " + ATTENDANCE_STATUS_LABELS[parsed.data.status] + " لـ" + outcome.updated + " طفل",
    entity_type: "attendance",
    performed_by: session.user.name ?? "الطاقم",
    request,
  });

  return Response.json({ updated: outcome.updated });
}
