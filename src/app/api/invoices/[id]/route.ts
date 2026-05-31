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

  const invoice = await prisma.invoice.findFirst({
    where: { id, schoolId },
    include: { student: true, teacher: true },
  });

  if (!invoice) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(invoice, { status: 200 });
}
