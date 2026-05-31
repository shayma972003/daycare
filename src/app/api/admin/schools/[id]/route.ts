import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const school = await prisma.school.findUnique({
    where: { id },
    include: {
      subscription_plan: true,
      _count: {
        select: {
          students: { where: { isActive: true } },
          teachers: { where: { isActive: true } },
          classes: true,
          invoices: true,
          notificationLogs: true,
        },
      },
    },
  });

  if (!school) return Response.json({ error: "Not found" }, { status: 404 });

  const [activityLogs, messages] = await Promise.all([
    prisma.adminActivityLog.findMany({
      where: { school_id: id },
      orderBy: { performed_at: "desc" },
      take: 50,
    }),
    prisma.adminMessageRecipient.findMany({
      where: { school_id: id },
      include: { message: { select: { subject: true, sent_at: true, is_automated: true } } },
      orderBy: { message: { sent_at: "desc" } },
      take: 20,
    }),
  ]);

  return Response.json({
    school: {
      id: school.id,
      name: school.name,
      email: school.email,
      plan_id: school.plan_id,
      plan: school.subscription_plan,
      subscription_status: school.subscription_status,
      renewal_date: school.renewal_date,
      suspended_at: school.suspended_at,
      suspension_reason: school.suspension_reason,
      last_login_at: school.last_login_at,
      createdAt: school.createdAt,
    },
    stats: {
      students: school._count.students,
      teachers: school._count.teachers,
      classes: school._count.classes,
      invoices: school._count.invoices,
      notifications: school._count.notificationLogs,
    },
    activityLogs,
    messages: messages.map((r) => ({
      id: r.id,
      subject: r.message.subject,
      sent_at: r.message.sent_at,
      is_automated: r.message.is_automated,
      delivered_at: r.delivered_at,
      read_at: r.read_at,
    })),
  });
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullish(),
  plan_id: z.string().nullish(),
  renewal_date: z.string().nullish(),
  subscription_status: z.string().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });

  const data = parsed.data;
  const school = await prisma.school.update({
    where: { id },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.plan_id !== undefined && { plan_id: data.plan_id }),
      ...(data.renewal_date !== undefined && { renewal_date: data.renewal_date ? new Date(data.renewal_date) : null }),
      ...(data.subscription_status && { subscription_status: data.subscription_status }),
    },
  });

  await prisma.adminActivityLog.create({
    data: { school_id: id, action: "plan_changed", metadata: data, performed_by: "admin" },
  });

  return Response.json(school);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const school = await prisma.school.findUnique({ where: { id } });
  if (!school) return Response.json({ error: "Not found" }, { status: 404 });

  // Log before deletion
  await prisma.adminActivityLog.create({
    data: { action: "school_deleted", metadata: { schoolName: school.name, schoolId: id }, performed_by: "admin" },
  });

  // Delete in dependency order
  await prisma.$transaction([
    prisma.adminMessageRecipient.deleteMany({ where: { school_id: id } }),
    prisma.adminActivityLog.deleteMany({ where: { school_id: id } }),
    prisma.importRow.deleteMany({ where: { session: { school_id: id } } }),
    prisma.importSession.deleteMany({ where: { school_id: id } }),
    prisma.attendance.deleteMany({ where: { schoolId: id } }),
    prisma.teacherAttendance.deleteMany({ where: { schoolId: id } }),
    prisma.invoice.deleteMany({ where: { schoolId: id } }),
    prisma.notificationLog.deleteMany({ where: { schoolId: id } }),
    prisma.monthlyExpense.deleteMany({ where: { schoolId: id } }),
    prisma.activityInvite.deleteMany({ where: { activity: { schoolId: id } } }),
    prisma.activity.deleteMany({ where: { schoolId: id } }),
    prisma.student.deleteMany({ where: { schoolId: id } }),
    prisma.guardian.deleteMany({ where: { schoolId: id } }),
    prisma.class.deleteMany({ where: { schoolId: id } }),
    prisma.teacher.deleteMany({ where: { schoolId: id } }),
    prisma.settings.deleteMany({ where: { schoolId: id } }),
    prisma.user.deleteMany({ where: { schoolId: id } }),
    prisma.school.delete({ where: { id } }),
  ]);

  return Response.json({ success: true });
}
