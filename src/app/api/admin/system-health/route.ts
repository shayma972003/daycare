import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { emailDeliveryEnabled, emailEnabled, emailProvider, env, storageEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { SystemJobKey } from "@/lib/system-job-run";
import webPackage from "../../../../../package.json";
import mobileApp from "../../../../../mobile/app.json";

const DAY_MS = 24 * 60 * 60 * 1000;

const JOBS: Array<{
  key: SystemJobKey;
  label: string;
  schedule: string;
  expectedWithinHours: number;
}> = [
  { key: "purge_trash", label: "التنظيف والسلة والتخزين", schedule: "يوميًا 02:00 UTC", expectedWithinHours: 30 },
  { key: "anonymize", label: "الاحتفاظ وتجهيل البيانات", schedule: "يوميًا 03:00 UTC", expectedWithinHours: 30 },
  { key: "push_queue", label: "استعادة طابور الإشعارات", schedule: "يوميًا 04:00 UTC", expectedWithinHours: 30 },
  { key: "subscription_alerts", label: "تنبيهات الاشتراكات", schedule: "يوميًا 06:00 UTC", expectedWithinHours: 30 },
  { key: "care_digest", label: "ملخصات تقارير الرعاية", schedule: "يوميًا 14:00 UTC", expectedWithinHours: 30 },
];

type JobState = "healthy" | "running" | "failed" | "overdue" | "never";

function jobState(
  run: { status: "RUNNING" | "SUCCEEDED" | "FAILED"; startedAt: Date } | undefined,
  now: Date,
  expectedWithinHours: number
): JobState {
  if (!run) return "never";
  const ageMs = now.getTime() - run.startedAt.getTime();
  if (run.status === "FAILED") return "failed";
  if (run.status === "RUNNING") return ageMs > 30 * 60 * 1000 ? "failed" : "running";
  return ageMs > expectedWithinHours * 60 * 60 * 1000 ? "overdue" : "healthy";
}

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestStartedAt = Date.now();
  const now = new Date();
  const since24h = new Date(now.getTime() - DAY_MS);
  const staleStorageBefore = new Date(now.getTime() - 36 * 60 * 60 * 1000);

  const databaseStartedAt = Date.now();
  await prisma.$queryRawUnsafe("SELECT 1");
  const databaseLatencyMs = Date.now() - databaseStartedAt;

  const [
    jobRuns,
    failedJobRuns24h,
    pendingPush,
    oldestPendingPush,
    failedPush24h,
    failedOutbound24h,
    storageRows,
    schoolCount,
    latestMigrationRows,
  ] = await Promise.all([
    prisma.systemJobRun.findMany({ orderBy: { startedAt: "desc" }, take: 100 }),
    prisma.systemJobRun.count({ where: { status: "FAILED", startedAt: { gte: since24h } } }),
    prisma.pushNotification.count({ where: { status: "PENDING" } }),
    prisma.pushNotification.findFirst({
      where: { status: "PENDING" },
      orderBy: { scheduledAt: "asc" },
      select: { scheduledAt: true },
    }),
    prisma.pushNotification.count({ where: { status: "FAILED", createdAt: { gte: since24h } } }),
    prisma.notificationLog.count({ where: { status: "FAILED", sentAt: { gte: since24h } } }),
    prisma.storageUsage.findMany({ select: { schoolId: true, totalBytes: true, computedAt: true } }),
    prisma.school.count(),
    prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null }>>(
      'SELECT "migration_name", "finished_at" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL ORDER BY "finished_at" DESC LIMIT 1'
    ),
  ]);

  const latestByJob = new Map<string, (typeof jobRuns)[number]>();
  for (const run of jobRuns) {
    if (!latestByJob.has(run.jobKey)) latestByJob.set(run.jobKey, run);
  }

  const staleStorageCount = Math.max(
    0,
    schoolCount - storageRows.filter((row) => row.computedAt >= staleStorageBefore).length
  );
  const totalStorageBytes = storageRows.reduce((sum, row) => sum + row.totalBytes, 0);

  const services = [
    {
      key: "database",
      label: "قاعدة البيانات",
      state: "healthy" as const,
      detail: `استجابة ناجحة خلال ${databaseLatencyMs} مللي ثانية`,
      configured: true,
    },
    {
      key: "email",
      label: "البريد الإلكتروني",
      state: emailEnabled ? ("healthy" as const) : ("warning" as const),
      detail: emailEnabled
        ? `الإرسال مفعّل عبر ${emailProvider === "resend" ? "Resend" : "SMTP"}`
        : emailDeliveryEnabled
          ? "الإرسال مفعّل لكن بيانات المزود غير مكتملة"
          : "الإرسال الخارجي متوقف من الإعدادات",
      configured: emailEnabled,
    },
    {
      key: "fcm",
      label: "Firebase FCM",
      state: process.env.FCM_SERVER_KEY && process.env.FCM_PROJECT_ID ? ("healthy" as const) : ("warning" as const),
      detail: process.env.FCM_SERVER_KEY && process.env.FCM_PROJECT_ID
        ? "بيانات FCM V1 موجودة"
        : "بيانات FCM V1 غير مكتملة",
      configured: Boolean(process.env.FCM_SERVER_KEY && process.env.FCM_PROJECT_ID),
    },
    {
      key: "expo",
      label: "Expo Push",
      state: "unknown" as const,
      detail: process.env.EXPO_ACCESS_TOKEN
        ? "رمز الوصول موجود؛ يلزم إرسال اختباري للتحقق من التسليم"
        : "لا يوجد رمز وصول؛ قد يعمل Expo إذا لم يُفعّل أمان الرموز",
      configured: Boolean(process.env.EXPO_ACCESS_TOKEN),
    },
    {
      key: "storage",
      label: "التخزين R2",
      state: storageEnabled ? (staleStorageCount > 0 ? "warning" as const : "healthy" as const) : ("warning" as const),
      detail: storageEnabled
        ? staleStorageCount > 0
          ? `${staleStorageCount} منشأة لم يُحدّث حساب تخزينها مؤخرًا`
          : "الإعدادات مكتملة وحسابات المساحة حديثة"
        : "R2 غير مهيأ؛ التخزين البديل داخل القاعدة ما زال يعمل",
      configured: storageEnabled,
    },
    {
      key: "cron",
      label: "المهام المجدولة",
      state: env.CRON_SECRET ? ("healthy" as const) : ("error" as const),
      detail: env.CRON_SECRET ? "حماية تشغيل المهام مهيأة" : "CRON_SECRET غير موجود؛ ستُرفض المهام",
      configured: Boolean(env.CRON_SECRET),
    },
  ];

  return Response.json({
    checkedAt: now,
    responseTimeMs: Date.now() - requestStartedAt,
    services,
    metrics24h: {
      failedJobRuns: failedJobRuns24h,
      failedPush: failedPush24h,
      failedOutbound: failedOutbound24h,
      pendingPush,
      oldestPendingPushAt: oldestPendingPush?.scheduledAt ?? null,
    },
    jobs: JOBS.map((job) => {
      const run = latestByJob.get(job.key);
      return {
        ...job,
        state: jobState(run, now, job.expectedWithinHours),
        lastRunAt: run?.startedAt ?? null,
        finishedAt: run?.finishedAt ?? null,
        durationMs: run?.durationMs ?? null,
        errorCode: run?.errorCode ?? null,
      };
    }),
    recentJobFailures: jobRuns
      .filter((run) => run.status === "FAILED")
      .slice(0, 10)
      .map((run) => ({
        id: run.id,
        jobKey: run.jobKey,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        errorCode: run.errorCode,
      })),
    storage: {
      schoolsTracked: storageRows.length,
      schoolCount,
      staleSchoolCount: staleStorageCount,
      totalBytes: totalStorageBytes,
    },
    versions: {
      web: webPackage.version,
      mobile: mobileApp.expo.version,
      deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      databaseMigration: latestMigrationRows[0]?.migration_name ?? null,
      databaseMigratedAt: latestMigrationRows[0]?.finished_at ?? null,
    },
    monitoring: {
      sentryConfigured: Boolean(env.NEXT_PUBLIC_SENTRY_DSN),
      webhookConfigured: Boolean(env.ERROR_WEBHOOK_URL),
      note: "أخطاء التطبيق العامة تُراجع في Sentry أو سجل الاستضافة؛ هذه الصفحة لا تنسخ محتوى الأخطاء الحساسة.",
    },
  });
}
