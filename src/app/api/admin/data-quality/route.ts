import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

type Severity = "HIGH" | "WARNING";
type Category = "STRUCTURE" | "ACCOUNTS" | "DELIVERY" | "FILES";

type CountRow = { schoolId: string; _count: { _all: number } };

const CHECKS: Record<
  string,
  { label: string; description: string; severity: Severity; category: Category }
> = {
  students_without_class: {
    label: "أطفال نشطون بلا فصل",
    description: "الطفل النشط يحتاج فصلًا حتى يعمل الحضور والتقويم والصلاحيات بصورة صحيحة.",
    severity: "HIGH",
    category: "STRUCTURE",
  },
  teachers_without_class: {
    label: "معلمون نشطون بلا فصل",
    description: "المعلم غير المرتبط بأي فصل لن يرى طلابًا أو أحداثًا خاصة بفصله.",
    severity: "WARNING",
    category: "STRUCTURE",
  },
  guardians_without_student: {
    label: "أولياء أمور بلا طفل مرتبط",
    description: "سجل ولي الأمر موجود لكنه غير مرتبط كولي أساسي أو إضافي بأي طفل.",
    severity: "HIGH",
    category: "STRUCTURE",
  },
  staff_accounts_not_activated: {
    label: "حسابات موظفين غير مفعلة",
    description: "حسابات غير معطلة لكنها لا تملك كلمة مرور بعد، لذلك لا يمكنها تسجيل الدخول.",
    severity: "WARNING",
    category: "ACCOUNTS",
  },
  guardian_accounts_not_activated: {
    label: "حسابات أولياء أمور غير مفعلة",
    description: "حسابات ولي أمر لم يكتمل إعداد كلمة المرور لها.",
    severity: "WARNING",
    category: "ACCOUNTS",
  },
  arrival_recipients_not_configured: {
    label: "إشعار الوصول بلا مستلمين محددين",
    description: "المنشأة لديها حسابات أولياء أمور مفعلة لكن لم تحدد موظفي استقبال إشعار الوصول.",
    severity: "HIGH",
    category: "DELIVERY",
  },
  arrival_notices_without_recipient: {
    label: "إشعارات وصول أُنشئت بلا مستلم",
    description: "إشعارات وصول محفوظة دون لقطة مستلمين، لذلك لم تصل لأي موظف داخل التطبيق.",
    severity: "HIGH",
    category: "DELIVERY",
  },
  inconsistent_care_batches: {
    label: "دفعات تقارير رعاية غير مكتملة البنية",
    description: "دفعات موحدة تفتقد بصمة الدفعة أو مفتاح العنصر اللازمين لمنع التكرار.",
    severity: "HIGH",
    category: "STRUCTURE",
  },
  overdue_care_reviews: {
    label: "تقارير رعاية معلقة لأكثر من 48 ساعة",
    description: "تقارير ما زالت بانتظار المراجعة وقد يتأخر وصولها لولي الأمر.",
    severity: "WARNING",
    category: "DELIVERY",
  },
  failed_device_tokens: {
    label: "أجهزة توقفت عن استقبال الإشعارات",
    description: "رموز أجهزة رفضها مزود الإشعارات رفضًا دائمًا وتحتاج إعادة تسجيل من التطبيق.",
    severity: "WARNING",
    category: "DELIVERY",
  },
  legacy_file_ownership: {
    label: "ملفات قديمة بلا تصنيف ملكية دقيق",
    description: "سجلات ملفات قديمة مصنفة Legacy ولا يمكن ربط دورة حذفها بمالك محدد بثقة.",
    severity: "WARNING",
    category: "FILES",
  },
  stalled_file_deletions: {
    label: "عمليات حذف ملفات متوقفة",
    description: "ملفات ظلت في حالة انتظار الحذف أكثر من 24 ساعة وتحتاج إعادة محاولة.",
    severity: "HIGH",
    category: "FILES",
  },
  storage_over_quota: {
    label: "تجاوز مساحة التخزين",
    description: "الاستخدام المحسوب تجاوز الحد المحدد في خطة المنشأة.",
    severity: "HIGH",
    category: "FILES",
  },
};

function toCountMap(rows: CountRow[]) {
  return new Map(rows.map((row) => [row.schoolId, row._count._all]));
}

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const checkedAt = new Date();
  const overdueReviewBefore = new Date(checkedAt.getTime() - 48 * 60 * 60 * 1000);
  const stalledDeleteBefore = new Date(checkedAt.getTime() - 24 * 60 * 60 * 1000);

  const [
    schools,
    studentsWithoutClass,
    teachersWithoutClass,
    guardiansWithoutStudent,
    staffAccountsNotActivated,
    guardianAccountsNotActivated,
    activatedGuardianAccounts,
    arrivalRecipientSettings,
    arrivalNoticesWithoutRecipient,
    inconsistentCareBatches,
    overdueCareReviews,
    failedDeviceTokens,
    legacyFileOwnership,
    stalledFileDeletions,
  ] = await Promise.all([
    prisma.school.findMany({
      select: {
        id: true,
        name: true,
        subscription_status: true,
        subscription_plan: { select: { max_storage_mb: true } },
        storage_usage: { select: { totalBytes: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.student.groupBy({
      by: ["schoolId"],
      where: { isActive: true, deletedAt: null, classId: null },
      _count: { _all: true },
    }),
    prisma.teacher.groupBy({
      by: ["schoolId"],
      where: {
        isActive: true,
        deletedAt: null,
        classes: { none: {} },
        classAssignments: { none: {} },
      },
      _count: { _all: true },
    }),
    prisma.guardian.groupBy({
      by: ["schoolId"],
      where: { deletedAt: null, students: { none: {} }, links: { none: {} } },
      _count: { _all: true },
    }),
    prisma.user.groupBy({
      by: ["schoolId"],
      where: { disabledAt: null, password: null },
      _count: { _all: true },
    }),
    prisma.guardianAccount.groupBy({
      by: ["schoolId"],
      where: { disabledAt: null, passwordHash: null },
      _count: { _all: true },
    }),
    prisma.guardianAccount.groupBy({
      by: ["schoolId"],
      where: { disabledAt: null, passwordHash: { not: null } },
      _count: { _all: true },
    }),
    prisma.arrivalRecipientSetting.groupBy({
      by: ["schoolId"],
      _count: { _all: true },
    }),
    prisma.arrivalNotice.groupBy({
      by: ["schoolId"],
      where: { recipients: { none: {} } },
      _count: { _all: true },
    }),
    prisma.careReport.groupBy({
      by: ["schoolId"],
      where: {
        deletedAt: null,
        dailyBatchId: { not: null },
        OR: [{ dailyBatchHash: null }, { dailyItemKey: null }],
      },
      _count: { _all: true },
    }),
    prisma.careReport.groupBy({
      by: ["schoolId"],
      where: {
        deletedAt: null,
        reviewStatus: "PENDING_REVIEW",
        createdAt: { lt: overdueReviewBefore },
      },
      _count: { _all: true },
    }),
    prisma.deviceToken.groupBy({
      by: ["schoolId"],
      where: { failedAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.storedFile.groupBy({
      by: ["schoolId"],
      where: { ownerType: "LEGACY", deletePendingAt: null },
      _count: { _all: true },
    }),
    prisma.storedFile.groupBy({
      by: ["schoolId"],
      where: { deletePendingAt: { lt: stalledDeleteBefore } },
      _count: { _all: true },
    }),
  ]);

  const issueMaps = new Map<string, Map<string, number>>([
    ["students_without_class", toCountMap(studentsWithoutClass)],
    ["teachers_without_class", toCountMap(teachersWithoutClass)],
    ["guardians_without_student", toCountMap(guardiansWithoutStudent)],
    ["staff_accounts_not_activated", toCountMap(staffAccountsNotActivated)],
    ["guardian_accounts_not_activated", toCountMap(guardianAccountsNotActivated)],
    ["arrival_notices_without_recipient", toCountMap(arrivalNoticesWithoutRecipient)],
    ["inconsistent_care_batches", toCountMap(inconsistentCareBatches)],
    ["overdue_care_reviews", toCountMap(overdueCareReviews)],
    ["failed_device_tokens", toCountMap(failedDeviceTokens)],
    ["legacy_file_ownership", toCountMap(legacyFileOwnership)],
    ["stalled_file_deletions", toCountMap(stalledFileDeletions)],
  ]);

  const activeGuardianMap = toCountMap(activatedGuardianAccounts);
  const recipientMap = toCountMap(arrivalRecipientSettings);
  issueMaps.set(
    "arrival_recipients_not_configured",
    new Map(
      schools
        .filter(
          (school) =>
            school.subscription_status !== "cancelled"
            && (activeGuardianMap.get(school.id) ?? 0) > 0
            && (recipientMap.get(school.id) ?? 0) === 0
        )
        .map((school) => [school.id, 1])
    )
  );

  issueMaps.set(
    "storage_over_quota",
    new Map(
      schools.flatMap((school) => {
        const quotaMb = school.subscription_plan?.max_storage_mb ?? 0;
        const totalBytes = school.storage_usage?.totalBytes ?? 0;
        if (quotaMb <= 0 || totalBytes <= quotaMb * 1024 * 1024) return [];
        return [[school.id, Math.ceil((totalBytes - quotaMb * 1024 * 1024) / (1024 * 1024))] as const];
      })
    )
  );

  const schoolRows = schools.map((school) => {
    const issues = Object.entries(CHECKS).flatMap(([key, definition]) => {
      const count = issueMaps.get(key)?.get(school.id) ?? 0;
      return count > 0 ? [{ key, count, severity: definition.severity, category: definition.category }] : [];
    });
    return {
      id: school.id,
      name: school.name,
      totalIssues: issues.reduce((sum, issue) => sum + issue.count, 0),
      highIssues: issues.filter((issue) => issue.severity === "HIGH").reduce((sum, issue) => sum + issue.count, 0),
      warnings: issues.filter((issue) => issue.severity === "WARNING").reduce((sum, issue) => sum + issue.count, 0),
      issues,
    };
  });

  const checks = Object.entries(CHECKS).map(([key, definition]) => {
    const issueMap = issueMaps.get(key) ?? new Map<string, number>();
    return {
      key,
      ...definition,
      total: [...issueMap.values()].reduce((sum, count) => sum + count, 0),
      affectedSchools: [...issueMap.values()].filter((count) => count > 0).length,
    };
  });

  const affectedRows = schoolRows
    .filter((school) => school.totalIssues > 0)
    .sort((a, b) => b.highIssues - a.highIssues || b.totalIssues - a.totalIssues || a.name.localeCompare(b.name, "ar"));

  return Response.json(
    {
      checkedAt,
      summary: {
        totalIssues: checks.reduce((sum, check) => sum + check.total, 0),
        highIssues: checks.filter((check) => check.severity === "HIGH").reduce((sum, check) => sum + check.total, 0),
        warnings: checks.filter((check) => check.severity === "WARNING").reduce((sum, check) => sum + check.total, 0),
        affectedSchools: affectedRows.length,
        cleanSchools: Math.max(0, schools.length - affectedRows.length),
        schoolCount: schools.length,
      },
      checks,
      schools: affectedRows,
      privacy: {
        aggregateOnly: true,
        note: "لا يعرض الفحص أسماء الأطفال أو الموظفين أو بيانات التواصل أو المعلومات الصحية.",
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
