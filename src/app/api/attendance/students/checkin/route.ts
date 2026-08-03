import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { astDateOnly } from "@/lib/datetime";
import { z } from "zod";

const schema = z.object({
  student_id: z.string(),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { student_id } = parsed.data;

  const student = await prisma.student.findFirst({
    where: { id: student_id, schoolId, deletedAt: null },
    select: { id: true, classId: true },
  });
  if (!student) {
    return Response.json({ error: "الطالب غير موجود" }, { status: 404 });
  }

  // Shared AST helper rather than the inline offset arithmetic this route used
  // to carry — task 0.64 exists so there is one definition of "today".
  const today = astDateOnly();

  const existing = await prisma.attendance.findUnique({
    where: { studentId_date: { studentId: student_id, date: today } },
    select: { id: true, checkoutAt: true, status: true },
  });

  if (existing && !existing.checkoutAt && existing.status === "PRESENT") {
    return Response.json({ error: "الطالب مسجل دخوله بالفعل" }, { status: 409 });
  }

  /**
   * Upsert, not create.
   *
   * The comment here used to say "create a new record even on re-entry after
   * checkout" — which the `@@unique([studentId, date])` added in task 0.40 makes
   * impossible: the second create raises a constraint violation that surfaces as
   * a 500. Re-entry now updates the same row, which is also what one-row-per-day
   * means.
   *
   * A re-entry clears `checkoutAt`: the child is in the building again, and
   * leaving the old checkout in place would show them as gone.
   */
  const attendance = await prisma.attendance.upsert({
    where: { studentId_date: { studentId: student_id, date: today } },
    create: {
      studentId: student_id,
      schoolId,
      classId: student.classId ?? null,
      checkinAt: new Date(),
      status: "PRESENT",
      date: today,
    },
    update: {
      checkinAt: existing?.checkoutAt ? new Date() : undefined,
      checkoutAt: null,
      status: "PRESENT",
      // A day previously marked absent or on leave is now a present day; the
      // reason no longer applies.
      statusNote: null,
      classId: student.classId ?? null,
    },
  });

  return Response.json(
    {
      attendance_id: attendance.id,
      checkin_time: attendance.checkinAt,
      status: attendance.status,
    },
    { status: 201 }
  );
}
