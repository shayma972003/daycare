"use client";

import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { describeApiError } from "@/lib/api-error";

type Confidence = "LOW" | "MEDIUM" | "HIGH";

interface GrowthData {
  generatedAt: string;
  months: number;
  summary: {
    mrr: number;
    arr: number;
    paidSchools: number;
    trialSchools: number;
    averageRevenuePerPaidSchool: number;
    trialToPaidPercent: number;
    paymentSuccessPercent: number | null;
  };
  growth: {
    schoolsThreeMonthPercent: number | null;
    studentsThreeMonthPercent: number | null;
    revenueThreeMonthPercent: number | null;
  };
  series: Array<{
    key: string;
    label: string;
    partial: boolean;
    newSchools: number;
    newStudents: number;
    newTeachers: number;
    revenue: number;
    paidPayments: number;
    failedPayments: number;
  }>;
  forecast: {
    months: Array<{ key: string; label: string; newSchools: number; newStudents: number; revenue: number }>;
    confidence: { schools: Confidence; students: Confidence; revenue: Confidence };
    method: string;
    excludesPartialCurrentMonth: boolean;
  };
  plans: Array<{ name: string; schools: number; students: number; mrr: number }>;
}

const CONFIDENCE: Record<Confidence, { label: string; classes: string }> = {
  HIGH: { label: "مرتفعة", classes: "bg-emerald-500/10 text-emerald-300" },
  MEDIUM: { label: "متوسطة", classes: "bg-amber-500/10 text-amber-300" },
  LOW: { label: "محدودة", classes: "bg-slate-500/10 text-slate-300" },
};

function number(value: number) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 1 }).format(value);
}

function money(value: number) {
  return new Intl.NumberFormat("ar-SA", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 0,
  }).format(value);
}

function growthLabel(value: number | null) {
  if (value == null) return "لا توجد فترة سابقة للمقارنة";
  if (value === 0) return "مستقر مقارنة بالثلاثة أشهر السابقة";
  return `${value > 0 ? "+" : ""}${number(value)}٪ مقارنة بالثلاثة أشهر السابقة`;
}

function GrowthBadge({ value }: { value: number | null }) {
  const classes = value == null
    ? "bg-white/5 text-gray-500"
    : value > 0
      ? "bg-emerald-500/10 text-emerald-300"
      : value < 0
        ? "bg-red-500/10 text-red-300"
        : "bg-slate-500/10 text-slate-300";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] ${classes}`}>{growthLabel(value)}</span>;
}

function BarSeries<T extends { key: string; label: string; partial?: boolean; forecast?: boolean }>({
  rows,
  value,
  format = number,
}: {
  rows: T[];
  value: (row: T) => number;
  format?: (value: number) => string;
}) {
  const values = rows.map((row) => value(row));
  const maximum = Math.max(1, ...values);
  return (
    <div className="flex h-52 items-end gap-2 overflow-x-auto pb-1" aria-label="مخطط النمو الشهري">
      {rows.map((row, index) => {
        const itemValue = values[index];
        const height = Math.max(itemValue > 0 ? 8 : 2, Math.round((itemValue / maximum) * 145));
        return (
          <div key={row.key} className="flex min-w-12 flex-1 flex-col items-center justify-end gap-2">
            <div className="text-[10px] text-gray-400">{format(itemValue)}</div>
            <div
              className={`w-full max-w-12 rounded-t-lg ${row.forecast ? "border border-dashed border-violet-400/70 bg-violet-500/20" : row.partial ? "bg-indigo-500/35" : "bg-indigo-500/80"}`}
              style={{ height }}
              title={`${row.label}: ${format(itemValue)}`}
            />
            <div className="w-14 truncate text-center text-[9px] text-gray-600" title={row.label}>{row.label}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function GrowthForecastPage() {
  const [data, setData] = useState<GrowthData | null>(null);
  const [months, setMonths] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (selectedMonths: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get<GrowthData>(`/api/admin/growth?months=${selectedMonths}`);
      setData(response.data);
    } catch (loadError) {
      setError(describeApiError(loadError, "تعذر تحميل تحليلات النمو"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    axios
      .get<GrowthData>(`/api/admin/growth?months=${months}`)
      .then((response) => {
        if (active) setData(response.data);
      })
      .catch((loadError) => {
        if (active) setError(describeApiError(loadError, "تعذر تحميل تحليلات النمو"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [months]);

  const revenueRows = useMemo(() => {
    if (!data) return [];
    return [
      ...data.series.map((item) => ({ ...item, forecast: false })),
      ...data.forecast.months.map((item) => ({ ...item, partial: false, forecast: true })),
    ];
  }, [data]);

  return (
    <div className="space-y-7 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">النمو والتوقعات</h1>
          <p className="mt-1 text-sm text-gray-400">اتجاه نمو المنصة والإيراد مع تقدير واضح للأشهر الثلاثة القادمة</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-gray-500">الفترة التاريخية
            <select
              aria-label="الفترة التاريخية"
              value={months}
              onChange={(event) => setMonths(Number(event.target.value))}
              className="mt-1 block rounded-xl border border-white/10 bg-[#171722] px-3 py-2 text-sm text-white"
            >
              <option value={6}>6 أشهر</option>
              <option value={12}>12 شهرًا</option>
              <option value={18}>18 شهرًا</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load(months)}
            disabled={loading}
            className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
          >
            {loading ? "جاري التحديث..." : "تحديث"}
          </button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

      {data && (
        <>
          <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[
              { label: "الإيراد الشهري المتكرر", value: money(data.summary.mrr), detail: `الإيراد السنوي المتوقع ${money(data.summary.arr)}`, color: "text-emerald-300" },
              { label: "المنشآت المدفوعة", value: number(data.summary.paidSchools), detail: `${number(data.summary.trialSchools)} منشأة تجريبية`, color: "text-indigo-300" },
              { label: "متوسط الإيراد للمنشأة", value: money(data.summary.averageRevenuePerPaidSchool), detail: "شهريًا للمنشآت المدفوعة", color: "text-sky-300" },
              { label: "نسبة المنشآت المدفوعة", value: `${number(data.summary.trialToPaidPercent)}٪`, detail: data.summary.paymentSuccessPercent == null ? "لا توجد محاولات دفع" : `نجاح الدفع ${number(data.summary.paymentSuccessPercent)}٪`, color: "text-violet-300" },
            ].map((item) => (
              <article key={item.label} className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
                <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
                <div className="mt-1 text-xs text-gray-300">{item.label}</div>
                <div className="mt-2 text-[11px] text-gray-600">{item.detail}</div>
              </article>
            ))}
          </section>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <section className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-white">المنشآت الجديدة</h2>
                  <p className="mt-1 text-xs text-gray-500">الشهر الحالي باهت لأنه غير مكتمل</p>
                </div>
                <GrowthBadge value={data.growth.schoolsThreeMonthPercent} />
              </div>
              <BarSeries rows={data.series} value={(row) => row.newSchools} />
            </section>

            <section className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-white">الطلاب الجدد</h2>
                  <p className="mt-1 text-xs text-gray-500">إجمالي الإضافات الشهرية عبر كل المنشآت</p>
                </div>
                <GrowthBadge value={data.growth.studentsThreeMonthPercent} />
              </div>
              <BarSeries rows={data.series} value={(row) => row.newStudents} />
            </section>
          </div>

          <section className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-white">الإيراد المحصّل والتوقع</h2>
                <p className="mt-1 text-xs text-gray-500">الأعمدة المتقطعة توقعات، وليست مبالغ مضمونة</p>
              </div>
              <GrowthBadge value={data.growth.revenueThreeMonthPercent} />
            </div>
            <BarSeries
              rows={revenueRows}
              value={(row) => row.revenue}
              format={money}
            />
            <div className="mt-3 flex flex-wrap gap-4 border-t border-white/5 pt-3 text-[11px] text-gray-500">
              <span><span className="ml-1 inline-block h-2.5 w-4 rounded-sm bg-indigo-500/80" />فعلي</span>
              <span><span className="ml-1 inline-block h-2.5 w-4 rounded-sm border border-dashed border-violet-400/70 bg-violet-500/20" />متوقع</span>
              <span>الشهر الجاري لا يدخل في حساب الاتجاه</span>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
              <div>
                <h2 className="font-semibold text-white">توقع الأشهر الثلاثة القادمة</h2>
                <p className="mt-1 text-xs text-gray-500">اتجاه مبسّط من آخر ستة أشهر مكتملة مع تخفيف القفزات غير الطبيعية</p>
              </div>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[580px] text-right text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr>
                      <th className="pb-3 font-medium">الشهر</th>
                      <th className="pb-3 font-medium">منشآت جديدة</th>
                      <th className="pb-3 font-medium">طلاب جدد</th>
                      <th className="pb-3 font-medium">إيراد متوقع</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.forecast.months.map((item) => (
                      <tr key={item.key}>
                        <td className="py-3 text-gray-300">{item.label}</td>
                        <td className="py-3 text-indigo-300">{number(item.newSchools)}</td>
                        <td className="py-3 text-sky-300">{number(item.newStudents)}</td>
                        <td className="py-3 text-emerald-300">{money(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ["المنشآت", data.forecast.confidence.schools],
                  ["الطلاب", data.forecast.confidence.students],
                  ["الإيراد", data.forecast.confidence.revenue],
                ].map(([label, confidence]) => {
                  const item = CONFIDENCE[confidence as Confidence];
                  return <div key={label} className="rounded-xl bg-white/[0.02] p-3 text-center"><div className="text-[10px] text-gray-600">ثقة {label}</div><span className={`mt-2 inline-block rounded-full px-2 py-1 text-[10px] ${item.classes}`}>{item.label}</span></div>;
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-white/5 bg-[#1e1e2e]">
              <div className="border-b border-white/5 p-5">
                <h2 className="font-semibold text-white">توزيع الخطط الحالية</h2>
                <p className="mt-1 text-xs text-gray-500">أعداد وإيراد مجمع دون بيانات منشآت شخصية</p>
              </div>
              <div className="divide-y divide-white/5">
                {data.plans.map((plan) => (
                  <div key={plan.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-4">
                    <div><div className="text-sm text-white">{plan.name}</div><div className="mt-1 text-[11px] text-gray-600">{number(plan.students)} طالبًا</div></div>
                    <div className="text-center"><div className="text-sm text-indigo-300">{number(plan.schools)}</div><div className="text-[9px] text-gray-600">منشأة</div></div>
                    <div className="min-w-24 text-left"><div className="text-sm text-emerald-300">{money(plan.mrr)}</div><div className="text-[9px] text-gray-600">شهريًا</div></div>
                  </div>
                ))}
                {data.plans.length === 0 && <div className="p-10 text-center text-sm text-gray-500">لا توجد اشتراكات حالية.</div>}
              </div>
            </section>
          </div>

          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-6 text-amber-100/70">
            <strong className="text-amber-200">تنبيه:</strong> التوقعات تقديرات تشغيلية وليست ضمانًا ماليًا. تعتمد على آخر ستة أشهر مكتملة، وتقل دقتها عند قلة السجلات أو انقطاع الدفعات. لا تستخدم الصفحة أسماء الأطفال أو الموظفين أو بياناتهم الصحية.
          </div>
        </>
      )}
    </div>
  );
}
