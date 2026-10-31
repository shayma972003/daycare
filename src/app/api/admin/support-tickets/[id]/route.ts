import { z } from "zod";
import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedAdminId: z.string().min(1).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
});

export async function GET(request: Request, context: RouteContext<"/api/admin/support-tickets/[id]">) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      school: { select: { id: true, name: true, subscription_status: true } },
      requesterUser: { select: { id: true, name: true, email: true } },
      assignedAdmin: { select: { id: true, email: true } },
      notes: {
        select: { id: true, body: true, isInternal: true, createdAt: true, authorAdmin: { select: { email: true } } },
        orderBy: { createdAt: "asc" },
      },
      attachments: {
        select: { id: true, fileName: true, fileUrl: true, contentType: true, sizeBytes: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      accessSessions: {
        select: { id: true, reason: true, createdAt: true, expiresAt: true, revokedAt: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
  if (!ticket) return Response.json({ error: "التذكرة غير موجودة" }, { status: 404 });
  return Response.json(ticket);
}

export async function PATCH(request: Request, context: RouteContext<"/api/admin/support-tickets/[id]">) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return Response.json({ error: "بيانات التحديث غير صالحة" }, { status: 422 });
  }

  const current = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, schoolId: true, status: true, firstRespondedAt: true },
  });
  if (!current) return Response.json({ error: "التذكرة غير موجودة" }, { status: 404 });
  if (parsed.data.assignedAdminId) {
    const exists = await prisma.superAdmin.count({ where: { id: parsed.data.assignedAdminId } });
    if (exists !== 1) return Response.json({ error: "مسؤول الدعم غير موجود" }, { status: 422 });
  }

  const now = new Date();
  const nextStatus = parsed.data.status ?? current.status;
  const firstRespondedAt = current.firstRespondedAt ?? (nextStatus !== "OPEN" ? now : null);
  const resolvedAt = ["RESOLVED", "CLOSED"].includes(nextStatus) ? now : null;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.supportTicket.update({
      where: { id },
      data: {
        ...parsed.data,
        firstRespondedAt,
        resolvedAt,
      },
      select: { id: true, status: true, priority: true, assignedAdminId: true, category: true, updatedAt: true },
    });
    await tx.adminActivityLog.create({
      data: {
        school_id: current.schoolId,
        action: "support_ticket_updated",
        performed_by: session.adminId,
        metadata: { ticketId: id, changedFields: Object.keys(parsed.data), status: result.status, priority: result.priority },
      },
    });
    return result;
  });

  return Response.json(updated, { headers: { "Cache-Control": "no-store" } });
}
