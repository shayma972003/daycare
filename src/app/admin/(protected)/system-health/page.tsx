"use client";

import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { describeApiError } from "@/lib/api-error";

type ServiceState = "healthy" | "warning" | "error" | "unknown";
type JobState = "healthy" | "running" | "failed" | "overdue" | "never";

interface HealthData {
  checkedAt: string;
  responseTimeMs: number;
  services: Array<{
    key: string;
    label: string;
    state: ServiceState;
    detail: string;
    configured: boolean;
  }>;
  metrics24h: {
    failedJobRuns: number;
    failedPush: number;
    failedOutbound: number;
    pendingPush: number;
    oldestPendingPushAt: string | null;
  };
  jobs: Array<{
    key: string;
    label: string;
    schedule: string;
    state: JobState;
    lastRunAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    errorCode: string | null;
  }>;
  recentJobFailures: Array<{
    id: string;
    jobKey: string;
    startedAt: string;
    durationMs: number | null;
    errorCode: string | null;
  }>;
  storage: {
    schoolsTracked: number;
    schoolCount: number;
    staleSchoolCount: number;
    totalBytes: number;
  };
  versions: {
    web: string;
    mobile: string;
    deployment: string;
    databaseMigration: string | null;
    databaseMigratedAt: string | null;
  };
  monitoring: {
    sentryConfigured: boolean;
    webhookConfigured: boolean;
    note: string;
  };
}

const SERVICE_STATE: Record<ServiceState, { label: string; classes: string; dot: string }> = {
  healthy: { label: "سليم", classes: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", dot: "bg-emerald-400" },
  warning: { label: "يحتاج إعدادًا", classes: "bg-amber-500/10 text-amber-300 border-amber-500/20", dot: "bg-amber-400" },
  error: { label: "متعطل", classes: "bg-red-500/10 text-red-300 border-red-500/20", dot: "bg-red-400" },
  unknown: { label: "غير متحقق", classes: "bg-slate-500/10 text-slate-300 border-slate-500/20", dot: "bg-slate-400" },
};

const JOB_STATE: Record<JobState, { label: string; classes: string }> = {
  healthy: { label: "اكتملت", classes: "text-emerald-300 bg-emerald-500/10" },
  running: { label: "تعمل الآن", classes: "text-blue-300 bg-blue-500/10" },
  failed: { label: "فشلت", classes: "text-red-300 bg-red-500/10" },
  overdue: { label: "متأخرة", classes: "text-amber-300 bg-amber-500/10" },
  never: { label: "لا يوجد تشغيل مسجل", classes: "text-slate-300 bg-slate-500/10" },
};

const JOB_LABELS: Record<string, string> = {
  purge_trash: "التنظيف والسلة والتخزين",
  anonymize: "الاحتفاظ وتجهيل البيانات",
  push_queue: "استعادة طابور الإشعارات",
  subscription_alerts: "تنبيهات الاشتراكات",
  care_digest: "ملخصات تقارير الرعاية",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (value == null) return "—";
  if (value < 1000) return `${value} مللي ثانية`;
  return `${(value / 1000).toFixed(1)} ثانية`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} م.ب`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ج.ب`;
}

export default function SystemHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get<HealthData>("/api/admin/system-health");
      setData(response.data);
    } catch (loadError) {
      setError(describeApiError(loadError, "تعذر فحص صحة النظام"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    axios
      .get<HealthData>("/api/admin/system-health")
      .then((response) => {
        if (active) setData(response.data);
      })
      .catch((loadError) => {
        if (active) setError(describeApiError(loadError, "تعذر فحص صحة النظام"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const issueCount = data
    ? data.services.filter((service) => service.state === "error" || service.state === "warning").length
      + data.jobs.filter((job) => job.state === "failed" || job.state === "overdue").length
    : 0;

  return (
    <div className="p-8 space-y-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">مركز صحة النظام</h1>
          <p className="text-sm text-gray-400 mt-1">حالة الخدمات والمهام الدورية وآخر مؤشرات الإرسال</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
        >
          {loading ? "جاري الفحص..." : "تحديث الفحص"}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className={`rounded-2xl border p-5 ${issueCount === 0 ? "border-emerald-500/25 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className={`font-semibold ${issueCount === 0 ? "text-emerald-300" : "text-amber-300"}`}>
                  {issueCount === 0 ? "لا توجد مشكلات تشغيلية ظاهرة" : `${issueCount} نقطة تحتاج متابعة`}
                </div>
                <div className="text-xs text-gray-400 mt-1">آخر فحص: {formatDate(data.checkedAt)}</div>
              </div>
              <div className="text-xs text-gray-300">مدة الفحص: {data.responseTimeMs} مللي ثانية</div>
            </div>
          </div>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-white">الخدمات الأساسية</h2>
              <p className="text-xs text-gray-500 mt-1">الحالة تعكس الإعداد والاتصال المحلي؛ الخدمات الخارجية التي تحتاج إرسالًا فعليًا موضحة كغير متحقق منها.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {data.services.map((service) => {
                const state = SERVICE_STATE[service.state];
                return (
                  <article key={service.key} className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${state.dot}`} />
                        <h3 className="font-medium text-white">{service.label}</h3>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] ${state.classes}`}>{state.label}</span>
                    </div>
                    <p className="mt-3 min-h-10 text-xs leading-5 text-gray-400">{service.detail}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">آخر 24 ساعة</h2>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {[
                ["فشل المهام", data.metrics24h.failedJobRuns],
                ["فشل إشعارات الجوال", data.metrics24h.failedPush],
                ["فشل البريد والرسائل", data.metrics24h.failedOutbound],
                ["بانتظار الإرسال", data.metrics24h.pendingPush],
                ["مساحة الملفات", formatBytes(data.storage.totalBytes)],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-4">
                  <div className="text-xl font-bold text-white">{value}</div>
                  <div className="mt-1 text-xs text-gray-500">{label}</div>
                </div>
              ))}
            </div>
            {data.metrics24h.oldestPendingPushAt && (
              <p className="text-xs text-amber-300">أقدم إشعار بانتظار الإرسال: {formatDate(data.metrics24h.oldestPendingPushAt)}</p>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-white/5 bg-[#1e1e2e]">
            <div className="border-b border-white/5 p-5">
              <h2 className="font-semibold text-white">المهام المجدولة</h2>
              <p className="mt-1 text-xs text-gray-500">يبدأ سجل التشغيل من أول تشغيل بعد تثبيت تحديث مركز الصحة.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-white/[0.02] text-xs text-gray-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">المهمة</th>
                    <th className="px-5 py-3 font-medium">الجدول</th>
                    <th className="px-5 py-3 font-medium">الحالة</th>
                    <th className="px-5 py-3 font-medium">آخر تشغيل</th>
                    <th className="px-5 py-3 font-medium">المدة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.jobs.map((job) => (
                    <tr key={job.key}>
                      <td className="px-5 py-4 text-white">{job.label}</td>
                      <td className="px-5 py-4 text-xs text-gray-400">{job.schedule}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] ${JOB_STATE[job.state].classes}`}>
                          {JOB_STATE[job.state].label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-400">{formatDate(job.lastRunAt)}</td>
                      <td className="px-5 py-4 text-xs text-gray-400">{formatDuration(job.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <section className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
              <h2 className="font-semibold text-white">آخر إخفاقات المهام</h2>
              <div className="mt-4 space-y-3">
                {data.recentJobFailures.length === 0 ? (
                  <p className="text-sm text-gray-500">لا توجد إخفاقات مسجلة.</p>
                ) : data.recentJobFailures.map((failure) => (
                  <div key={failure.id} className="flex items-center justify-between gap-4 rounded-xl border border-red-500/10 bg-red-500/5 p-3">
                    <div>
                      <div className="text-sm text-red-200">{JOB_LABELS[failure.jobKey] ?? failure.jobKey}</div>
                      <div className="mt-1 text-xs text-gray-500">{formatDate(failure.startedAt)}</div>
                    </div>
                    <div className="text-xs text-gray-400">{failure.errorCode ?? "فشل غير مصنف"}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
              <h2 className="font-semibold text-white">الإصدارات والمراقبة</h2>
              <dl className="mt-4 space-y-3 text-sm">
                {[
                  ["إصدار النظام", data.versions.web],
                  ["إصدار التطبيق", data.versions.mobile],
                  ["نسخة النشر", data.versions.deployment],
                  ["آخر ترحيل لقاعدة البيانات", data.versions.databaseMigration ?? "غير متاح"],
                  ["Sentry", data.monitoring.sentryConfigured ? "مهيأ" : "غير مهيأ"],
                  ["تنبيه الأخطاء الخارجي", data.monitoring.webhookConfigured ? "مهيأ" : "غير مهيأ"],
                  ["تغطية حساب التخزين", `${data.storage.schoolsTracked} من ${data.storage.schoolCount} منشأة`],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-4 border-b border-white/5 pb-3 last:border-0">
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="max-w-[55%] break-all text-left text-gray-200">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 rounded-xl bg-white/[0.03] p-3 text-xs leading-5 text-gray-500">{data.monitoring.note}</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
