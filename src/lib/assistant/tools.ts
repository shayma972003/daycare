import type { AuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { grants } from "@/lib/permissions";
import { calendarToday, DAY_MS, localDayBounds } from "@/lib/device-date";
import { subscriptionFilterWhere } from "@/lib/student-lifecycle";
import { PaymentStatus } from "@/lib/payment-status";
import {
  CareReportReviewStatus,
  ExpenseOccurrenceStatus,
  EmploymentStatus,
  StudentStatus,
} from "@/generated/prisma/enums";

export interface AssistantToolDefinition {
  type: "function";
  name: string;
  description: string;
  strict: true;
  parameters: {
    type: "object";
    properties: Record<string, never>;
    required: string[];
    additionalProperties: false;
  };
}

interface AssistantToolContext {
  session: AuthSession;
  now: Date;
  timeZone: string;
  /**
   * Set only after a future server-side confirmation flow validates a signed,
   * single-use approval. It is never populated from model arguments.
   */
  approvedWriteTool?: string;
}

export type AssistantToolEffect = "read" | "write";

interface RegisteredTool {
  definition: AssistantToolDefinition;
  effect: AssistantToolEffect;
  allowed: (session: AuthSession) => boolean;
  run: (context: AssistantToolContext) => Promise<Record<string, unknown>>;
}

const emptyParameters = {
  type: "object" as const,
  properties: {},
  required: [],
  additionalProperties: false as const,
};

function numberValue(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const REGISTERED_TOOLS: RegisteredTool[] = [
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_roster_summary",
      description: "Return aggregate counts for active students, their class assignment, active staff, and open classes. No names or contact details are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) =>
      grants(session.permissions, "students.view") ||
      grants(session.permissions, "staff.view") ||
      grants(session.permissions, "classes.view"),
    run: async ({ session }) => {
      const schoolId = session.user.schoolId;
      const canStudents = grants(session.permissions, "students.view");
      const canStaff = grants(session.permissions, "staff.view");
      const canClasses = grants(session.permissions, "classes.view");
      const activeStudentWhere = {
        schoolId,
        deletedAt: null,
        isActive: true,
        status: StudentStatus.ACTIVE,
      };
      const [students, studentsWithClass, studentsWithoutClass, staff, classes] = await Promise.all([
        canStudents
          ? prisma.student.count({ where: activeStudentWhere })
          : Promise.resolve(null),
        canStudents
          ? prisma.student.count({ where: { ...activeStudentWhere, classId: { not: null } } })
          : Promise.resolve(null),
        canStudents
          ? prisma.student.count({ where: { ...activeStudentWhere, classId: null } })
          : Promise.resolve(null),
        canStaff
          ? prisma.teacher.count({ where: { schoolId, deletedAt: null, isActive: true, status: EmploymentStatus.ACTIVE } })
          : Promise.resolve(null),
        canClasses
          ? prisma.class.count({ where: { schoolId, deletedAt: null, archivedAt: null } })
          : Promise.resolve(null),
      ]);

      return {
        students,
        studentsWithClass,
        studentsWithoutClass,
        staff,
        classes,
        scope: "aggregate_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_today_attendance_summary",
      description: "Return today's aggregate student attendance counts. No student records or names are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) =>
      grants(session.permissions, "students.view") &&
      grants(session.permissions, "attendance.students"),
    run: async ({ session, now, timeZone }) => {
      const schoolId = session.user.schoolId;
      const today = calendarToday(now, timeZone);
      const { start, end } = localDayBounds(now, timeZone);
      const [eligible, present, checkedOut] = await Promise.all([
        prisma.student.count({
          where: {
            schoolId,
            deletedAt: null,
            isActive: true,
            status: StudentStatus.ACTIVE,
            ...subscriptionFilterWhere("current", today),
          },
        }),
        prisma.attendance.count({
          where: { schoolId, checkinAt: { gte: start, lt: end } },
        }),
        prisma.attendance.count({
          where: { schoolId, checkinAt: { gte: start, lt: end }, checkoutAt: { not: null } },
        }),
      ]);

      return {
        eligible,
        present,
        absent: Math.max(0, eligible - present),
        checkedOut,
        scope: "aggregate_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_staff_attendance_summary",
      description: "Return today's aggregate staff attendance, checkout, and lateness counts. No staff identities are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) =>
      grants(session.permissions, "staff.view") &&
      grants(session.permissions, "attendance.staff"),
    run: async ({ session, now, timeZone }) => {
      const schoolId = session.user.schoolId;
      const { start, end } = localDayBounds(now, timeZone);
      const [eligible, present, checkedOut, late, lateMinutes] = await Promise.all([
        prisma.teacher.count({
          where: {
            schoolId,
            deletedAt: null,
            isActive: true,
            status: EmploymentStatus.ACTIVE,
          },
        }),
        prisma.teacherAttendance.count({
          where: { schoolId, checkinAt: { gte: start, lt: end } },
        }),
        prisma.teacherAttendance.count({
          where: {
            schoolId,
            checkinAt: { gte: start, lt: end },
            checkoutAt: { not: null },
          },
        }),
        prisma.teacherAttendance.count({
          where: {
            schoolId,
            checkinAt: { gte: start, lt: end },
            lateMinutes: { gt: 0 },
          },
        }),
        prisma.teacherAttendance.aggregate({
          where: { schoolId, checkinAt: { gte: start, lt: end } },
          _sum: { lateMinutes: true },
        }),
      ]);

      return {
        eligible,
        present,
        absent: Math.max(0, eligible - present),
        checkedOut,
        late,
        totalLateMinutes: lateMinutes._sum.lateMinutes ?? 0,
        scope: "aggregate_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_today_calendar_summary",
      description: "Return today's aggregate calendar event counts by type and timing. No titles, descriptions, or participant identities are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) => grants(session.permissions, "schedule.view"),
    run: async ({ session, now, timeZone }) => {
      const schoolId = session.user.schoolId;
      const { start, end } = localDayBounds(now, timeZone);
      const todayWhere = {
        schoolId,
        deletedAt: null,
        startAt: { lt: end },
        OR: [
          { endAt: { gt: start } },
          { endAt: null, startAt: { gte: start } },
        ],
      };
      const [byType, allDay] = await Promise.all([
        prisma.calendarEvent.groupBy({
          by: ["type"],
          where: todayWhere,
          _count: { _all: true },
        }),
        prisma.calendarEvent.count({ where: { ...todayWhere, allDay: true } }),
      ]);
      const countsByType = Object.fromEntries(
        byType.map((row) => [row.type, row._count._all])
      );
      const total = byType.reduce((sum, row) => sum + row._count._all, 0);

      return {
        total,
        allDay,
        timed: Math.max(0, total - allDay),
        countsByType,
        scope: "aggregate_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_care_report_attention_summary",
      description: "Return aggregate care report review counts, including reports awaiting review and returned for correction. No child or staff identities are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) => grants(session.permissions, "students.manage"),
    run: async ({ session, now, timeZone }) => {
      const schoolId = session.user.schoolId;
      const { start, end } = localDayBounds(now, timeZone);
      const [byStatus, approvedToday] = await Promise.all([
        prisma.careReport.groupBy({
          by: ["reviewStatus"],
          where: { schoolId, deletedAt: null },
          _count: { _all: true },
        }),
        prisma.careReport.count({
          where: {
            schoolId,
            deletedAt: null,
            reviewStatus: CareReportReviewStatus.APPROVED,
            reviewedAt: { gte: start, lt: end },
          },
        }),
      ]);
      const count = (status: CareReportReviewStatus) =>
        byStatus.find((row) => row.reviewStatus === status)?._count._all ?? 0;

      return {
        awaitingReview: count(CareReportReviewStatus.PENDING_REVIEW),
        returnedForCorrection: count(CareReportReviewStatus.REJECTED),
        approvedToday,
        scope: "aggregate_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_pending_enrollment_summary",
      description: "Return the aggregate number of enrollment submissions awaiting management review. No applicant details are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) =>
      grants(session.permissions, "students.manage") &&
      session.teacherClassIds === null,
    run: async ({ session }) => ({
      pendingReview: await prisma.enrollmentSubmission.count({
        where: {
          school_id: session.user.schoolId,
          status: "pending_review",
        },
      }),
      scope: "aggregate_only",
    }),
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_storage_summary",
      description: "Return the cached aggregate storage usage and quota. No file names, URLs, or contents are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) => grants(session.permissions, "settings.storage"),
    run: async ({ session }) => {
      const schoolId = session.user.schoolId;
      const [usage, school] = await Promise.all([
        prisma.storageUsage.findUnique({ where: { schoolId } }),
        prisma.school.findUnique({
          where: { id: schoolId },
          select: { subscription_plan: { select: { max_storage_mb: true } } },
        }),
      ]);
      if (!usage) {
        return { available: false, reason: "storage_cache_not_ready", scope: "aggregate_only" };
      }
      const quotaMb = school?.subscription_plan?.max_storage_mb ?? 0;
      const quotaBytes = quotaMb > 0 ? quotaMb * 1024 * 1024 : null;

      return {
        available: true,
        usedBytes: usage.totalBytes,
        quotaBytes,
        percentUsed: quotaBytes
          ? Math.min(100, Math.round((usage.totalBytes / quotaBytes) * 100))
          : null,
        overQuota: quotaBytes !== null && usage.totalBytes > quotaBytes,
        breakdown: {
          studentFilesBytes: usage.studentFilesBytes,
          careReportBytes: usage.careReportBytes,
          staffFilesBytes: usage.staffFilesBytes,
          unitFilesBytes: usage.unitFilesBytes,
          invoiceBytes: usage.invoiceBytes,
          otherBytes: usage.otherBytes,
        },
        computedAt: usage.computedAt,
        scope: "aggregate_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_finance_attention_summary",
      description: "Return aggregate counts of subscriptions and expense occurrences requiring attention. No payer or invoice identity is returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) => grants(session.permissions, "finance.view"),
    run: async ({ session, now, timeZone }) => {
      const schoolId = session.user.schoolId;
      const today = calendarToday(now, timeZone);
      const [unpaidSubscriptions, dueExpenses] = await Promise.all([
        prisma.student.count({
          where: {
            schoolId,
            deletedAt: null,
            isActive: true,
            status: StudentStatus.ACTIVE,
            paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.LATE] },
            ...subscriptionFilterWhere("current", today),
          },
        }),
        prisma.expenseOccurrence.count({
          where: {
            school_id: schoolId,
            status: ExpenseOccurrenceStatus.PENDING,
            due_date: { lte: today },
          },
        }),
      ]);

      return { unpaidSubscriptions, dueExpenses, scope: "aggregate_only" };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_finance_operations_summary",
      description: "Return aggregate invoice generation, expense settlement, and student payment-cycle counts and amounts. No payer, child, or staff identity is returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) => grants(session.permissions, "finance.view"),
    run: async ({ session, now, timeZone }) => {
      const schoolId = session.user.schoolId;
      const today = calendarToday(now, timeZone);
      const { start } = localDayBounds(now, timeZone);
      const since = new Date(start.getTime() - 29 * DAY_MS);
      const [invoiceGroups, expenseTemplates, expenseGroups, paidExpenses, cycleGroups] = await Promise.all([
        prisma.invoice.groupBy({
          by: ["type", "generationStatus"],
          where: { schoolId, createdAt: { gte: since } },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        prisma.expense.groupBy({
          by: ["type"],
          where: { school_id: schoolId, is_active: true },
          _count: { _all: true },
        }),
        prisma.expenseOccurrence.groupBy({
          by: ["status"],
          where: { school_id: schoolId, due_date: { lte: today } },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        prisma.expenseOccurrence.aggregate({
          where: { school_id: schoolId, status: "PAID", paid_at: { gte: since } },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        prisma.paymentCycle.groupBy({
          by: ["status"],
          where: { school_id: schoolId, due_date: { lte: today } },
          _count: { _all: true },
          _sum: { amount: true },
        }),
      ]);

      return {
        periodDays: 30,
        invoices: invoiceGroups.map((row) => ({
          type: row.type,
          status: row.generationStatus,
          count: row._count._all,
          amount: numberValue(row._sum.amount),
        })),
        activeExpenseTemplates: Object.fromEntries(
          expenseTemplates.map((row) => [row.type, row._count._all])
        ),
        dueExpenseOccurrences: expenseGroups.map((row) => ({
          status: row.status,
          count: row._count._all,
          amount: numberValue(row._sum.amount),
        })),
        paidExpensesInPeriod: {
          count: paidExpenses._count._all,
          amount: numberValue(paidExpenses._sum.amount),
        },
        studentPaymentCycles: cycleGroups.map((row) => ({
          status: row.status,
          count: row._count._all,
          amount: numberValue(row._sum.amount),
        })),
        scope: "aggregate_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_notification_delivery_summary",
      description: "Return aggregate notification delivery counts for the last 30 days by channel, source, and status. No recipient names or message content are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) => grants(session.permissions, "settings.manage"),
    run: async ({ session, now }) => {
      const since = new Date(now.getTime() - 30 * DAY_MS);
      const groups = await prisma.notificationLog.groupBy({
        by: ["type", "status", "source"],
        where: { schoolId: session.user.schoolId, sentAt: { gte: since } },
        _count: { _all: true },
      });
      return {
        periodDays: 30,
        total: groups.reduce((sum, row) => sum + row._count._all, 0),
        deliveries: groups.map((row) => ({
          channel: row.type,
          status: row.status,
          source: row.source,
          count: row._count._all,
        })),
        scope: "aggregate_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_trash_summary",
      description: "Return aggregate counts of deleted students, staff, and classes visible to the caller. No record names are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) =>
      grants(session.permissions, "students.view") ||
      grants(session.permissions, "staff.view") ||
      grants(session.permissions, "classes.view"),
    run: async ({ session }) => {
      const schoolId = session.user.schoolId;
      const [students, staff, classes] = await Promise.all([
        grants(session.permissions, "students.view")
          ? prisma.student.count({ where: { schoolId, deletedAt: { not: null } } })
          : Promise.resolve(null),
        grants(session.permissions, "staff.view")
          ? prisma.teacher.count({ where: { schoolId, deletedAt: { not: null } } })
          : Promise.resolve(null),
        grants(session.permissions, "classes.view")
          ? prisma.class.count({ where: { schoolId, deletedAt: { not: null } } })
          : Promise.resolve(null),
      ]);
      return { students, staff, classes, scope: "aggregate_only" };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_system_subscription_summary",
      description: "Return the school's current platform subscription status, renewal date, plan limits, and access state. No payment credentials are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) => grants(session.permissions, "settings.manage"),
    run: async ({ session }) => {
      const school = await prisma.school.findUnique({
        where: { id: session.user.schoolId },
        select: {
          subscription_status: true,
          renewal_date: true,
          subscription_plan: {
            select: {
              name: true,
              billing_interval: true,
              max_students: true,
              max_classes: true,
              max_storage_mb: true,
            },
          },
        },
      });
      return {
        status: school?.subscription_status ?? null,
        renewalDate: school?.renewal_date ?? null,
        plan: school?.subscription_plan ?? null,
        access: {
          mode: session.subscription.mode,
          reason: session.subscription.reason,
          daysUntilRenewal: session.subscription.daysUntilRenewal,
          graceDaysRemaining: session.subscription.graceDaysRemaining,
        },
        scope: "aggregate_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_configuration_readiness_summary",
      description: "Return whether key school profile, schedule, fee, stage, arrival-recipient, and care-report settings are configured. Contact values are never returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) => grants(session.permissions, "settings.manage"),
    run: async ({ session }) => {
      const schoolId = session.user.schoolId;
      const [school, settings, academicStages, arrivalRecipients] = await Promise.all([
        prisma.school.findUnique({
          where: { id: schoolId },
          select: {
            name: true,
            email: true,
            contactNumber: true,
            phoneNumber: true,
            address: true,
            commercialRegistration: true,
            teacherMorningCheckinTime: true,
            teacherMorningCheckoutTime: true,
            teacherEveningCheckinTime: true,
            teacherEveningCheckoutTime: true,
            studentMorningCheckinTime: true,
            studentMorningCheckoutTime: true,
            studentEveningCheckinTime: true,
            studentEveningCheckoutTime: true,
          },
        }),
        prisma.settings.findUnique({ where: { schoolId } }),
        prisma.academicStageOption.count({ where: { schoolId } }),
        prisma.arrivalRecipientSetting.count({ where: { schoolId } }),
      ]);
      const valuesPresent = (values: unknown[]) => values.every((value) => Boolean(value));
      return {
        profile: {
          identityConfigured: Boolean(school?.name && school?.commercialRegistration),
          contactConfigured: Boolean(school?.email && (school.contactNumber || school.phoneNumber)),
          addressConfigured: Boolean(school?.address),
        },
        schedules: {
          studentMorning: valuesPresent([school?.studentMorningCheckinTime, school?.studentMorningCheckoutTime]),
          studentEvening: valuesPresent([school?.studentEveningCheckinTime, school?.studentEveningCheckoutTime]),
          staffMorning: valuesPresent([school?.teacherMorningCheckinTime, school?.teacherMorningCheckoutTime]),
          staffEvening: valuesPresent([school?.teacherEveningCheckinTime, school?.teacherEveningCheckoutTime]),
        },
        fees: {
          configured: Boolean(settings && [
            settings.hourlyLateFee,
            settings.dailyStudentFee,
            settings.weeklyStudentFee,
            settings.monthlyStudentFee,
            settings.yearlyStudentFee,
          ].some((value) => numberValue(value) > 0)),
          careReportReviewRequired: settings?.careReportReviewRequired ?? true,
        },
        academicStages,
        arrivalRecipients,
        scope: "configuration_flags_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_recent_activity_summary",
      description: "Return aggregate administrative activity counts for today and the last seven days, grouped only by entity type. No names, IP addresses, or action text are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) => grants(session.permissions, "settings.manage"),
    run: async ({ session, now, timeZone }) => {
      const schoolId = session.user.schoolId;
      const { start } = localDayBounds(now, timeZone);
      const since = new Date(start.getTime() - 6 * DAY_MS);
      const [today, groups] = await Promise.all([
        prisma.activityLog.count({ where: { school_id: schoolId, created_at: { gte: start } } }),
        prisma.activityLog.groupBy({
          by: ["entity_type"],
          where: { school_id: schoolId, created_at: { gte: since } },
          _count: { _all: true },
        }),
      ]);
      return {
        today,
        lastSevenDays: groups.reduce((sum, row) => sum + row._count._all, 0),
        byEntityType: Object.fromEntries(
          groups.map((row) => [row.entity_type ?? "other", row._count._all])
        ),
        scope: "aggregate_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_class_capacity_summary",
      description: "Return aggregate open-class capacity, assignment, staffing, and over-capacity counts. No class, child, or teacher names are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) =>
      grants(session.permissions, "classes.view") && grants(session.permissions, "students.view"),
    run: async ({ session }) => {
      const schoolId = session.user.schoolId;
      const [classes, studentGroups] = await Promise.all([
        prisma.class.findMany({
          where: { schoolId, deletedAt: null, archivedAt: null },
          select: {
            id: true,
            capacity: true,
            teacherId: true,
            teacherAssignments: { select: { teacherId: true }, take: 1 },
          },
        }),
        prisma.student.groupBy({
          by: ["classId"],
          where: {
            schoolId,
            deletedAt: null,
            isActive: true,
            status: StudentStatus.ACTIVE,
            classId: { not: null },
          },
          _count: { _all: true },
        }),
      ]);
      const assignedByClass = new Map(studentGroups.map((row) => [row.classId, row._count._all]));
      const configured = classes.filter((entry) => entry.capacity !== null);
      return {
        openClasses: classes.length,
        classesWithoutCapacity: classes.length - configured.length,
        configuredCapacity: configured.reduce((sum, entry) => sum + (entry.capacity ?? 0), 0),
        assignedStudents: studentGroups.reduce((sum, row) => sum + row._count._all, 0),
        classesOverCapacity: configured.filter(
          (entry) => (assignedByClass.get(entry.id) ?? 0) > (entry.capacity ?? 0)
        ).length,
        classesWithoutTeacher: classes.filter(
          (entry) => entry.teacherId === null && entry.teacherAssignments.length === 0
        ).length,
        scope: "aggregate_only",
      };
    },
  },
  {
    effect: "read",
    definition: {
      type: "function",
      name: "get_staff_account_security_summary",
      description: "Return aggregate staff-login and role readiness counts. No account names, emails, invitation tokens, or credentials are returned.",
      strict: true,
      parameters: emptyParameters,
    },
    allowed: (session) =>
      grants(session.permissions, "settings.manage") && grants(session.permissions, "staff.view"),
    run: async ({ session }) => {
      const schoolId = session.user.schoolId;
      const [roles, accounts, disabled, pendingInvites, withoutRole, school] = await Promise.all([
        prisma.role.count({ where: { schoolId } }),
        prisma.user.count({ where: { schoolId } }),
        prisma.user.count({ where: { schoolId, disabledAt: { not: null } } }),
        prisma.user.count({ where: { schoolId, acceptedAt: null, inviteTokenHash: { not: null } } }),
        prisma.user.count({ where: { schoolId, roleId: null } }),
        prisma.school.findUnique({ where: { id: schoolId }, select: { twoFaEnabled: true } }),
      ]);
      return {
        roles,
        accounts,
        activeAccounts: Math.max(0, accounts - disabled),
        disabledAccounts: disabled,
        pendingInvites,
        accountsWithoutRole: withoutRole,
        schoolTwoFactorEnabled: school?.twoFaEnabled ?? false,
        scope: "aggregate_only",
      };
    },
  },
];

export function assistantToolDefinitions(session: AuthSession): AssistantToolDefinition[] {
  return REGISTERED_TOOLS.filter((tool) => tool.allowed(session)).map((tool) => tool.definition);
}

export function assistantToolCatalog(session: AuthSession) {
  return REGISTERED_TOOLS.filter((tool) => tool.allowed(session)).map((tool) => ({
    name: tool.definition.name,
    effect: tool.effect,
    confirmationRequired: tool.effect === "write",
  }));
}

export async function runAssistantTool(
  name: string,
  context: AssistantToolContext
): Promise<Record<string, unknown>> {
  const tool = REGISTERED_TOOLS.find((candidate) => candidate.definition.name === name);
  if (!tool || !tool.allowed(context.session)) {
    return { error: "tool_not_available" };
  }
  // A model can request an action but can never approve one. Only a separate
  // server-side confirmation flow may populate `approvedWriteTool`.
  if (tool.effect === "write" && context.approvedWriteTool !== name) {
    return { error: "confirmation_required", tool: name };
  }
  return tool.run(context);
}
