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

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: { not: null } },
  });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.attendance.deleteMany({ where: { studentId: id } }),
    prisma.invoice.updateMany({ where: { studentId: id }, data: { studentId: null } }),
    prisma.student.delete({ where: { id } }),
  ]);

  return Response.json({ success: true }, { status: 200 });
}
