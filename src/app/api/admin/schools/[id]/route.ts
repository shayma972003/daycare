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
      contactNumber: school.contactNumber,
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

  contactNumber: z.string().nullish(),
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

  const data = parsed.data;
  const school = await prisma.school.update({
    where: { id },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.plan_id !== undefined && { plan_id: data.plan_id }),
      ...(data.renewal_date !== undefined && { renewal_date: data.renewal_date ? new Date(data.renewal_date) : null }),
      ...(data.subscription_status && { subscription_status: data.subscription_status }),
      ...(data.contactNumber !== undefined && { contactNumber: data.contactNumber }),
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
