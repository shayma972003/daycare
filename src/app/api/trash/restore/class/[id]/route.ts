import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";

export async function POST(
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

  const cls = await prisma.class.findFirst({
    where: { id, schoolId, deletedAt: { not: null } },
  });
  if (!cls) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.class.update({ where: { id }, data: { deletedAt: null } });

  await logAction({
    school_id: schoolId,
    action: `تم استعادة الفصل "${cls.name}" من سلة المحذوفات`,
    entity_type: "class",
    entity_id: cls.id,
    entity_name: cls.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true }, { status: 200 });
}
