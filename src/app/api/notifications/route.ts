import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/authz";
import { withNoStore } from "@/lib/auth-response";
import { z } from "zod";

const querySchema = z.object({
  skip: z.coerce.number().int().min(0).max(100_000).default(0),
  take: z.coerce.number().int().min(1).max(100).default(20),
  source: z.enum(["activity", "other"]).optional(),
});

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
    assertCan(session, "settings.manage");
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const searchParams = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(searchParams);
  if (!parsed.success) {
    return withNoStore(
      Response.json({ error: parsed.error.flatten() }, { status: 422 })
    );
  }
  const { skip, take, source: sourceParam } = parsed.data;

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
      skip,
      take,
      select: {
        id: true,
        recipientName: true,
        type: true,
        content: true,
        status: true,
        source: true,
        sentAt: true,
      },
    }),
    prisma.notificationLog.count({ where }),
  ]);

  return withNoStore(Response.json({ logs, total }));
}
