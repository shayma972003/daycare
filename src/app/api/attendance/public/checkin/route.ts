import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { resolveAttendanceToken } from "@/lib/attendance-token";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { logAction } from "@/lib/activity-logger";
import { astDayStart } from "@/lib/datetime";

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

  // The token establishes which tenant this kiosk belongs to. It is never taken
  // from the request body, so one school's kiosk cannot touch another's records.
  const school = await resolveAttendanceToken(token);
  if (!school) return Response.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const today = astDayStart(now);

  if (type === "student") {
    const student = await prisma.student.findFirst({
      where: { id: person_id, schoolId: school.id, deletedAt: null, isActive: true },
      select: { id: true, name: true, classId: true },
    });
    if (!student) return Response.json({ error: "Not found" }, { status: 404 });

    // Upsert against the (studentId, date) unique key: a double-tapped tablet
    // updates the same row instead of creating a duplicate day.
    const attendance = await prisma.attendance.upsert({
      where: { studentId_date: { studentId: student.id, date: today } },
      create: {
        studentId: student.id,
        schoolId: school.id,
        classId: student.classId ?? null,
        checkinAt: now,
        date: today,
      },
      update: { checkinAt: now },
    });

    logAction({
      school_id: school.id,
      action: "تسجيل حضور طفل عبر جهاز الحضور",
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

  // Re-opening a closed day previously created a second row, which let a
  // check-in/check-out loop inflate the teacher's paid hours without bound.
  const attendance = await prisma.teacherAttendance.upsert({
    where: { teacherId_date: { teacherId: teacher.id, date: today } },
    create: {
      teacherId: teacher.id,
      schoolId: school.id,
      checkinAt: now,
      date: today,
    },
    update: {},
  });

  logAction({
    school_id: school.id,
    action: "تسجيل حضور موظف عبر جهاز الحضور",
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: "جهاز الحضور",
    request,
  }).catch(() => {});

  return Response.json(attendance);
}
