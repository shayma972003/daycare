import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(
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
    where: { id, schoolId, deletedAt: { not: null } },
  });
  if (!cls) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.class.update({ where: { id }, data: { deletedAt: null } });

  return Response.json({ success: true }, { status: 200 });
}
