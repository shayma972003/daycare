import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { IMAGE_LABEL, IMAGE_TYPES, MAX_IMAGE_BYTES, isFailure, storeUpload } from "@/lib/file-upload";
import { STORED_FILE_OWNER } from "@/lib/stored-file-ownership";
import { discardStoredFile } from "@/lib/stored-files";

export async function POST(request: Request, context: RouteContext<"/api/admin/support-tickets/[id]/attachments">) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, schoolId: true, reference: true },
  });
  if (!ticket) return Response.json({ error: "التذكرة غير موجودة" }, { status: 404 });
  if (!ticket.schoolId) return Response.json({ error: "لا يمكن رفع مرفق بعد حذف المنشأة" }, { status: 409 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return Response.json({ error: "الصورة مطلوبة" }, { status: 400 });

  const stored = await storeUpload(ticket.schoolId, file, {
    allowed: IMAGE_TYPES,
    maxBytes: MAX_IMAGE_BYTES,
    humanLabel: IMAGE_LABEL,
    category: "support",
    ownerId: ticket.id,
    ownerType: STORED_FILE_OWNER.SUPPORT_TICKET,
  });
  if (isFailure(stored)) return Response.json({ error: stored.error }, { status: stored.status });

  try {
    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.supportTicketAttachment.create({
        data: {
          ticketId: ticket.id,
          uploadedByAdminId: session.adminId,
          fileName: file.name.slice(0, 200),
          fileUrl: stored.url,
          contentType: stored.mime,
          sizeBytes: stored.sizeBytes,
        },
        select: { id: true, fileName: true, fileUrl: true, contentType: true, sizeBytes: true, createdAt: true },
      });
      await tx.adminActivityLog.create({
        data: {
          school_id: ticket.schoolId,
          action: "support_ticket_attachment_added",
          performed_by: session.adminId,
          metadata: { ticketId: ticket.id, attachmentId: created.id, contentType: created.contentType, sizeBytes: created.sizeBytes },
        },
      });
      return created;
    });
    return Response.json(attachment, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await discardStoredFile(stored.url);
    throw error;
  }
}
