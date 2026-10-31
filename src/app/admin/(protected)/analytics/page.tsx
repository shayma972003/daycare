"use client";

import axios from "axios";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { describeApiError } from "@/lib/api-error";

interface AnalyticsData {
  periodDays: number;
  generatedAt: string;
  summary: {
    activeSchools: number;
    usingCoreFeatures: number;
    dormantSchools: number;
    averageActivationPercent: number;
  };
  features: Array<{
    key: string;
    label: string;
    schoolsUsing: number;
    adoptionRate: number;
    totalActions: number;
  }>;
  careReports: {
    submitted: number;
    approved: number;
    returned: number;
    pending: number;
    overdue: number;
    averageReviewMinutes: number | null;
  };
  funnel: Array<{
    key: string;
    label: string;
    count: number;
    conversionRate: number;
  }>;
  schools: Array<{
    id: string;
    name: string;
    subscriptionStatus: string;
    createdAt: string;
    daysSinceCreated: number;
    completedSteps: number;
    activationPercent: number;
    currentStage: string;
    nextStep: string | null;
    dormant: boolean;
    usage: Record<string, number>;
  }>;
}

type SchoolFilter = "all" | "stalled" | "dormant" | "complete";

function formatNumber(value: number) {
  return new Intl.NumberFormat("ar-SA").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  }).format(new Date(value));
}

function formatReviewTime(minutes: number | null) {
  if (minutes == null) return "لا توجد بيانات";
  if (minutes < 60) return `${formatNumber(minutes)} دقيقة`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${formatNumber(hours)} ساعة`;
}

const FILTERS: Array<{ key: SchoolFilter; label: string }> = [
  { key: "all", label: "الكل" },
  { key: "stalled", label: "غير مكتملة" },
  { key: "dormant", label: "بدون استخدام حديث" },
  { key: "complete", label: "مكتملة التفعيل" },
];

export default function UsageAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SchoolFilter>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get<AnalyticsData>("/api/admin/analytics");
      setData(response.data);
    } catch (loadError) {
      setError(describeApiError(loadError, "تعذر تحميل تحليلات الاستخدام"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    axios
      .get<AnalyticsData>("/api/admin/analytics")
      .then((response) => {
        if (active) setData(response.data);
      })
      .catch((loadError) => {
        if (active) setError(describeApiError(loadError, "تعذر تحميل تحليلات الاستخدام"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleSchools = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLocaleLowerCase("ar");
    return data.schools.filter((school) => {
      const matchesSearch = !query || school.name.toLocaleLowerCase("ar").includes(query);
      const matchesFilter = filter === "all"
        || (filter === "stalled" && school.nextStep != null)
        || (filter === "dormant" && school.dormant)
        || (filter === "complete" && school.nextStep == null);
      return matchesSearch && matchesFilter;
    });
  }, [data, filter, search]);

  return (
    <div className="space-y-7 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">تحليلات الاستخدام والتفعيل</h1>
          <p className="mt-1 text-sm text-gray-400">مسار تفعيل المنشآت واستخدام الميزات خلال آخر 30 يومًا</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
        >
          {loading ? "جاري التحديث..." : "تحديث البيانات"}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[
              { label: "المنشآت النشطة", value: formatNumber(data.summary.activeSchools), color: "text-indigo-300" },
              { label: "تستخدم الميزات", value: formatNumber(data.summary.usingCoreFeatures), color: "text-emerald-300" },
              { label: "بدون استخدام حديث", value: formatNumber(data.summary.dormantSchools), color: "text-amber-300" },
              { label: "متوسط اكتمال التفعيل", value: `${formatNumber(data.summary.averageActivationPercent)}٪`, color: "text-sky-300" },
            ].map((item) => (
              <article key={item.label} className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
                <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
                <div className="mt-1 text-xs text-gray-400">{item.label}</div>
              </article>
            ))}
          </section>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <section className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
              <div>
                <h2 className="font-semibold text-white">استخدام الميزات</h2>
                <p className="mt-1 text-xs text-gray-500">نسبة المنشآت التي استخدمت كل ميزة مرة واحدة على الأقل خلال الفترة</p>
              </div>
              <div className="mt-5 space-y-4">
                {data.features.map((feature) => (
                  <div key={feature.key}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <span className="text-gray-200">{feature.label}</span>
                      <span className="text-xs text-gray-400">
                        {formatNumber(feature.schoolsUsing)} منشأة · {formatNumber(feature.totalActions)} إجراء
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-l from-indigo-500 to-violet-400"
                        style={{ width: `${feature.adoptionRate}%` }}
                        aria-label={`${feature.label}: ${feature.adoptionRate}%`}
                      />
                    </div>
                    <div className="mt-1 text-left text-[11px] text-indigo-300">{formatNumber(feature.adoptionRate)}٪</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
              <div>
                <h2 className="font-semibold text-white">مسار التفعيل</h2>
                <p className="mt-1 text-xs text-gray-500">عدد المنشآت التي أكملت كل خطوة بالترتيب</p>
              </div>
              <div className="mt-5 space-y-3">
                {data.funnel.map((stage, index) => (
                  <div key={stage.key} className="grid grid-cols-[7rem_1fr_4rem] items-center gap-3">
                    <div className="truncate text-xs text-gray-300">{index + 1}. {stage.label}</div>
                    <div className="h-7 overflow-hidden rounded-lg bg-white/5">
                      <div
                        className="flex h-full min-w-8 items-center justify-end rounded-lg bg-indigo-500/70 px-2 text-[10px] text-white"
                        style={{ width: `${Math.max(stage.conversionRate, 4)}%` }}
                      >
                        {formatNumber(stage.count)}
                      </div>
                    </div>
                    <div className="text-left text-xs text-gray-400">{formatNumber(stage.conversionRate)}٪</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-white">مؤشرات تقارير الرعاية</h2>
                <p className="mt-1 text-xs text-gray-500">حالة المراجعة خلال آخر {formatNumber(data.periodDays)} يومًا</p>
              </div>
              <div className="rounded-xl bg-white/[0.03] px-3 py-2 text-xs text-gray-400">
                متوسط وقت المراجعة: <span className="text-white">{formatReviewTime(data.careReports.averageReviewMinutes)}</span>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
              {[
                ["المرسلة", data.careReports.submitted, "text-sky-300"],
                ["المعتمدة", data.careReports.approved, "text-emerald-300"],
                ["المرجعة", data.careReports.returned, "text-orange-300"],
                ["بانتظار المراجعة", data.careReports.pending, "text-indigo-300"],
                ["متأخرة أكثر من 24 ساعة", data.careReports.overdue, "text-red-300"],
              ].map(([label, value, color]) => (
                <div key={String(label)} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                  <div className={`text-xl font-bold ${color}`}>{formatNumber(Number(value))}</div>
                  <div className="mt-1 text-[11px] text-gray-500">{label}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-white/5 bg-[#1e1e2e]">
            <div className="border-b border-white/5 p-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-white">متابعة تفعيل المنشآت</h2>
                  <p className="mt-1 text-xs text-gray-500">يوضح موضع التوقف والخطوة التالية دون عرض بيانات الأطفال أو الموظفين</p>
                </div>
                <label className="block min-w-60 text-xs text-gray-500">
                  بحث باسم المنشأة
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="اكتبي اسم المنشأة..."
                    className="mt-1 w-full rounded-xl border border-white/10 bg-[#171722] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-indigo-500/50"
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={`rounded-full px-3 py-1.5 text-xs transition ${filter === item.key ? "bg-indigo-600 text-white" : "bg-white/5 text-gray-400 hover:text-white"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-right text-sm">
                <thead className="bg-white/[0.02] text-xs text-gray-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">المنشأة</th>
                    <th className="px-5 py-3 font-medium">اكتمال التفعيل</th>
                    <th className="px-5 py-3 font-medium">آخر خطوة مكتملة</th>
                    <th className="px-5 py-3 font-medium">الخطوة التالية</th>
                    <th className="px-5 py-3 font-medium">الاستخدام الحديث</th>
                    <th className="px-5 py-3 font-medium">التفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {visibleSchools.map((school) => {
                    const totalUsage = Object.values(school.usage).reduce((sum, value) => sum + value, 0);
                    return (
                      <tr key={school.id}>
                        <td className="px-5 py-4">
                          <div className="font-medium text-white">{school.name}</div>
                          <div className="mt-1 text-[11px] text-gray-500">منذ {formatNumber(school.daysSinceCreated)} يوم</div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-white/5">
                              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${school.activationPercent}%` }} />
                            </div>
                            <span className="text-xs text-gray-300">{formatNumber(school.activationPercent)}٪</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-xs text-gray-300">{school.currentStage}</td>
                        <td className="px-5 py-4 text-xs">
                          {school.nextStep ? <span className="text-amber-300">{school.nextStep}</span> : <span className="text-emerald-300">مكتمل</span>}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] ${school.dormant ? "bg-amber-500/10 text-amber-300" : "bg-emerald-500/10 text-emerald-300"}`}>
                            {school.dormant ? "لا يوجد" : `${formatNumber(totalUsage)} إجراء`}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <Link href={`/admin/schools/${school.id}`} className="text-xs text-indigo-300 hover:text-indigo-200">
                            عرض المنشأة ←
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleSchools.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-500">لا توجد منشآت مطابقة.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-white/5 px-5 py-3 text-[11px] text-gray-600">
              آخر تحديث: {formatDate(data.generatedAt)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
