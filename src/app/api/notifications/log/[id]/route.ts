import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const log = await prisma.notificationLog.findFirst({ where: { id, schoolId } });
  if (!log) return Response.json({ error: "Not found" }, { status: 404 });

  await prisma.notificationLog.delete({ where: { id } });

  await logAction({
    school_id: schoolId,
    action: `حذف سجل إشعار: ${log.recipientName}`,
    entity_type: "notification",
    entity_id: id,
    entity_name: log.recipientName,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
