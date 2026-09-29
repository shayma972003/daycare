import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { scopedClassIds, studentClassWhere } from "@/lib/student-access-scope";

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get("studentId");
  const teacherId = searchParams.get("teacherId");
  const type = searchParams.get("type");

  const classIds = scopedClassIds(session);
  const where: Prisma.InvoiceWhereInput = {
    schoolId,
    generationStatus: "COMPLETED",
    ...(classIds === null
      ? {}
      : {
          OR: [
            { student: { is: { schoolId, ...studentClassWhere(session) } } },
            { teacherId: session.teacherId ?? "" },
          ],
        }),
  };
  if (studentId) where.studentId = studentId;
  if (teacherId) where.teacherId = teacherId;
  if (type === "STUDENT" || type === "TEACHER") where.type = type;

  const invoices = await prisma.invoice.findMany({
    where,
    // PDF data URIs are intentionally excluded. Returning every stored PDF in a
    // list response made opening a profile scale with the total invoice archive.
    // The dedicated PDF route streams a stored or regenerated document only
    // when the user asks for it.
    select: {
      id: true,
      type: true,
      amount: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(invoices, { status: 200 });
}
