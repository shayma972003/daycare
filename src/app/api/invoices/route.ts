import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get("studentId");
  const teacherId = searchParams.get("teacherId");
  const type = searchParams.get("type");

  const where: Record<string, unknown> = { schoolId };
  if (studentId) where.studentId = studentId;
  if (teacherId) where.teacherId = teacherId;
  if (type === "STUDENT" || type === "TEACHER") where.type = type;

  const invoices = await prisma.invoice.findMany({
    where,
    include: { student: true, teacher: true },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(invoices, { status: 200 });
}
