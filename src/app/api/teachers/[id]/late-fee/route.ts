import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function DELETE(
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

  const teacher = await prisma.teacher.findFirst({ where: { id, schoolId } });
  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.teacher.update({
    where: { id },
    data: { lateHours: 0 },
  });

  return Response.json({ success: true });
}
