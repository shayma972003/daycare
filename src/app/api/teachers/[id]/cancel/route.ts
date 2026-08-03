import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { buildTeacherDeparture, getRetentionPolicy } from "@/lib/data-retention";

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

  const teacher = await prisma.teacher.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Same reasoning as the student cancel route: ending the engagement has to set
  // `leftAt`, otherwise the record is archived with no expiry and the sweep will
  // never reach it.
  const policy = await getRetentionPolicy();
  const updated = await prisma.teacher.update({
    where: { id },
    data: buildTeacherDeparture(
      "CONTRACT_ENDED",
      teacher.leftAt ?? null,
      policy.employeeRetentionYears
    ),
  });

  await logAction({
    school_id: schoolId,
    action: `إلغاء انضمام المعلم: ${teacher.name}`,
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(updated);
}
