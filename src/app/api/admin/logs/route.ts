import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const school_id = url.searchParams.get("school_id") ?? undefined;
  const action = url.searchParams.get("action") ?? undefined;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "50"));

  const where = {
    ...(school_id && { school_id }),
    ...(action && { action }),
    ...(from || to
      ? {
          performed_at: {
            ...(from && { gte: new Date(from) }),
            ...(to && { lte: new Date(to) }),
          },
        }
      : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.adminActivityLog.findMany({
      where,
      include: { school: { select: { name: true } } },
      orderBy: { performed_at: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.adminActivityLog.count({ where }),
  ]);

  return Response.json({
    logs: logs.map((l) => ({
      id: l.id,
      action: l.action,
      schoolName: l.school?.name ?? null,
      school_id: l.school_id,
      metadata: l.metadata,
      performed_by: l.performed_by,
      performed_at: l.performed_at,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
