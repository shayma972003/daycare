import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

const PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type CountRow = { schoolId: string; _count: { _all: number } };
type AggregateCountRow = { schoolId: string; count: number };

function countMap(rows: CountRow[]) {
  return new Map(rows.map((row) => [row.schoolId, row._count._all]));
}

function aggregateCountMap(rows: AggregateCountRow[]) {
  return new Map(rows.map((row) => [row.schoolId, Number(row.count)]));
}

function rate(count: number, total: number) {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const periodStart = new Date(now.getTime() - PERIOD_DAYS * DAY_MS);
  const overdueCareBefore = new Date(now.getTime() - DAY_MS);

  const schools = await prisma.school.findMany({
    where: { subscription_status: { in: ["active", "trial"] } },
    select: { id: true, name: true, createdAt: true, subscription_status: true },
    orderBy: { createdAt: "asc" },
  });
  const schoolIds = schools.map((school) => school.id);

  if (schoolIds.length === 0) {
    return Response.json({
      periodDays: PERIOD_DAYS,
      generatedAt: now,
      summary: { activeSchools: 0, usingCoreFeatures: 0, dormantSchools: 0, averageActivationPercent: 0 },
      features: [],
      careReports: { submitted: 0, approved: 0, returned: 0, pending: 0, overdue: 0, averageReviewMinutes: null },
      funnel: [],
      schools: [],
    });
  }

  const [
    managerRows,
    teacherRows,
    classRows,
    studentRows,
    guardianRows,
    attendanceAllRows,
    careAllRows,
    attendanceRecentRows,
    careRecentRows,
    calendarRecentRows,
    activityRecentRows,
    arrivalRecentRows,
    careByStatus,
    overdueCare,
    averageReviewRows,
  ] = await Promise.all([
    prisma.user.groupBy({
      by: ["schoolId"],
      where: {
        schoolId: { in: schoolIds },
        acceptedAt: { not: null },
        disabledAt: null,
        OR: [{ role: "admin" }, { roleRef: { key: { in: ["owner", "manager", "admin"] } } }],
      },
      _count: { _all: true },
    }),
    prisma.teacher.groupBy({
      by: ["schoolId"],
      where: { schoolId: { in: schoolIds }, isActive: true, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.class.groupBy({
      by: ["schoolId"],
      where: { schoolId: { in: schoolIds }, archivedAt: null, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.student.groupBy({
      by: ["schoolId"],
      where: { schoolId: { in: schoolIds }, isActive: true, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.guardianAccount.groupBy({
      by: ["schoolId"],
      where: { schoolId: { in: schoolIds }, acceptedAt: { not: null }, disabledAt: null },
      _count: { _all: true },
    }),
    prisma.attendance.groupBy({
      by: ["schoolId"],
      where: { schoolId: { in: schoolIds } },
      _count: { _all: true },
    }),
    prisma.careReport.groupBy({
      by: ["schoolId"],
      where: { schoolId: { in: schoolIds }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.attendance.groupBy({
      by: ["schoolId"],
      where: { schoolId: { in: schoolIds }, createdAt: { gte: periodStart } },
      _count: { _all: true },
    }),
    prisma.$queryRawUnsafe<AggregateCountRow[]>(
      'SELECT "schoolId", COUNT(DISTINCT COALESCE("dailyBatchId", "id"))::int AS "count" FROM "CareReport" WHERE "schoolId" = ANY($1::text[]) AND "deletedAt" IS NULL AND "createdAt" >= $2 GROUP BY "schoolId"',
      schoolIds,
      periodStart
    ),
    prisma.calendarEvent.groupBy({
      by: ["schoolId"],
      where: { schoolId: { in: schoolIds }, deletedAt: null, createdAt: { gte: periodStart } },
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["schoolId"],
      where: { schoolId: { in: schoolIds }, createdAt: { gte: periodStart } },
      _count: { _all: true },
    }),
    prisma.arrivalNotice.groupBy({
      by: ["schoolId"],
      where: { schoolId: { in: schoolIds }, createdAt: { gte: periodStart } },
      _count: { _all: true },
    }),
    prisma.$queryRawUnsafe<Array<{ reviewStatus: string; count: number }>>(
      'SELECT "reviewStatus", COUNT(DISTINCT ("schoolId" || \':\' || COALESCE("dailyBatchId", "id")))::int AS "count" FROM "CareReport" WHERE "schoolId" = ANY($1::text[]) AND "deletedAt" IS NULL AND "createdAt" >= $2 GROUP BY "reviewStatus"',
      schoolIds,
      periodStart
    ),
    prisma.$queryRawUnsafe<Array<{ count: number }>>(
      'SELECT COUNT(DISTINCT ("schoolId" || \':\' || COALESCE("dailyBatchId", "id")))::int AS "count" FROM "CareReport" WHERE "schoolId" = ANY($1::text[]) AND "deletedAt" IS NULL AND "reviewStatus" = \'PENDING_REVIEW\' AND "createdAt" < $2',
      schoolIds,
      overdueCareBefore
    ),
    prisma.$queryRawUnsafe<Array<{ average_minutes: number | null }>>(
      'WITH report_batches AS (SELECT "schoolId", COALESCE("dailyBatchId", "id") AS "batchKey", MIN("createdAt") AS "createdAt", MAX("reviewedAt") AS "reviewedAt" FROM "CareReport" WHERE "schoolId" = ANY($1::text[]) AND "deletedAt" IS NULL AND "reviewedAt" IS NOT NULL AND "createdAt" >= $2 GROUP BY "schoolId", COALESCE("dailyBatchId", "id")) SELECT AVG(EXTRACT(EPOCH FROM ("reviewedAt" - "createdAt")) / 60.0)::float8 AS "average_minutes" FROM report_batches',
      schoolIds,
      periodStart
    ),
  ]);

  const managers = countMap(managerRows);
  const teachers = countMap(teacherRows);
  const classes = countMap(classRows);
  const students = countMap(studentRows);
  const guardians = countMap(guardianRows);
  const attendanceAll = countMap(attendanceAllRows);
  const careAll = countMap(careAllRows);
  const attendanceRecent = countMap(attendanceRecentRows);
  const careRecent = aggregateCountMap(careRecentRows);
  const calendarRecent = countMap(calendarRecentRows);
  const activityRecent = countMap(activityRecentRows);
  const arrivalRecent = countMap(arrivalRecentRows);

  const featureDefinitions = [
    { key: "attendance", label: "الحضور", values: attendanceRecent },
    { key: "care_reports", label: "تقارير الرعاية", values: careRecent },
    { key: "calendar", label: "التقويم والأحداث", values: calendarRecent },
    { key: "activities", label: "الأنشطة", values: activityRecent },
    { key: "arrival", label: "إشعار الوصول", values: arrivalRecent },
  ];

  const stages = [
    { key: "school", label: "إنشاء المنشأة" },
    { key: "manager", label: "تفعيل المديرة" },
    { key: "teacher", label: "إضافة معلم" },
    { key: "class", label: "إنشاء فصل" },
    { key: "student", label: "إضافة طفل" },
    { key: "guardian", label: "تفعيل ولي الأمر" },
    { key: "attendance", label: "أول حضور" },
    { key: "care", label: "أول تقرير رعاية" },
  ];

  const schoolAnalytics = schools.map((school) => {
    const checks = [
      true,
      (managers.get(school.id) ?? 0) > 0,
      (teachers.get(school.id) ?? 0) > 0,
      (classes.get(school.id) ?? 0) > 0,
      (students.get(school.id) ?? 0) > 0,
      (guardians.get(school.id) ?? 0) > 0,
      (attendanceAll.get(school.id) ?? 0) > 0,
      (careAll.get(school.id) ?? 0) > 0,
    ];
    let completedSteps = 0;
    while (completedSteps < checks.length && checks[completedSteps]) completedSteps++;
    const recentActions = featureDefinitions.reduce(
      (sum, feature) => sum + (feature.values.get(school.id) ?? 0),
      0
    );
    return {
      id: school.id,
      name: school.name,
      subscriptionStatus: school.subscription_status,
      createdAt: school.createdAt,
      daysSinceCreated: Math.max(0, Math.floor((now.getTime() - school.createdAt.getTime()) / DAY_MS)),
      completedSteps,
      activationPercent: rate(completedSteps, stages.length),
      currentStage: stages[Math.max(0, completedSteps - 1)].label,
      nextStep: stages[completedSteps]?.label ?? null,
      dormant: recentActions === 0,
      usage: Object.fromEntries(featureDefinitions.map((feature) => [feature.key, feature.values.get(school.id) ?? 0])),
    };
  }).sort((a, b) => a.completedSteps - b.completedSteps || b.daysSinceCreated - a.daysSinceCreated);

  const usingCoreFeatures = schoolAnalytics.filter((school) => !school.dormant).length;
  const averageActivationPercent = schools.length === 0
    ? 0
    : Math.round(schoolAnalytics.reduce((sum, school) => sum + school.activationPercent, 0) / schools.length);

  const careCounts = new Map(careByStatus.map((row) => [row.reviewStatus, Number(row.count)]));
  const submitted = careRecentRows.reduce((sum, row) => sum + Number(row.count), 0);

  return Response.json({
    periodDays: PERIOD_DAYS,
    generatedAt: now,
    summary: {
      activeSchools: schools.length,
      usingCoreFeatures,
      dormantSchools: schools.length - usingCoreFeatures,
      averageActivationPercent,
    },
    features: featureDefinitions.map((feature) => {
      const schoolsUsing = schools.filter((school) => (feature.values.get(school.id) ?? 0) > 0).length;
      const totalActions = [...feature.values.values()].reduce((sum, value) => sum + value, 0);
      return { key: feature.key, label: feature.label, schoolsUsing, adoptionRate: rate(schoolsUsing, schools.length), totalActions };
    }).sort((a, b) => b.adoptionRate - a.adoptionRate),
    careReports: {
      submitted,
      approved: careCounts.get("APPROVED") ?? 0,
      returned: careCounts.get("REJECTED") ?? 0,
      pending: careCounts.get("PENDING_REVIEW") ?? 0,
      overdue: Number(overdueCare[0]?.count ?? 0),
      averageReviewMinutes: averageReviewRows[0]?.average_minutes == null
        ? null
        : Math.round(averageReviewRows[0].average_minutes),
    },
    funnel: stages.map((stage, index) => {
      const count = schoolAnalytics.filter((school) => school.completedSteps > index).length;
      return { ...stage, count, conversionRate: rate(count, schools.length) };
    }),
    schools: schoolAnalytics,
  });
}
