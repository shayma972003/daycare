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

  const cls = await prisma.class.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true, period: true },
  });
  if (!cls) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const students = await prisma.student.findMany({
    where: {
      schoolId,
      deletedAt: null,
      isActive: true,
      classId: null,
      period: cls.period,
    },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      period: true,
    },
    orderBy: { name: "asc" },
  });

  return Response.json(students, { status: 200 });
}
