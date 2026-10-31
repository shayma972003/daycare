import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { isSupportPreviewView, type SupportPreviewView } from "@/lib/support-access";

type Metric = {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning" | "danger";
};

type Section = {
  title: string;
  description?: string;
  metrics: Metric[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

const CALENDAR_TYPE_LABELS: Record<string, string> = {
  LESSON: "دروس",
  ACTIVITY: "أنشطة",
  ANNOUNCEMENT: "إعلانات",
  UNIT: "وحدات تعليمية",
};

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(value ?? 0);
}

async function loadPreview(view: SupportPreviewView, schoolId: string, now: Date): Promise<Section[]> {
  if (view === "overview") {
    const [students, teachers, classes, guardians, pendingCareReports] = await Promise.all([
      prisma.student.count({ where: { schoolId, isActive: true, deletedAt: null } }),
      prisma.teacher.count({ where: { schoolId, isActive: true, deletedAt: null } }),
      prisma.class.count({ where: { schoolId, archivedAt: null, deletedAt: null } }),
      prisma.guardianAccount.count({ where: { schoolId, acceptedAt: { not: null }, disabledAt: null } }),
      prisma.careReport.count({ where: { schoolId, deletedAt: null, reviewStatus: "PENDING_REVIEW" } }),
    ]);
    return [{
      title: "ملخص المنشأة",
      description: "أعداد مجمعة فقط، بدون أسماء أو ملفات شخصية.",
      metrics: [
        { label: "الأطفال النشطون", value: students },
        { label: "المعلمون النشطون", value: teachers },
        { label: "الفصول النشطة", value: classes },
        { label: "حسابات أولياء الأمور", value: guardians },
        { label: "تقارير تنتظر المراجعة", value: pendingCareReports, tone: pendingCareReports > 0 ? "warning" : "success" },
      ],
    }];
  }

  if (view === "attendance") {
    const periodStart = new Date(now.getTime() - 6 * DAY_MS);
    periodStart.setUTCHours(0, 0, 0, 0);
    const rows = await prisma.attendance.groupBy({
      by: ["status"],
      where: { schoolId, date: { gte: periodStart } },
      _count: { _all: true },
    });
    const counts = new Map(rows.map((row) => [row.status, row._count._all]));
    return [{
      title: "الحضور خلال آخر 7 أيام",
      description: "إجماليات الحالات فقط؛ لا تظهر أسماء الأطفال أو ملاحظات الغياب.",
      metrics: [
        { label: "حضور", value: counts.get("PRESENT") ?? 0, tone: "success" },
        { label: "غياب", value: counts.get("ABSENT") ?? 0, tone: "danger" },
        { label: "إجازة", value: counts.get("LEAVE") ?? 0, tone: "warning" },
        { label: "تم تسجيل الخروج", value: counts.get("CHECKED_OUT") ?? 0 },
        { label: "دون تسجيل", value: counts.get("NO_RECORD") ?? 0, tone: "warning" },
      ],
    }];
  }

  if (view === "calendar") {
    const periodEnd = new Date(now.getTime() + 30 * DAY_MS);
    const rows = await prisma.calendarEvent.groupBy({
      by: ["type"],
      where: { schoolId, deletedAt: null, startAt: { gte: now, lte: periodEnd } },
      _count: { _all: true },
    });
    return [{
      title: "التقويم خلال 30 يومًا",
      description: "يعرض عدد الأحداث حسب النوع بدون العنوان أو الوصف أو المكان.",
      metrics: rows.length > 0
        ? rows.map((row) => ({ label: CALENDAR_TYPE_LABELS[row.type] ?? row.type, value: row._count._all }))
        : [{ label: "الأحداث القادمة", value: 0 }],
    }];
  }

  if (view === "finance") {
    const periodStart = new Date(now.getTime() - 30 * DAY_MS);
    const [invoices, expenses] = await Promise.all([
      prisma.invoice.aggregate({
        where: { schoolId, createdAt: { gte: periodStart } },
        _count: { _all: true },
        _sum: { amount: true, vat_amount: true },
      }),
      prisma.expense.aggregate({
        where: { school_id: schoolId, is_active: true },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
    return [{
      title: "المؤشرات المالية",
      description: "إجماليات فقط؛ لا تظهر أسماء الأطفال أو الموظفين أو تفاصيل الفواتير.",
      metrics: [
        { label: "فواتير آخر 30 يومًا", value: invoices._count._all },
        { label: "إجمالي الفواتير", value: `${numberValue(invoices._sum.amount).toFixed(2)} ر.س` },
        { label: "إجمالي الضريبة", value: `${numberValue(invoices._sum.vat_amount).toFixed(2)} ر.س` },
        { label: "المصروفات النشطة", value: expenses._count._all },
        { label: "قيمة المصروفات النشطة", value: `${numberValue(expenses._sum.amount).toFixed(2)} ر.س` },
      ],
    }];
  }

  if (view === "accounts") {
    const [staffTotal, staffDisabled, staffPending, guardiansTotal, guardiansDisabled, devices, failedDevices] = await Promise.all([
      prisma.user.count({ where: { schoolId } }),
      prisma.user.count({ where: { schoolId, disabledAt: { not: null } } }),
      prisma.user.count({ where: { schoolId, acceptedAt: null } }),
      prisma.guardianAccount.count({ where: { schoolId } }),
      prisma.guardianAccount.count({ where: { schoolId, disabledAt: { not: null } } }),
      prisma.deviceToken.count({ where: { schoolId } }),
      prisma.deviceToken.count({ where: { schoolId, failedAt: { not: null } } }),
    ]);
    return [{
      title: "الحسابات والأجهزة",
      description: "حالة تقنية مجمعة بدون بريد أو جوال أو رموز أجهزة.",
      metrics: [
        { label: "حسابات الموظفين", value: staffTotal },
        { label: "دعوات موظفين غير مكتملة", value: staffPending, tone: staffPending > 0 ? "warning" : "success" },
        { label: "حسابات موظفين معطلة", value: staffDisabled, tone: staffDisabled > 0 ? "danger" : "success" },
        { label: "حسابات أولياء الأمور", value: guardiansTotal },
        { label: "حسابات أولياء أمور معطلة", value: guardiansDisabled, tone: guardiansDisabled > 0 ? "danger" : "success" },
        { label: "الأجهزة المسجلة", value: devices },
        { label: "أجهزة متوقفة", value: failedDevices, tone: failedDevices > 0 ? "danger" : "success" },
      ],
    }];
  }

  const [school, settings, arrivalRecipients] = await Promise.all([
    prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        teacherMorningCheckinTime: true,
        teacherMorningCheckoutTime: true,
        teacherEveningCheckinTime: true,
        teacherEveningCheckoutTime: true,
      },
    }),
    prisma.settings.findUnique({ where: { schoolId }, select: { careReportReviewRequired: true } }),
    prisma.arrivalRecipientSetting.count({ where: { schoolId } }),
  ]);
  return [{
    title: "إعدادات التشغيل",
    description: "قيم تشغيلية غير شخصية فقط.",
    metrics: [
      { label: "مراجعة تقارير الرعاية", value: settings?.careReportReviewRequired === false ? "إرسال مباشر" : "تتطلب مراجعة" },
      { label: "مستلمو إشعار الوصول", value: arrivalRecipients },
      { label: "بداية الدوام الصباحي", value: school?.teacherMorningCheckinTime ?? "غير محدد" },
      { label: "نهاية الدوام الصباحي", value: school?.teacherMorningCheckoutTime ?? "غير محدد" },
      { label: "بداية الدوام المسائي", value: school?.teacherEveningCheckinTime ?? "غير محدد" },
      { label: "نهاية الدوام المسائي", value: school?.teacherEveningCheckoutTime ?? "غير محدد" },
    ],
  }];
}

export async function GET(request: Request, context: RouteContext<"/api/admin/support-access/[id]/preview">) {
  const admin = await verifyAdminSessionFromRequest(request);
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const view = new URL(request.url).searchParams.get("view");
  if (!isSupportPreviewView(view)) return Response.json({ error: "قسم المعاينة غير صالح" }, { status: 422 });

  const access = await prisma.supportAccessSession.findFirst({
    where: { id, createdByAdminId: admin.adminId },
    select: { id: true, schoolId: true, ticketId: true, expiresAt: true, revokedAt: true },
  });
  if (!access) return Response.json({ error: "جلسة الدعم غير موجودة" }, { status: 404 });
  const now = new Date();
  if (access.revokedAt || access.expiresAt <= now) return Response.json({ error: "انتهت جلسة الدعم", expired: true }, { status: 410 });

  const sections = await loadPreview(view, access.schoolId, now);
  const auditedAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const active = await tx.supportAccessSession.updateMany({
        where: { id: access.id, createdByAdminId: admin.adminId, revokedAt: null, expiresAt: { gt: auditedAt } },
        data: { lastViewedAt: auditedAt },
      });
      if (active.count !== 1) throw new Error("SUPPORT_SESSION_EXPIRED");
      await tx.adminActivityLog.create({
        data: {
          school_id: access.schoolId,
          action: "support_preview_page_viewed",
          performed_by: admin.adminId,
          metadata: { accessSessionId: access.id, ticketId: access.ticketId, view },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPORT_SESSION_EXPIRED") {
      return Response.json({ error: "انتهت جلسة الدعم", expired: true }, { status: 410 });
    }
    throw error;
  }

  return Response.json({ view, auditedAt, sections }, { headers: { "Cache-Control": "no-store" } });
}
