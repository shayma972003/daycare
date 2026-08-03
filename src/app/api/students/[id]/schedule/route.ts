import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { WEEKDAY_LABELS, expectedDays } from "@/lib/attendance-schedule";
import { z } from "zod";

/**
 * Which weekdays a child attends (task 2.11).
 *
 * A part-time child enrolled three days a week should not appear absent on the
 * other two — that is the number this feature exists to fix, and without it the
 * attendance ratio is wrong for exactly the families that most want to see it.
 */
const schema = z.object({
  // 0 = Sunday … 6 = Saturday, matching Date.getUTCDay().
  days: z.array(z.number().int().min(0).max(6)).max(7),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

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

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true, name: true, anonymizedAt: true },
  });
  if (!student) return Response.json({ error: "Not found" }, { status: 404 });
  if (student.anonymizedAt) {
    return Response.json(
      { error: "هذا السجل مجهَّل نهائياً ولا يمكن تعديله" },
      { status: 409 }
    );
  }

  // Deduplicated and sorted so the stored array has one canonical form —
  // otherwise [1,0,1] and [0,1] are the same schedule that compare unequal.
  const days = Array.from(new Set(parsed.data.days)).sort((a, b) => a - b);

  const updated = await prisma.student.update({
    where: { id },
    data: { attendanceDays: days },
    select: { id: true, attendanceDays: true },
  });

  await logAction({
    school_id: schoolId,
    action: `تعيين أيام حضور ${student.name}: ${expectedDays(days)
      .map((day) => WEEKDAY_LABELS[day])
      .join("، ")}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({
    ...updated,
    // Echoed resolved so the client never has to re-implement the "empty means
    // the default week" rule.
    effectiveDays: expectedDays(updated.attendanceDays),
  });
}
