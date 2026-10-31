import { z } from "zod";
import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { refreshStorageUsage } from "@/lib/storage-usage";
import { isSupportToolAction } from "@/lib/support-access";

const schema = z.object({
  action: z.string().min(1),
  reason: z.string().trim().min(10).max(500),
  confirmed: z.literal(true),
});

export async function POST(request: Request, context: RouteContext<"/api/admin/support-access/[id]/actions">) {
  const admin = await verifyAdminSessionFromRequest(request);
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 422 });
  if (!isSupportToolAction(parsed.data.action)) return Response.json({ error: "أداة الدعم غير مسموحة" }, { status: 422 });

  const access = await prisma.supportAccessSession.findFirst({
    where: { id: (await context.params).id, createdByAdminId: admin.adminId },
    select: { id: true, schoolId: true, ticketId: true, expiresAt: true, revokedAt: true },
  });
  if (!access) return Response.json({ error: "جلسة الدعم غير موجودة" }, { status: 404 });
  const now = new Date();
  if (access.revokedAt || access.expiresAt <= now) return Response.json({ error: "انتهت جلسة الدعم", expired: true }, { status: 410 });

  const commonMetadata = {
    accessSessionId: access.id,
    ticketId: access.ticketId,
    tool: parsed.data.action,
    reason: parsed.data.reason,
  };
  await prisma.adminActivityLog.create({
    data: {
      school_id: access.schoolId,
      action: "support_tool_started",
      performed_by: admin.adminId,
      metadata: commonMetadata,
    },
  });

  try {
    const result = await refreshStorageUsage(access.schoolId);
    await prisma.adminActivityLog.create({
      data: {
        school_id: access.schoolId,
        action: "support_tool_completed",
        performed_by: admin.adminId,
        metadata: { ...commonMetadata, totalBytes: result.totalBytes },
      },
    });
    return Response.json({ success: true, action: parsed.data.action, result: { totalBytes: result.totalBytes } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await prisma.adminActivityLog.create({
      data: {
        school_id: access.schoolId,
        action: "support_tool_failed",
        performed_by: admin.adminId,
        metadata: { ...commonMetadata, error: error instanceof Error ? error.name : "UnknownError" },
      },
    });
    throw error;
  }
}
