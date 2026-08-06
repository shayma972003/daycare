import { requireMobileAuth, mobileAuthResponse } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";
import { astDateOnly } from "@/lib/datetime";
import { z } from "zod";

/**
 * Check a child in or out from the app.
 *
 * The rules here are the dashboard's, deliberately: one `Attendance` row per
 * child per day (`@@unique([studentId, date])`), an upsert rather than a create
 * so re-entry after checkout updates the same row instead of raising a
 * constraint violation, and a re-entry clearing `checkoutAt` because the child
 * is in the building again.
 *
 * Two doors into one table is how the two drift apart, so this route holds no
 * arithmetic of its own — "today" comes from `astDateOnly()`, the single
 * definition the dashboard, the cron jobs and the reports all read.
 *
 * A duplicate check-in answers 409. That is not an error to hide: it means
 * somebody already did it, and the app should say so rather than silently
 * overwrite a time another member of staff recorded.
 */
const schema = z.object({
  studentId: z.string().min(1),
  action: z.enum(["checkin", "checkout"]),
});

export async function POST(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, {
      kind: "staff",
      permission: "attendance.students",
    });
  } catch (error) {
    const response = mobileAuthResponse(error);
    if (response) return response;
    throw error;
  }

  const schoolId = context.claims.schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });
  }

  const { studentId, action } = parsed.data;

  // Scoped to the caller's school before anything is written — the id arrives
  // from a client and proves nothing on its own.
  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId, deletedAt: null },
    select: { id: true, classId: true },
  });
  if (!student) {
    return Response.json({ error: "الطفل غير موجود" }, { status: 404 });
  }

  const today = astDateOnly();
  const existing = await prisma.attendance.findUnique({
    where: { studentId_date: { studentId, date: today } },
    select: { id: true, checkinAt: true, checkoutAt: true, status: true },
  });

  if (action === "checkin") {
    if (existing && !existing.checkoutAt && existing.status === "PRESENT") {
      return Response.json({ error: "الطفل مسجل دخوله بالفعل" }, { status: 409 });
    }

    const attendance = await prisma.attendance.upsert({
      where: { studentId_date: { studentId, date: today } },
      create: {
        studentId,
        schoolId,
        classId: student.classId ?? null,
        checkinAt: new Date(),
        status: "PRESENT",
        date: today,
      },
      update: {
        // Only restamped when they had left and came back.
        checkinAt: existing?.checkoutAt ? new Date() : undefined,
        checkoutAt: null,
        status: "PRESENT",
        // A day previously marked absent or on leave is a present day now.
        statusNote: null,
        classId: student.classId ?? null,
      },
    });

    return Response.json({
      id: attendance.id,
      checkedInAt: attendance.checkinAt?.toISOString() ?? null,
      checkedOutAt: null,
      nextAction: "checkout",
    });
  }

  if (!existing || !existing.checkinAt) {
    return Response.json({ error: "الطفل لم يسجل دخوله اليوم" }, { status: 409 });
  }
  if (existing.checkoutAt) {
    return Response.json({ error: "الطفل مسجل خروجه بالفعل" }, { status: 409 });
  }

  const attendance = await prisma.attendance.update({
    where: { studentId_date: { studentId, date: today } },
    data: { checkoutAt: new Date() },
  });

  return Response.json({
    id: attendance.id,
    checkedInAt: attendance.checkinAt?.toISOString() ?? null,
    checkedOutAt: attendance.checkoutAt?.toISOString() ?? null,
    nextAction: "done",
  });
}
