import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { schoolSubscriptionAccess, schoolSubscriptionType } from "@/lib/school-subscription";

function pushFailureLabel(error: string | null): string | null {
  if (!error) return null;
  const value = error.toLowerCase();
  if (value.includes("not registered") || value.includes("unregistered") || value.includes("invalid token")) {
    return "رمز الجهاز غير صالح أو أُلغي تسجيله";
  }
  if (value.includes("credential") || value.includes("authentication") || value.includes("unauthorized")) {
    return "تعذر التحقق من بيانات مزود الإشعارات";
  }
  if (value.includes("timeout") || value.includes("network") || value.includes("fetch")) {
    return "تعذر الاتصال بمزود الإشعارات";
  }
  return "فشل لدى مزود الإشعارات";
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return null;
  return `${local.slice(0, 2)}***@${domain}`;
}

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
  const subscriptionAccess = schoolSubscriptionAccess(school);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    activityLogs,
    messages,
    staffAccounts,
    guardianAccounts,
    devices,
    pushByStatus,
    recentPushFailures,
    deliveryByStatus,
    recentDeliveries,
    settings,
    storageUsage,
    arrivalRecipientCount,
    pendingCareReportCount,
  ] = await Promise.all([
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
    prisma.user.findMany({
      where: { schoolId: id },
      select: {
        acceptedAt: true,
        disabledAt: true,
        inviteExpiresAt: true,
      },
    }),
    prisma.guardianAccount.findMany({
      where: { schoolId: id },
      select: {
        acceptedAt: true,
        disabledAt: true,
        inviteExpiresAt: true,
        lastLoginAt: true,
      },
    }),
    prisma.deviceToken.findMany({
      where: { schoolId: id },
      select: {
        id: true,
        platform: true,
        failedAt: true,
        lastSeenAt: true,
        createdAt: true,
        user: { select: { name: true, email: true, acceptedAt: true, disabledAt: true } },
        guardianAccount: {
          select: {
            email: true,
            acceptedAt: true,
            disabledAt: true,
            guardian: { select: { name: true } },
          },
        },
      },
      orderBy: { lastSeenAt: "desc" },
    }),
    prisma.pushNotification.groupBy({
      by: ["status"],
      where: { schoolId: id, createdAt: { gte: thirtyDaysAgo } },
      _count: { _all: true },
    }),
    prisma.pushNotification.findMany({
      where: { schoolId: id, status: "FAILED" },
      orderBy: { createdAt: "desc" },
      select: { id: true, lastError: true, createdAt: true, deviceTokenId: true },
      take: 10,
    }),
    prisma.notificationLog.groupBy({
      by: ["status"],
      where: { schoolId: id, sentAt: { gte: thirtyDaysAgo } },
      _count: { _all: true },
    }),
    prisma.notificationLog.findMany({
      where: { schoolId: id },
      orderBy: { sentAt: "desc" },
      select: { id: true, type: true, status: true, source: true, sentAt: true },
      take: 20,
    }),
    prisma.settings.findUnique({
      where: { schoolId: id },
      select: { careReportReviewRequired: true },
    }),
    prisma.storageUsage.findUnique({ where: { schoolId: id } }),
    prisma.arrivalRecipientSetting.count({ where: { schoolId: id } }),
    prisma.careReport.count({
      where: { schoolId: id, deletedAt: null, reviewStatus: "PENDING_REVIEW" },
    }),
  ]);

  const accountSummary = <T extends { acceptedAt: Date | null; disabledAt: Date | null; inviteExpiresAt: Date | null }>(accounts: T[]) => ({
    total: accounts.length,
    active: accounts.filter((account) => account.acceptedAt && !account.disabledAt).length,
    pending: accounts.filter((account) => !account.acceptedAt && !account.disabledAt).length,
    expiredInvitations: accounts.filter((account) => !account.acceptedAt && !account.disabledAt && account.inviteExpiresAt && account.inviteExpiresAt < new Date()).length,
    disabled: accounts.filter((account) => account.disabledAt).length,
  });

  const pushCounts = Object.fromEntries(pushByStatus.map((row) => [row.status, row._count._all]));
  const deliveryCounts = Object.fromEntries(deliveryByStatus.map((row) => [row.status, row._count._all]));
  const latestDeviceSeenAt = devices.reduce<Date | null>(
    (latest, device) => !latest || device.lastSeenAt > latest ? device.lastSeenAt : latest,
    null
  );
  const latestGuardianLoginAt = guardianAccounts.reduce<Date | null>(
    (latest, account) => account.lastLoginAt && (!latest || account.lastLoginAt > latest) ? account.lastLoginAt : latest,
    null
  );
  const maxStorageBytes = school.subscription_plan?.max_storage_mb
    ? school.subscription_plan.max_storage_mb * 1024 * 1024
    : null;

  return Response.json({
    school: {
      id: school.id,
      name: school.name,
      email: school.email,
      plan_id: school.plan_id,
      plan: school.subscription_plan,
      subscription_type: schoolSubscriptionType(school),
      subscription_status: subscriptionAccess.mode === "active" ? school.subscription_status : subscriptionAccess.reason,
      access_mode: subscriptionAccess.mode,
      renewal_date: subscriptionAccess.renewalDate,
      suspended_at: school.suspended_at,
      suspension_reason: school.suspension_reason,
      last_login_at: school.last_login_at,
      createdAt: school.createdAt,
      updatedAt: school.updatedAt,
      contactNumber: school.contactNumber,
      phoneNumber: school.phoneNumber,
      legalName: school.legalName,
      commercialRegistration: school.commercialRegistration,
      nationalUnifiedNumber: school.nationalUnifiedNumber,
      entityType: school.entityType,
      businessActivities: school.businessActivities,
      schoolType: school.schoolType,
      educationStages: school.educationStages,
      licenseNumber: school.licenseNumber,
      branch: school.branch,
      address: school.address,
      vatRegistered: school.vatRegistered,
      vatNumber: school.vatNumber,
      zatcaUnifiedNumber: school.zatcaUnifiedNumber,
      zakatStatus: school.zakatStatus,
      financialYear: school.financialYear,
      taxPeriod: school.taxPeriod,
    },
    stats: {
      students: school._count.students,
      teachers: school._count.teachers,
      classes: school._count.classes,
      invoices: school._count.invoices,
      notifications: school._count.notificationLogs,
    },
    support: {
      accounts: {
        staff: accountSummary(staffAccounts),
        guardians: accountSummary(guardianAccounts),
        latestGuardianLoginAt,
      },
      devices: {
        total: devices.length,
        healthy: devices.filter((device) => !device.failedAt).length,
        failed: devices.filter((device) => device.failedAt).length,
        expo: devices.filter((device) => device.platform === "EXPO").length,
        web: devices.filter((device) => device.platform === "WEB").length,
        lastSeenAt: latestDeviceSeenAt,
        items: devices.map((device) => {
          const owner = device.user ?? device.guardianAccount;
          return {
            id: device.id,
            ownerKind: device.user ? "staff" : "guardian",
            ownerName: device.user?.name ?? device.guardianAccount?.guardian.name ?? "حساب غير معروف",
            ownerEmail: maskEmail(owner?.email),
            platform: device.platform,
            status: device.failedAt ? "failed" : "healthy",
            lastSeenAt: device.lastSeenAt,
            registeredAt: device.createdAt,
            canTest: !device.failedAt && Boolean(owner?.acceptedAt) && !owner?.disabledAt,
          };
        }),
      },
      notifications: {
        windowDays: 30,
        push: {
          pending: pushCounts.PENDING ?? 0,
          sent: pushCounts.SENT ?? 0,
          failed: pushCounts.FAILED ?? 0,
          latestFailureAt: recentPushFailures[0]?.createdAt ?? null,
          latestFailure: pushFailureLabel(recentPushFailures[0]?.lastError ?? null),
          recentFailures: recentPushFailures.map((failure) => ({
            id: failure.id,
            deviceId: failure.deviceTokenId,
            occurredAt: failure.createdAt,
            reason: pushFailureLabel(failure.lastError),
          })),
        },
        outbound: {
          sent: deliveryCounts.SENT ?? 0,
          failed: deliveryCounts.FAILED ?? 0,
          recent: recentDeliveries.map((delivery) => ({
            id: delivery.id,
            type: delivery.type,
            status: delivery.status,
            source: delivery.source,
            sentAt: delivery.sentAt,
          })),
        },
      },
      storage: {
        totalBytes: storageUsage?.totalBytes ?? 0,
        maxBytes: maxStorageBytes,
        computedAt: storageUsage?.computedAt ?? null,
        breakdown: {
          studentFilesBytes: storageUsage?.studentFilesBytes ?? 0,
          careReportBytes: storageUsage?.careReportBytes ?? 0,
          staffFilesBytes: storageUsage?.staffFilesBytes ?? 0,
          unitFilesBytes: storageUsage?.unitFilesBytes ?? 0,
          invoiceBytes: storageUsage?.invoiceBytes ?? 0,
          otherBytes: storageUsage?.otherBytes ?? 0,
        },
      },
      configuration: {
        careReportReviewRequired: settings?.careReportReviewRequired ?? true,
        arrivalRecipientCount,
        pendingCareReportCount,
      },
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
  expectedUpdatedAt: z.iso.datetime(),
  name: z.string().min(1).optional(),
  email: z.string().email().nullish(),

  contactNumber: z.string().nullish(),
  phoneNumber: z.string().nullish(),
  legalName: z.string().nullish(),
  commercialRegistration: z.string().nullish(),
  nationalUnifiedNumber: z.string().nullish(),
  entityType: z.string().nullish(),
  businessActivities: z.string().nullish(),
  schoolType: z.string().nullish(),
  educationStages: z.array(z.string()).optional(),
  licenseNumber: z.string().nullish(),
  branch: z.string().nullish(),
  address: z.string().nullish(),
  vatRegistered: z.boolean().nullish(),
  vatNumber: z.string().nullish(),
  zatcaUnifiedNumber: z.string().nullish(),
  zakatStatus: z.enum(["yes", "no", "needs_review"]).nullish(),
  financialYear: z.string().nullish(),
  taxPeriod: z.string().nullish(),
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

  const { expectedUpdatedAt, ...data } = parsed.data;
  const updateData = {
    ...(data.name && { name: data.name }),
    ...(data.email !== undefined && { email: data.email }),
    ...(data.contactNumber !== undefined && { contactNumber: data.contactNumber }),
    ...(data.phoneNumber !== undefined && { phoneNumber: data.phoneNumber }),
    ...(data.legalName !== undefined && { legalName: data.legalName }),
    ...(data.commercialRegistration !== undefined && { commercialRegistration: data.commercialRegistration }),
    ...(data.nationalUnifiedNumber !== undefined && { nationalUnifiedNumber: data.nationalUnifiedNumber }),
    ...(data.entityType !== undefined && { entityType: data.entityType }),
    ...(data.businessActivities !== undefined && { businessActivities: data.businessActivities }),
    ...(data.schoolType !== undefined && { schoolType: data.schoolType }),
    ...(data.educationStages !== undefined && { educationStages: data.educationStages }),
    ...(data.licenseNumber !== undefined && { licenseNumber: data.licenseNumber }),
    ...(data.branch !== undefined && { branch: data.branch }),
    ...(data.address !== undefined && { address: data.address }),
    ...(data.vatRegistered !== undefined && { vatRegistered: data.vatRegistered }),
    ...(data.vatNumber !== undefined && { vatNumber: data.vatNumber }),
    ...(data.zatcaUnifiedNumber !== undefined && { zatcaUnifiedNumber: data.zatcaUnifiedNumber }),
    ...(data.zakatStatus !== undefined && { zakatStatus: data.zakatStatus }),
    ...(data.financialYear !== undefined && { financialYear: data.financialYear }),
    ...(data.taxPeriod !== undefined && { taxPeriod: data.taxPeriod }),
  };
  const claimed = await prisma.school.updateMany({
    where: { id, updatedAt: new Date(expectedUpdatedAt) },
    data: updateData,
  });
  if (claimed.count !== 1) {
    const exists = await prisma.school.findUnique({ where: { id }, select: { id: true } });
    return Response.json(exists
      ? { error: "تم تعديل بيانات المدرسة من جلسة أخرى. أعيدي تحميل الصفحة قبل الحفظ.", code: "STALE_RECORD" }
      : { error: "Not found" }, { status: exists ? 409 : 404 });
  }
  const school = await prisma.school.findUniqueOrThrow({ where: { id } });

  await prisma.adminActivityLog.create({
    data: {
      school_id: id,
      action: "school_updated",
      metadata: { changedFields: Object.keys(updateData) },
      performed_by: "super_admin",
    },
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

  // Deletion runs first and the audit entry is written only once it succeeds.
  // The previous order logged "school_deleted" before attempting the delete, so
  // a failure left the audit log asserting a deletion that never happened.
  //
  // Eight models with a non-nullable School FK were missing from this list —
  // PaymentCycle, ActivityLog, AdminInvoice, TwoFASession, Expense,
  // FinancialReport, EnrollmentToken and EnrollmentSubmission. Deleting any
  // school that had ever logged an action or recorded an expense raised a
  // foreign-key violation, which is to say: this route did not work.
  await prisma.$transaction([
    prisma.adminMessageRecipient.deleteMany({ where: { school_id: id } }),
    prisma.adminActivityLog.deleteMany({ where: { school_id: id } }),
    prisma.activityLog.deleteMany({ where: { school_id: id } }),
    prisma.exportAuditLog.deleteMany({ where: { schoolId: id } }),
    prisma.importRow.deleteMany({ where: { session: { school_id: id } } }),
    prisma.importSession.deleteMany({ where: { school_id: id } }),
    prisma.enrollmentSubmission.deleteMany({ where: { school_id: id } }),
    prisma.enrollmentToken.deleteMany({ where: { school_id: id } }),
    prisma.twoFASession.deleteMany({ where: { schoolId: id } }),
    prisma.attendance.deleteMany({ where: { schoolId: id } }),
    prisma.teacherAttendance.deleteMany({ where: { schoolId: id } }),
    prisma.paymentCycle.deleteMany({ where: { school_id: id } }),
    prisma.adminInvoice.deleteMany({ where: { school_id: id } }),
    prisma.invoice.deleteMany({ where: { schoolId: id } }),
    prisma.invoiceCounter.deleteMany({ where: { schoolId: id } }),
    prisma.notificationLog.deleteMany({ where: { schoolId: id } }),
    prisma.expense.deleteMany({ where: { school_id: id } }),
    prisma.financialReport.deleteMany({ where: { school_id: id } }),
    prisma.activityInvite.deleteMany({ where: { activity: { schoolId: id } } }),
    prisma.activity.deleteMany({ where: { schoolId: id } }),

    /**
     * Tables added after task 0.91 fixed this transaction the first time.
     *
     * Each one holds a hard `schoolId` foreign key with `ON DELETE RESTRICT`, so
     * a missing line here does not silently orphan rows — it makes the whole
     * delete throw, which is how the original eight omissions were found. The
     * order matters: anything pointing at Student, Guardian or Teacher has to go
     * before them.
     *
     * `StorageUsage` is absent on purpose — its FK cascades. So do `Lesson`,
     * `UnitFile`, `UnitClass`, `CalendarEventClass`, `StudentGuardian` and
     * `DeviceToken`, each through its own parent.
     */
    prisma.careReport.deleteMany({ where: { schoolId: id } }),
    prisma.shift.deleteMany({ where: { schoolId: id } }),
    prisma.calendarEvent.deleteMany({ where: { schoolId: id } }),
    prisma.unit.deleteMany({ where: { schoolId: id } }),
    prisma.guardianAccount.deleteMany({ where: { schoolId: id } }),
    // Before `user`: User.roleId is ON DELETE SET NULL, so roles may go first,
    // and doing so avoids leaving a dangling reference mid-transaction.
    prisma.role.deleteMany({ where: { schoolId: id } }),

    prisma.student.deleteMany({ where: { schoolId: id } }),
    prisma.guardian.deleteMany({ where: { schoolId: id } }),
    prisma.class.deleteMany({ where: { schoolId: id } }),
    prisma.teacher.deleteMany({ where: { schoolId: id } }),
    prisma.settings.deleteMany({ where: { schoolId: id } }),
    prisma.user.deleteMany({ where: { schoolId: id } }),
    prisma.school.delete({ where: { id } }),
  ]);

  await prisma.adminActivityLog.create({
    data: {
      action: "school_deleted",
      metadata: { schoolName: school.name, schoolId: id },
      performed_by: "admin",
    },
  });

  return Response.json({ success: true });
}
