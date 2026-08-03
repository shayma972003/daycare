import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { buildStudentDeparture } from "@/lib/data-retention";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  const student = await prisma.student.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // A record whose personal data is already gone cannot be brought back into
  // service — there is no child left in it to re-enrol.
  if (student.anonymizedAt) {
    return Response.json(
      { error: "هذا السجل مجهَّل نهائياً ولا يمكن إعادة تفعيله" },
      { status: 409 }
    );
  }

  // Returning clears the departure date and the expiry with it. Leaving a
  // `retentionUntil` behind would let the nightly sweep wipe the personal data of
  // a child who is enrolled again — the worst failure this feature can have.
  // The `years` argument is unused on the ACTIVE branch; it is passed to keep the
  // one entry point for lifecycle writes.
  const updated = await prisma.student.update({
    where: { id },
    data: buildStudentDeparture("ACTIVE", null, 0),
  });

  await logAction({
    school_id: schoolId,
    action: `إعادة تسجيل الطالب: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(updated);
}
