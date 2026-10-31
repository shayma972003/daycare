import { z } from "zod";
import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ body: z.string().trim().min(2).max(3000) });

export async function POST(request: Request, context: RouteContext<"/api/admin/support-tickets/[id]/notes">) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "الملاحظة غير صالحة" }, { status: 422 });

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, schoolId: true, status: true, firstRespondedAt: true },
  });
  if (!ticket) return Response.json({ error: "التذكرة غير موجودة" }, { status: 404 });

  const now = new Date();
  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicketNote.create({
      data: { ticketId: id, authorAdminId: session.adminId, body: parsed.data.body, isInternal: true },
      select: { id: true, body: true, isInternal: true, createdAt: true },
    });
    await tx.supportTicket.update({
      where: { id },
      data: {
        firstRespondedAt: ticket.firstRespondedAt ?? now,
        ...(ticket.status === "OPEN" ? { status: "IN_PROGRESS" } : {}),
      },
    });
    await tx.adminActivityLog.create({
      data: {
        school_id: ticket.schoolId,
        action: "support_ticket_note_added",
        performed_by: session.adminId,
        metadata: { ticketId: id, noteId: created.id },
      },
    });
    return created;
  });
  return Response.json(note, { status: 201, headers: { "Cache-Control": "no-store" } });
}
