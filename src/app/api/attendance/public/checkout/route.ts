import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { resolveAttendanceToken } from "@/lib/attendance-token";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { logAction } from "@/lib/activity-logger";
import { astDateOnly, astTimeOnDay } from "@/lib/datetime";

const schema = z.object({
  token: z.string().min(16),
  person_id: z.string().min(1),
  type: z.enum(["student", "teacher"]),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });
  const { token, person_id, type } = parsed.data;

  const limited = await rateLimit({
    key: `kiosk:write:${clientIp(request)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const school = await resolveAttendanceToken(token);
  if (!school) return Response.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const today = astDateOnly(now);

  if (type === "student") {
    const student = await prisma.student.findFirst({
      where: { id: person_id, schoolId: school.id, deletedAt: null, isActive: true },
      select: { id: true, name: true },
    });
    if (!student) return Response.json({ error: "Not found" }, { status: 404 });

    // `checkoutAt: null` is the fix for the worst bug in this route. Without it
    // the same request could be replayed indefinitely, and each replay
    // incremented the child's lifetime lateHours again — unauthenticated,
    // unbounded corruption of a billable figure.
    const existing = await prisma.attendance.findFirst({
      where: {
        studentId: student.id,
        schoolId: school.id,
        date: today,
        checkinAt: { not: null },
        checkoutAt: null,
      },
    });
    if (!existing) {
      return Response.json({ error: "لا يوجد تسجيل حضور نشط اليوم" }, { status: 404 });
    }

    const settings = await prisma.settings.findUnique({
      where: { schoolId: school.id },
      select: { hourlyLateFee: true },
    });
    const schoolRecord = await prisma.school.findUnique({
      where: { id: school.id },
      select: { studentCheckoutTime: true },
    });

    // Honour the school's configured closing time rather than a hardcoded 17:00
    // interpreted in the server's timezone.
    const cutoff = astTimeOnDay(schoolRecord?.studentCheckoutTime ?? "17:00", now);
    const lateMinutes =
      cutoff && now > cutoff ? Math.floor((now.getTime() - cutoff.getTime()) / 60_000) : 0;
    const lateFee = (lateMinutes / 60) * (settings?.hourlyLateFee ?? 0);

    // Attendance row and the child's running total move together, so a failure
    // cannot leave the two disagreeing.
    const [attendance] = await prisma.$transaction([
      prisma.attendance.update({
        where: { id: existing.id },
        data: { checkoutAt: now, lateMinutes, lateFee },
      }),
      ...(lateMinutes > 0
        ? [
            prisma.student.update({
              where: { id: student.id },
              data: { lateHours: { increment: lateMinutes / 60 } },
            }),
          ]
        : []),
    ]);

    logAction({
      school_id: school.id,
      action: "تسجيل انصراف طفل عبر جهاز الحضور",
      entity_type: "student",
      entity_id: student.id,
      entity_name: student.name,
      performed_by: "جهاز الحضور",
      request,
    }).catch(() => {});

    return Response.json(attendance);
  }

  const teacher = await prisma.teacher.findFirst({
    where: { id: person_id, schoolId: school.id, deletedAt: null, isActive: true },
    select: { id: true, name: true },
  });
  if (!teacher) return Response.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.teacherAttendance.findFirst({
    where: {
      teacherId: teacher.id,
      schoolId: school.id,
      date: today,
      checkinAt: { not: null },
      checkoutAt: null,
    },
  });
  if (!existing) {
    return Response.json({ error: "لا يوجد تسجيل دخول نشط اليوم" }, { status: 404 });
  }

  const schoolHours = await prisma.school.findUnique({
    where: { id: school.id },
    select: { teacherCheckinTime: true, teacherCheckoutTime: true },
  });

  const shiftStart = astTimeOnDay(schoolHours?.teacherCheckinTime ?? "08:00", now);
  const shiftEnd = astTimeOnDay(schoolHours?.teacherCheckoutTime ?? "17:00", now);
  const requiredHours =
    shiftStart && shiftEnd
      ? Math.max(0, (shiftEnd.getTime() - shiftStart.getTime()) / 3_600_000)
      : 0;

  const actualHours = (now.getTime() - existing.checkinAt!.getTime()) / 3_600_000;
  const compensated = requiredHours <= 0 || actualHours >= requiredHours;
  const lateHours = compensated ? 0 : requiredHours - actualHours;

  const [attendance] = await prisma.$transaction([
    prisma.teacherAttendance.update({
      where: { id: existing.id },
      data: {
        checkoutAt: now,
        lateMinutes: Math.round(lateHours * 60),
        requiredHours,
        compensated,
      },
    }),
    prisma.teacher.update({
      where: { id: teacher.id },
      data: {
        attendanceHours: { increment: actualHours },
        lateHours: { increment: lateHours },
      },
    }),
  ]);

  logAction({
    school_id: school.id,
    action: "تسجيل انصراف موظف عبر جهاز الحضور",
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: "جهاز الحضور",
    request,
  }).catch(() => {});

  return Response.json(attendance);
}
