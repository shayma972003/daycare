import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function PUT(
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

  const expense = await prisma.expense.findFirst({
    where: { id, school_id: schoolId, type: "monthly" },
  });
  if (!expense) return Response.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.expense.update({
    where: { id },
    data: { is_active: false, stopped_at: new Date() },
  });

  return Response.json(updated);
}
