import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const result = await prisma.teacher.updateMany({
    where: { schoolId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });

  return Response.json({ restored: result.count }, { status: 200 });
}
