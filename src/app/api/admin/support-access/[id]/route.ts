import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

async function loadAccess(id: string, adminId: string) {
  return prisma.supportAccessSession.findFirst({
    where: { id, createdByAdminId: adminId },
    select: {
      id: true,
      reason: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      ticket: { select: { id: true, reference: true, title: true } },
      school: {
        select: {
          id: true,
          name: true,
          plan: true,
          subscription_status: true,
          renewal_date: true,
          last_login_at: true,
          settings: { select: { careReportReviewRequired: true } },
        },
      },
    },
  });
}

export async function GET(request: Request, context: RouteContext<"/api/admin/support-access/[id]">) {
  const admin = await verifyAdminSessionFromRequest(request);
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const access = await loadAccess(id, admin.adminId);
  if (!access) return Response.json({ error: "جلسة الدعم غير موجودة" }, { status: 404 });
  const now = new Date();
  if (access.revokedAt || access.expiresAt <= now) {
    return Response.json({ error: "انتهت جلسة الدعم", expired: true }, { status: 410 });
  }

  const schoolId = access.school.id;
  const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [
    activeStudents,
    activeTeachers,
    activeClasses,
    activeGuardians,
    staffTotal,
    staffDisabled,
    staffPending,
    devices,
    failedDevices,
    pendingCareReports,
    arrivalRecipients,
    failedPush,
    recentLogs,
  ] = await Promise.all([
    prisma.student.count({ where: { schoolId, isActive: true, deletedAt: null } }),
    prisma.teacher.count({ where: { schoolId, isActive: true, deletedAt: null } }),
    prisma.class.count({ where: { schoolId, archivedAt: null, deletedAt: null } }),
    prisma.guardianAccount.count({ where: { schoolId, acceptedAt: { not: null }, disabledAt: null } }),
    prisma.user.count({ where: { schoolId } }),
    prisma.user.count({ where: { schoolId, disabledAt: { not: null } } }),
    prisma.user.count({ where: { schoolId, acceptedAt: null } }),
    prisma.deviceToken.count({ where: { schoolId } }),
    prisma.deviceToken.count({ where: { schoolId, failedAt: { not: null } } }),
    prisma.careReport.count({ where: { schoolId, deletedAt: null, reviewStatus: "PENDING_REVIEW" } }),
    prisma.arrivalRecipientSetting.count({ where: { schoolId } }),
    prisma.pushNotification.count({ where: { schoolId, status: "FAILED", createdAt: { gte: periodStart } } }),
    prisma.adminActivityLog.findMany({
      where: { school_id: schoolId },
      select: { id: true, action: true, performed_by: true, performed_at: true },
      orderBy: { performed_at: "desc" },
      take: 12,
    }),
  ]);

  await prisma.supportAccessSession.updateMany({
    where: { id: access.id, createdByAdminId: admin.adminId, revokedAt: null, expiresAt: { gt: now } },
    data: { lastViewedAt: now },
  });

  return Response.json({
    access: { id: access.id, reason: access.reason, createdAt: access.createdAt, expiresAt: access.expiresAt, ticket: access.ticket },
    school: access.school,
    summary: {
      activeStudents,
      activeTeachers,
      activeClasses,
      activeGuardians,
      staff: { total: staffTotal, disabled: staffDisabled, pending: staffPending },
      devices: { total: devices, failed: failedDevices },
      pendingCareReports,
      arrivalRecipients,
      failedPushLast30Days: failedPush,
    },
    recentLogs,
    restrictions: {
      readOnly: true,
      sensitiveHealthHidden: true,
      personalRecordsHidden: true,
      writesAllowed: false,
    },
  });
}

export async function PATCH(request: Request, context: RouteContext<"/api/admin/support-access/[id]">) {
  const admin = await verifyAdminSessionFromRequest(request);
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const now = new Date();
  const current = await prisma.supportAccessSession.findFirst({
    where: { id, createdByAdminId: admin.adminId },
    select: { id: true, schoolId: true, ticketId: true, revokedAt: true },
  });
  if (!current) return Response.json({ error: "جلسة الدعم غير موجودة" }, { status: 404 });
  if (current.revokedAt) return Response.json({ success: true, alreadyEnded: true });

  await prisma.$transaction(async (tx) => {
    await tx.supportAccessSession.update({ where: { id }, data: { revokedAt: now } });
    await tx.adminActivityLog.create({
      data: {
        school_id: current.schoolId,
        action: "support_access_ended",
        performed_by: admin.adminId,
        metadata: { accessSessionId: id, ticketId: current.ticketId },
      },
    });
  });
  return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
