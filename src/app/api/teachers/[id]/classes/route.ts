import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
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

  const teacher = await prisma.teacher.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const assignedClasses = await prisma.class.findMany({
    where: { teacherId: id, schoolId, deletedAt: null },
    select: { id: true, name: true, group: true },
  });

  return Response.json({ assignedClasses }, { status: 200 });
}
