import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const recipients = await prisma.adminMessageRecipient.findMany({
    where: { school_id: schoolId },
    include: { message: { select: { id: true, subject: true, body: true, sent_at: true } } },
    orderBy: { message: { sent_at: "desc" } },
    take: 20,
  });

  const unreadCount = await prisma.adminMessageRecipient.count({
    where: { school_id: schoolId, read_at: null, delivered_at: { not: null } },
  });

  return Response.json({
    unreadCount,
    messages: recipients.map((r) => ({
      recipientId: r.id,
      messageId: r.message.id,
      subject: r.message.subject,
      preview: r.message.body.substring(0, 100),
      sent_at: r.message.sent_at,
      read_at: r.read_at,
    })),
  });
}

export async function PATCH(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { recipientId } = body as { recipientId?: string };
  if (recipientId) {
    const recipient = await prisma.adminMessageRecipient.findFirst({
      where: { id: recipientId, school_id: schoolId },
      include: { message: { select: { subject: true } } },
    });
    await prisma.adminMessageRecipient.updateMany({
      where: { id: recipientId, school_id: schoolId },
      data: { read_at: new Date() },
    });
    await logAction({
      school_id: schoolId,
      action: `فتح إشعار إداري: ${recipient?.message.subject ?? ""}`,
      entity_type: "notification",
      entity_id: recipientId,
      performed_by: session.user.name ?? "المدير",
      request,
    });
  } else {
    // Mark all as read
    await prisma.adminMessageRecipient.updateMany({
      where: { school_id: schoolId, read_at: null },
      data: { read_at: new Date() },
    });
    await logAction({
      school_id: schoolId,
      action: "تحديد جميع الإشعارات الإدارية كمقروءة",
      entity_type: "notification",
      performed_by: session.user.name ?? "المدير",
      request,
    });
  }

  return Response.json({ success: true });
}
