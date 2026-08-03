import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
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

  const cls = await prisma.class.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!cls) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const students = await prisma.student.findMany({
    where: { classId: id, schoolId, deletedAt: null },
    select: { id: true, name: true },
  });

  return Response.json({ count: students.length, students }, { status: 200 });
}
