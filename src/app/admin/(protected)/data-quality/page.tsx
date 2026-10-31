"use client";

import axios from "axios";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { describeApiError } from "@/lib/api-error";

type Severity = "HIGH" | "WARNING";
type Category = "STRUCTURE" | "ACCOUNTS" | "DELIVERY" | "FILES";

interface DataQualityData {
  checkedAt: string;
  summary: {
    totalIssues: number;
    highIssues: number;
    warnings: number;
    affectedSchools: number;
    cleanSchools: number;
    schoolCount: number;
  };
  checks: Array<{
    key: string;
    label: string;
    description: string;
    severity: Severity;
    category: Category;
    total: number;
    affectedSchools: number;
  }>;
  schools: Array<{
    id: string;
    name: string;
    totalIssues: number;
    highIssues: number;
    warnings: number;
    issues: Array<{ key: string; count: number; severity: Severity; category: Category }>;
  }>;
  privacy: { aggregateOnly: boolean; note: string };
}

const CATEGORY_LABELS: Record<Category | "ALL", string> = {
  ALL: "الكل",
  STRUCTURE: "الربط والهيكلة",
  ACCOUNTS: "الحسابات",
  DELIVERY: "الإشعارات والتقارير",
  FILES: "الملفات والتخزين",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  }).format(new Date(value));
}

export default function DataQualityPage() {
  const [data, setData] = useState<DataQualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | "ALL">("ALL");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get<DataQualityData>("/api/admin/data-quality");
      setData(response.data);
    } catch (loadError) {
      setError(describeApiError(loadError, "تعذر تشغيل فحص سلامة البيانات"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    axios
      .get<DataQualityData>("/api/admin/data-quality")
      .then((response) => {
        if (active) setData(response.data);
      })
      .catch((loadError) => {
        if (active) setError(describeApiError(loadError, "تعذر تشغيل فحص سلامة البيانات"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const checkByKey = useMemo(() => new Map(data?.checks.map((check) => [check.key, check]) ?? []), [data]);

  const visibleChecks = useMemo(
    () => data?.checks.filter((check) => category === "ALL" || check.category === category) ?? [],
    [category, data]
  );

  const visibleSchools = useMemo(() => {
    if (!data) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase("ar");
    return data.schools
      .map((school) => ({
        ...school,
        issues: school.issues.filter((issue) => category === "ALL" || issue.category === category),
      }))
      .filter(
        (school) =>
          school.issues.length > 0
          && (!normalizedQuery || school.name.toLocaleLowerCase("ar").includes(normalizedQuery))
      );
  }, [category, data, query]);

  return (
    <div className="space-y-7 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">سلامة البيانات</h1>
          <p className="mt-1 text-sm text-gray-400">فحوصات تلقائية تكشف السجلات التي قد تعطل التشغيل أو الإشعارات</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
        >
          {loading ? "جاري الفحص..." : "إعادة الفحص"}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 gap-4 xl:grid-cols-5">
            {[
              ["إجمالي الملاحظات", data.summary.totalIssues, "text-white"],
              ["عالية الأولوية", data.summary.highIssues, "text-red-300"],
              ["تحذيرات", data.summary.warnings, "text-amber-300"],
              ["منشآت متأثرة", data.summary.affectedSchools, "text-violet-300"],
              ["منشآت سليمة", data.summary.cleanSchools, "text-emerald-300"],
            ].map(([label, value, classes]) => (
              <article key={String(label)} className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
                <div className={`text-2xl font-bold ${classes}`}>{value}</div>
                <div className="mt-1 text-xs text-gray-500">{label}</div>
              </article>
            ))}
          </section>

          <section className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4">
            <div className="text-sm text-emerald-200">{data.privacy.note}</div>
            <div className="mt-1 text-xs text-gray-500">آخر فحص: {formatDate(data.checkedAt)}</div>
          </section>

          <div className="flex flex-wrap gap-2" aria-label="تصنيف الفحوصات">
            {(Object.keys(CATEGORY_LABELS) as Array<Category | "ALL">).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCategory(value)}
                className={`rounded-full border px-3 py-2 text-xs transition ${
                  category === value
                    ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-100"
                    : "border-white/10 bg-white/[0.02] text-gray-400 hover:text-white"
                }`}
              >
                {CATEGORY_LABELS[value]}
              </button>
            ))}
          </div>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {visibleChecks.map((check) => (
              <article key={check.key} className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-white">{check.label}</h2>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] ${
                          check.severity === "HIGH" ? "bg-red-500/10 text-red-300" : "bg-amber-500/10 text-amber-300"
                        }`}
                      >
                        {check.severity === "HIGH" ? "عالية" : "تحذير"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-gray-500">{check.description}</p>
                  </div>
                  <div className="shrink-0 text-left">
                    <div className={`text-2xl font-bold ${check.total > 0 ? "text-white" : "text-emerald-300"}`}>
                      {check.total}
                    </div>
                    <div className="text-[10px] text-gray-600">{check.affectedSchools} منشأة</div>
                  </div>
                </div>
              </article>
            ))}
          </section>

          <section className="overflow-hidden rounded-2xl border border-white/5 bg-[#1e1e2e]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 p-5">
              <div>
                <h2 className="font-semibold text-white">المنشآت التي تحتاج متابعة</h2>
                <p className="mt-1 text-xs text-gray-500">تظهر أعداد مجمعة فقط؛ افتحي ملف المنشأة لمعالجة السجلات من أدواتها الأصلية.</p>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ابحثي باسم المنشأة"
                aria-label="البحث عن منشأة"
                className="w-64 rounded-xl border border-white/10 bg-[#171722] px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/50"
              />
            </div>

            {visibleSchools.length === 0 ? (
              <div className="p-10 text-center text-sm text-emerald-300">لا توجد ملاحظات ضمن التصفية الحالية.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-white/[0.02] text-xs text-gray-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">المنشأة</th>
                      <th className="px-5 py-3 font-medium">عالية</th>
                      <th className="px-5 py-3 font-medium">تحذيرات</th>
                      <th className="px-5 py-3 font-medium">تفاصيل الفحص</th>
                      <th className="px-5 py-3 font-medium">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {visibleSchools.map((school) => (
                      <tr key={school.id}>
                        <td className="px-5 py-4 font-medium text-white">{school.name}</td>
                        <td className="px-5 py-4 text-red-300">
                          {school.issues.filter((issue) => issue.severity === "HIGH").reduce((sum, issue) => sum + issue.count, 0)}
                        </td>
                        <td className="px-5 py-4 text-amber-300">
                          {school.issues.filter((issue) => issue.severity === "WARNING").reduce((sum, issue) => sum + issue.count, 0)}
                        </td>
                        <td className="max-w-xl px-5 py-4">
                          <div className="flex flex-wrap gap-1.5">
                            {school.issues.map((issue) => (
                              <span key={issue.key} className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] text-gray-300">
                                {checkByKey.get(issue.key)?.label ?? issue.key}: {issue.count}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <Link href={`/admin/schools/${school.id}`} className="text-xs text-indigo-300 hover:text-indigo-200">
                            فتح ملف المنشأة
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
