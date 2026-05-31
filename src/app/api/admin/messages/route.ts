import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const messages = await prisma.adminMessage.findMany({
    orderBy: { created_at: "desc" },
    take: 50,
    include: {
      _count: { select: { recipients: true } },
      recipients: { where: { delivered_at: { not: null } }, select: { id: true } },
    },
  });

  return Response.json(
    messages.map((m) => ({
      id: m.id,
      subject: m.subject,
      target_type: m.target_type,
      sent_at: m.sent_at,
      scheduled_at: m.scheduled_at,
      is_automated: m.is_automated,
      recipientCount: m._count.recipients,
      deliveredCount: m.recipients.length,
    }))
  );
}

const sendSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  target_type: z.enum(["all", "specific", "by_status"]),
  school_ids: z.array(z.string()).optional(),
  status_filter: z.string().optional(),
  scheduled_at: z.string().nullish(),
});

export async function POST(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });

  const { subject, body: msgBody, target_type, school_ids, status_filter, scheduled_at } = parsed.data;

  let targetSchools: { id: string; name: string; email: string | null }[] = [];
  if (target_type === "all") {
    targetSchools = await prisma.school.findMany({ select: { id: true, name: true, email: true } });
  } else if (target_type === "specific" && school_ids?.length) {
    targetSchools = await prisma.school.findMany({
      where: { id: { in: school_ids } },
      select: { id: true, name: true, email: true },
    });
  } else if (target_type === "by_status" && status_filter) {
    targetSchools = await prisma.school.findMany({
      where: { subscription_status: status_filter },
      select: { id: true, name: true, email: true },
    });
  }

  const isScheduled = !!scheduled_at;
  const sentAt = isScheduled ? null : new Date();

  const message = await prisma.adminMessage.create({
    data: {
      subject,
      body: msgBody,
      target_type,
      scheduled_at: isScheduled ? new Date(scheduled_at!) : null,
      sent_at: sentAt,
      recipients: {
        create: targetSchools.map((s) => ({
          school_id: s.id,
          delivered_at: isScheduled ? null : new Date(),
        })),
      },
    },
  });

  await prisma.adminActivityLog.create({
    data: {
      action: "message_sent",
      metadata: { subject, target_type, recipientCount: targetSchools.length },
      performed_by: "admin",
    },
  });

  return Response.json({ id: message.id, recipientCount: targetSchools.length }, { status: 201 });
}
