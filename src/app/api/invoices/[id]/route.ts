import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { scopedClassIds, studentClassWhere } from "@/lib/student-access-scope";

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
  const classIds = scopedClassIds(session);
  const where: Prisma.InvoiceWhereInput = {
    id,
    schoolId,
    generationStatus: "COMPLETED",
    ...(classIds !== null
      ? {
          OR: [
            { student: { is: { schoolId, ...studentClassWhere(session) } } },
            { teacherId: session.teacherId ?? "" },
          ],
        }
      : {}),
  };

  const invoice = await prisma.invoice.findFirst({
    where,
    include: { student: true, teacher: true },
  });

  if (!invoice) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(invoice, { status: 200 });
}
