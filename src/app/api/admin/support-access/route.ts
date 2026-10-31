import { z } from "zod";
import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  schoolId: z.string().min(1),
  ticketId: z.string().min(1).optional(),
  reason: z.string().trim().min(10).max(500),
  durationMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
});

export async function POST(request: Request) {
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

  const [school, ticket] = await Promise.all([
    prisma.school.findUnique({ where: { id: parsed.data.schoolId }, select: { id: true, name: true } }),
    parsed.data.ticketId
      ? prisma.supportTicket.findFirst({
          where: { id: parsed.data.ticketId, schoolId: parsed.data.schoolId },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  if (!school) return Response.json({ error: "المنشأة غير موجودة" }, { status: 404 });
  if (parsed.data.ticketId && !ticket) return Response.json({ error: "التذكرة لا تتبع المنشأة" }, { status: 422 });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + parsed.data.durationMinutes * 60 * 1000);
  const access = await prisma.$transaction(async (tx) => {
    // One active context per administrator prevents an old support window from
    // remaining valid while a different tenant is being investigated.
    await tx.supportAccessSession.updateMany({
      where: { createdByAdminId: admin.adminId, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    const created = await tx.supportAccessSession.create({
      data: {
        schoolId: school.id,
        ticketId: ticket?.id ?? null,
        createdByAdminId: admin.adminId,
        reason: parsed.data.reason,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });
    await tx.adminActivityLog.create({
      data: {
        school_id: school.id,
        action: "support_access_started",
        performed_by: admin.adminId,
        metadata: { accessSessionId: created.id, ticketId: ticket?.id ?? null, durationMinutes: parsed.data.durationMinutes, reason: parsed.data.reason },
      },
    });
    return created;
  });

  return Response.json(access, { status: 201, headers: { "Cache-Control": "no-store" } });
}
