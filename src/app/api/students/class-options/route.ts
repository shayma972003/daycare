import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { withNoStore } from "@/lib/auth-response";

/** Minimal tenant-scoped options for student forms; not the full class API. */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.can("students.manage")) {
    return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period");
  const validPeriod = period === "MORNING" || period === "EVENING" ? period : null;
  const classes = await prisma.class.findMany({
    where: { schoolId: session.user.schoolId, deletedAt: null, ...(validPeriod ? { period: validPeriod } : {}) },
    select: { id: true, name: true, period: true },
    orderBy: { name: "asc" },
  });
  return withNoStore(Response.json(classes));
}
