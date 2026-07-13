import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const items = await prisma.class.findMany({
    where: { schoolId, deletedAt: { not: null } },
    select: { id: true, name: true, deletedAt: true },
    orderBy: { deletedAt: "desc" },
  });

  return Response.json({ items }, { status: 200 });
}
