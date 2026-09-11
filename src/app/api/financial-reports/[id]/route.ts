import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;
  const report = await prisma.financialReport.findFirst({
    where: { id, school_id: schoolId },
    select: { id: true, name: true, file_url: true },
  });

  if (!report) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(report);
}
