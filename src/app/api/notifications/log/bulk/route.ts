import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { assertCan } from "@/lib/authz";
import { z } from "zod";

const querySchema = z.object({ source: z.enum(["activity", "other"]).optional() });

export async function DELETE(request: Request) {
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

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }
  const sourceParam = parsed.data.source;

  let sourceFilter: Record<string, unknown> = {};
  if (sourceParam === "activity") {
    sourceFilter = { source: "activity" };
  } else if (sourceParam === "other") {
    sourceFilter = { source: { not: "activity" } };
  }

  const { count } = await prisma.notificationLog.deleteMany({
    where: { schoolId, ...sourceFilter },
  });

  await logAction({
    school_id: schoolId,
    action: `مسح جميع سجلات الإشعارات (${count})`,
    entity_type: "notification",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ deleted: count });
}
