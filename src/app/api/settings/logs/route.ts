import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = session.user.schoolId;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const entityType = searchParams.get("entity_type") ?? "";
  const skip = Math.max(0, Number(searchParams.get("skip")) || 0);

  const where: Record<string, unknown> = { school_id: schoolId };
  if (entityType) where.entity_type = entityType;
  if (search) {
    where.OR = [
      { action: { contains: search, mode: "insensitive" } },
      { entity_name: { contains: search, mode: "insensitive" } },
      { performed_by: { contains: search, mode: "insensitive" } },
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.activityLog.count({ where }),
  ]);

  return Response.json({ logs, total, pageSize: PAGE_SIZE }, { status: 200 });
}
