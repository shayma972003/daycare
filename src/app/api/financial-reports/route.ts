import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { scopedClassIds } from "@/lib/student-access-scope";

export async function GET() {
  let session;
  try { session = await requireSession(); } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  if (scopedClassIds(session) !== null) {
    return Response.json({ error: "لا تملكين صلاحية للتقارير المالية الشاملة" }, { status: 403 });
  }

  const reports = await prisma.financialReport.findMany({
    where: { school_id: schoolId },
    orderBy: { issued_at: "desc" },
    select: { id: true, name: true, type: true, period_label: true, issued_at: true },
  });

  return Response.json(reports);
}
