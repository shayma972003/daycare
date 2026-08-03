import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";

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
  const skipParam = searchParams.get("skip");
  const takeParam = searchParams.get("take");
  const sourceParam = searchParams.get("source"); // "activity" | "other" | null (all)

  const skip = skipParam ? parseInt(skipParam, 10) : 0;
  const take = takeParam ? parseInt(takeParam, 10) : 20;

  // Build source filter
  let sourceFilter: Record<string, unknown> = {};
  if (sourceParam === "activity") {
    sourceFilter = { source: "activity" };
  } else if (sourceParam === "other") {
    sourceFilter = { source: { not: "activity" } };
  }

  const where = { schoolId, ...sourceFilter };

  const [logs, total] = await Promise.all([
    prisma.notificationLog.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip: isNaN(skip) || skip < 0 ? 0 : skip,
      take: isNaN(take) || take <= 0 ? 20 : take,
    }),
    prisma.notificationLog.count({ where }),
  ]);

  return Response.json({ logs, total });
}
