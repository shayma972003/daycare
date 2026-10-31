import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { buildSupportViewCookie, clearSupportViewCookie, signSupportViewToken } from "@/lib/support-view-token";

export async function POST(request: Request, context: RouteContext<"/api/admin/support-access/[id]/enter">) {
  const admin = await verifyAdminSessionFromRequest(request);
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const now = new Date();
  const access = await prisma.supportAccessSession.findFirst({
    where: { id, createdByAdminId: admin.adminId, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true, schoolId: true, ticketId: true, expiresAt: true },
  });
  if (!access) return Response.json({ error: "جلسة الدعم غير متاحة أو انتهت", expired: true }, { status: 410 });

  const token = await signSupportViewToken({
    accessId: access.id,
    adminId: admin.adminId,
    schoolId: access.schoolId,
    expiresAt: access.expiresAt,
  });
  await prisma.adminActivityLog.create({
    data: {
      school_id: access.schoolId,
      action: "support_tenant_view_entered",
      performed_by: admin.adminId,
      metadata: { accessSessionId: access.id, ticketId: access.ticketId },
    },
  });
  return Response.json(
    { success: true, redirectTo: "/dashboard", expiresAt: access.expiresAt },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": buildSupportViewCookie(token, access.expiresAt) } },
  );
}

export async function DELETE(request: Request) {
  const admin = await verifyAdminSessionFromRequest(request);
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(
    { success: true },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": clearSupportViewCookie() } },
  );
}
