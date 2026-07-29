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

  const teacher = await prisma.teacher.findFirst({
    where: { id, schoolId, deletedAt: { not: null } },
  });
  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.teacher.update({ where: { id }, data: { deletedAt: null } });

  await logAction({
    school_id: schoolId,
    action: `تم استعادة المعلم "${teacher.name}" من سلة المحذوفات`,
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true }, { status: 200 });
}
