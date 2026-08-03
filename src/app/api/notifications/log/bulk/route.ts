import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";

export async function DELETE(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const sourceParam = searchParams.get("source"); // "activity" | "other"

  let sourceFilter: Record<string, unknown> = {};
  if (sourceParam === "activity") {
    sourceFilter = { source: "activity" };
  } else if (sourceParam === "other") {
    sourceFilter = { source: { not: "activity" } };
  }

  const { count } = await prisma.notificationLog.deleteMany({
    where: { schoolId, ...sourceFilter },
  });

  await logAction({
    school_id: schoolId,
    action: `مسح جميع سجلات الإشعارات (${count})`,
    entity_type: "notification",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ deleted: count });
}
