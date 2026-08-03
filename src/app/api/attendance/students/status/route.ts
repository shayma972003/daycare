import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { astDateOnly } from "@/lib/datetime";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/attendance-schedule";
import { z } from "zod";

/**
 * Marks a child absent or on leave, or clears the day (tasks 2.12 and 2.16).
 *
 * Check-in and checkout already have their own routes because they carry
 * timestamps; this is for the states that have none. Separating them keeps the
 * timestamp logic out of a route whose whole job is to record that a child was
 * not here.
 *
 * Accepts a batch: a whole class on a school holiday is one action.
 */
const schema = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(200),
  // NO_RECORD deletes the row — it is the absence of a record, not a value.
  status: z.enum(["ABSENT", "LEAVE", "PRESENT", "NO_RECORD"]),
  note: z.string().max(200).nullish(),
  /** Defaults to today. Yesterday's register gets corrected the next morning. */
  date: z.string().optional(),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const requested = parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(requested.getTime())) {
    return Response.json({ error: "التاريخ غير صحيح" }, { status: 422 });
  }
  const date = astDateOnly(requested);

  // Ids come from the client, so ownership is proven before anything is written.
  const students = await prisma.student.findMany({
    where: { id: { in: parsed.data.studentIds }, schoolId, deletedAt: null },
    select: { id: true, name: true, classId: true },
  });

  if (students.length === 0) {
    return Response.json({ error: "لا يوجد أطفال صالحون" }, { status: 404 });
  }

  if (parsed.data.status === "NO_RECORD") {
    // Deleting the row is the point: "no record" is not a state to store, it is
    // the absence of one, and storing it would make the register lie about
    // having been taken.
    const { count } = await prisma.attendance.deleteMany({
      where: { studentId: { in: students.map((s) => s.id) }, schoolId, date },
    });

    await logAction({
      school_id: schoolId,
      action: `حذف سجل حضور ${count} طفل`,
      entity_type: "attendance",
      performed_by: session.user.name ?? "الطاقم",
      request,
    });

    return Response.json({ updated: count });
  }

  let updated = 0;
  for (const student of students) {
    await prisma.attendance.upsert({
      where: { studentId_date: { studentId: student.id, date } },
      create: {
        studentId: student.id,
        schoolId,
        classId: student.classId ?? null,
        date,
        status: parsed.data.status,
        statusNote: parsed.data.note?.trim() || null,
        // Absent and on-leave days carry no times. Leaving a stale check-in
        // would show the child as having been in the building.
        checkinAt: parsed.data.status === "PRESENT" ? new Date() : null,
      },
      update: {
        status: parsed.data.status,
        statusNote: parsed.data.note?.trim() || null,
        ...(parsed.data.status === "PRESENT"
          ? {}
          : { checkinAt: null, checkoutAt: null, lateMinutes: 0, lateFee: 0 }),
      },
    });
    updated++;
  }

  await logAction({
    school_id: schoolId,
    action: `تحديد ${ATTENDANCE_STATUS_LABELS[parsed.data.status]} لـ${updated} طفل`,
    entity_type: "attendance",
    performed_by: session.user.name ?? "الطاقم",
    request,
  });

  return Response.json({ updated });
}
