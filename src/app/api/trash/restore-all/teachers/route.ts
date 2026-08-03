import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";

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

  const result = await prisma.teacher.updateMany({
    where: { schoolId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });

  await logAction({
    school_id: schoolId,
    action: "استعادة جميع المعلمين من سلة المحذوفات",
    entity_type: "teacher",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ restored: result.count }, { status: 200 });
}
