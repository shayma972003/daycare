import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { activityLogData } from "@/lib/activity-logger";

export async function PUT(
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

  const updated = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({
      where: { id, school_id: schoolId, type: "monthly" },
    });
    if (!expense) return null;
    const claimed = await tx.expense.updateMany({
      where: { id, school_id: schoolId, type: "monthly" },
      data: { is_active: false, stopped_at: new Date() },
    });
    if (claimed.count !== 1) return null;
    const saved = await tx.expense.findFirstOrThrow({ where: { id, school_id: schoolId } });
    await tx.activityLog.create({
      data: activityLogData({
        school_id: schoolId,
        action: "monthly expense stopped",
        entity_type: "expense",
        entity_id: saved.id,
        entity_name: saved.title,
        performed_by: session.user.name ?? "admin",
        request,
      }),
    });
    return saved;
  });
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json(updated);
}
