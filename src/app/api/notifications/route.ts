import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const { searchParams } = new URL(request.url);
  const skipParam = searchParams.get("skip");
  const takeParam = searchParams.get("take");
  const skip = skipParam ? parseInt(skipParam, 10) : 0;
  const take = takeParam ? parseInt(takeParam, 10) : 20;

  const [logs, total] = await Promise.all([
    prisma.notificationLog.findMany({
      where: { schoolId },
      orderBy: { sentAt: "desc" },
      skip: isNaN(skip) || skip < 0 ? 0 : skip,
      take: isNaN(take) || take <= 0 ? 20 : take,
    }),
    prisma.notificationLog.count({ where: { schoolId } }),
  ]);

  return Response.json({ logs, total });
}
