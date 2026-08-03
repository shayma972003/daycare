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

  // `parseInt` returns NaN for anything non-numeric, and `Math.max(1, NaN)` is
  // NaN — which Prisma rejected with a 500. `?limit=abc` was a crash, and
  // `?limit=0` produced `take: 0` (an empty page that looks like "no logs").
  const page = clampInt(url.searchParams.get("page"), 1, 1, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 100);

  const where = {
    ...(school_id && { school_id }),
    ...(action && { action }),
    ...(from || to
      ? {
          performed_at: {
            // An unparseable date produced an Invalid Date, which Prisma also
            // rejects. Bad filter values are ignored rather than fatal.
            ...(parseDate(from) && { gte: parseDate(from)! }),
            ...(parseDate(to) && { lte: parseDate(to)! }),
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

/** Parses a query-string integer, falling back rather than producing NaN. */
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
