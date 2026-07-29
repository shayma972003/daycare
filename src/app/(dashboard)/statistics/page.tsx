"use client";

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { formatCurrency, t } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type ReportPeriodType = "monthly" | "semi_annual" | "annual";

interface Expense {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  type: "one_time" | "monthly";
  start_date: string;
  is_active: boolean;
  stopped_at: string | null;
  created_at: string;
}

interface DetailRow {
  id: string;
  date: string;
  amount: number;
  label: string;
}

interface DashboardSummary {
  revenue: { total: number; monthlyFees: number; registrationFeesCollected: number; activities: number; lateFees: number; vatCollected: number };
  expenses: { total: number; salaries: number; salaryItems: { name: string; amount: number }[]; manual: { title: string; amount: number }[]; manualTotal: number };
  netIncome: number;
  amountDue: number;
  comparison: { revenuePct: number | null; expensesPct: number | null };
  collection: { paid: number; paidWithVat: number; late: number; pending: number; paidCount: number; lateCount: number; pendingCount: number };
  salaries: { totalBudgeted: number; paid: number; remaining: number };
  cashFlow: { openingBalance: number; inflows: number; outflows: number; closingBalance: number };
  details: { revenue: DetailRow[]; salaries: DetailRow[]; manualExpenses: DetailRow[] };
}

interface Report {
  id: string; name: string; type: string; period_label: string; file_url: string; issued_at: string;
}

function DetailList({ rows, emptyText }: { rows: { label: string; date: string; amount: number }[]; emptyText: string }) {
  if (rows.length === 0) return <p className="text-sm text-gray-400 text-center py-6">{emptyText}</p>;
  const sorted = [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="px-4 py-2 text-right font-medium text-gray-600">البند</th>
            <th className="px-4 py-2 text-right font-medium text-gray-600">التاريخ</th>
            <th className="px-4 py-2 text-right font-medium text-gray-600">المبلغ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {sorted.map((r, i) => (
            <tr key={i}>
              <td className="px-4 py-2 text-gray-800">{r.label}</td>
              <td className="px-4 py-2 text-gray-500">{new Date(r.date).toLocaleDateString("ar-SA")}</td>
              <td className="px-4 py-2 font-bold text-gray-900">{formatCurrency(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, colorClass, bgClass }: { label: string; value: string; colorClass: string; bgClass: string }) {
  return (
    <div className="bg-white rounded-xl shadow-card p-6 flex items-start justify-between gap-3">
      <div>
        <p className="text-3xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500 font-medium mt-1">{label}</p>
      </div>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${bgClass} ${colorClass}`}>
        <div className="w-5 h-5 bg-current rounded opacity-60" />
      </div>
    </div>
  );
}

// ── Add Expense Form ──────────────────────────────────────────────────────────

function AddExpenseForm({ onSaved, onCancel }: { onSaved: (e: Expense) => void; onCancel: () => void }) {
  const [type, setType] = useState<"one_time" | "monthly">("one_time");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !amount || !startDate) { setError("يرجى تعبئة جميع الحقول المطلوبة"); return; }
    setSaving(true);
    try {
      const res = await axios.post<Expense>("/api/expenses", {
        type, title, description: description || null,
        amount: parseFloat(amount), start_date: startDate,
      });
      onSaved(res.data);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? "فشل الحفظ" : "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-4 space-y-3">
      <h3 className="text-sm font-bold text-[#111111]">إضافة مصروف جديد</h3>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">النوع *</label>
          <select value={type} onChange={(e) => setType(e.target.value as "one_time" | "monthly")}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]">
            <option value="one_time">دفعة مستقلة</option>
            <option value="monthly">اشتراك شهري</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">عنوان المصروف *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">الوصف</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">السعر (ر.س) *</label>
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">تاريخ البداية *</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required dir="ltr"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving}
          className="px-5 py-2 bg-[#F64651] text-white rounded-xl text-sm font-medium hover:bg-[#D93A44] disabled:opacity-60">
          {saving ? "جاري الإضافة..." : "إضافة"}
        </button>
        <button type="button" onClick={onCancel}
          className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
          إلغاء
        </button>
      </div>
    </form>
  );
}

// ── Edit Expense Row ──────────────────────────────────────────────────────────

function EditExpenseRow({ expense, onSaved, onCancel }: { expense: Expense; onSaved: (e: Expense) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(expense.title);
  const [description, setDescription] = useState(expense.description ?? "");
  const [amount, setAmount] = useState(String(expense.amount));
  const [startDate, setStartDate] = useState(expense.start_date.split("T")[0]);
  const [saving, setSaving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await axios.put<Expense>(`/api/expenses/${expense.id}`, {
        title, description: description || null, amount: parseFloat(amount), start_date: startDate,
      });
      onSaved(res.data);
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  async function handleStop() {
    setStopping(true);
    try {
      const res = await axios.put<Expense>(`/api/expenses/${expense.id}/stop`);
      onSaved(res.data);
    } catch { /* silent */ }
    finally { setStopping(false); setConfirmStop(false); }
  }

  return (
    <tr className="bg-blue-50/40">
      <td className="px-4 py-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full px-2 py-1 text-sm rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-[#F64651]" />
      </td>
      <td className="px-4 py-2 text-xs text-gray-500">{expense.type === "monthly" ? "اشتراك شهري" : "دفعة مستقلة"}</td>
      <td className="px-4 py-2">
        <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="w-28 px-2 py-1 text-sm rounded border border-gray-200 focus:outline-none" />
      </td>
      <td className="px-4 py-2">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} dir="ltr"
          className="px-2 py-1 text-sm rounded border border-gray-200 focus:outline-none" />
      </td>
      <td className="px-4 py-2"></td>
      <td className="px-4 py-2">
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1 bg-[#F64651] text-white rounded-lg text-xs font-medium hover:bg-[#D93A44] disabled:opacity-60">
            {saving ? "..." : "حفظ"}
          </button>
          <button onClick={onCancel}
            className="px-3 py-1 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50">
            إلغاء
          </button>
          {expense.type === "monthly" && expense.is_active && (
            confirmStop ? (
              <>
                <button onClick={handleStop} disabled={stopping}
                  className="px-3 py-1 bg-orange-500 text-white rounded-lg text-xs font-medium hover:bg-orange-600 disabled:opacity-60">
                  {stopping ? "..." : "تأكيد الإيقاف"}
                </button>
                <button onClick={() => setConfirmStop(false)}
                  className="px-2 py-1 text-xs text-gray-500 hover:underline">لا</button>
              </>
            ) : (
              <button onClick={() => setConfirmStop(true)}
                className="px-3 py-1 border border-orange-300 text-orange-600 rounded-lg text-xs hover:bg-orange-50">
                إيقاف الدفع
              </button>
            )
          )}
        </div>
      </td>
    </tr>
  );
}

// ── TAB 1: Financial Summary ──────────────────────────────────────────────────

const PERIOD_TABS: { key: ReportPeriodType; label: string }[] = [
  { key: "monthly", label: "شهري" },
  { key: "semi_annual", label: "نصف سنوي" },
  { key: "annual", label: "سنوي" },
];

function pctBadge(pct: number | null) {
  if (pct === null) return <span className="text-gray-400 text-xs">لا تتوفر بيانات للمقارنة</span>;
  const up = pct >= 0;
  return (
    <span className={`text-xs font-bold ${up ? "text-emerald-600" : "text-red-500"}`}>
      {up ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function downloadCsv(filename: string, rows: { label: string; date?: string; amount: number }[]) {
  const header = "البند,التاريخ,المبلغ (ر.س)\n";
  const body = rows
    .map((r) => `"${r.label.replace(/"/g, '""')}",${r.date ? new Date(r.date).toLocaleDateString("ar-SA") : ""},${r.amount}`)
    .join("\n");
  const blob = new Blob(["﻿" + header + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-3">
      <h3 className="text-sm font-bold text-gray-900 border-b border-gray-100 pb-3">{title}</h3>
      {children}
    </div>
  );
}

function SummaryRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className={`font-bold ${valueClass ?? "text-gray-900"}`}>{value}</span>
      <span className="text-gray-500">{label}</span>
    </div>
  );
}

function SummaryTab() {
  const [periodType, setPeriodType] = useState<ReportPeriodType>("monthly");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [openPanel, setOpenPanel] = useState<"revenue" | "expenses" | "payments" | null>(null);

  useEffect(() => {
    setLoading(true);
    axios.get<DashboardSummary>(`/api/statistics/dashboard?type=${periodType}`)
      .then((r) => setSummary(r.data))
      .finally(() => setLoading(false));
  }, [periodType]);

  useEffect(() => {
    axios.get<Report[]>("/api/financial-reports")
      .then((r) => setReports(r.data))
      .finally(() => setLoadingReports(false));
  }, []);

  async function handleExportReport() {
    setGeneratingReport(true);
    try {
      const label = PERIOD_TABS.find((p) => p.key === periodType)?.label ?? periodType;
      const res = await axios.post<Report>("/api/financial-reports/generate", { type: periodType, period_label: label });
      setReports((prev) => [res.data, ...prev]);
      const b64 = res.data.file_url.split(",")[1];
      if (b64) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        window.open(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), "_blank");
      }
    } catch { alert("فشل إنشاء التقرير"); }
    finally { setGeneratingReport(false); }
  }

  const [exportingExcel, setExportingExcel] = useState(false);

  async function handleExportExcel() {
    setExportingExcel(true);
    try {
      const res = await axios.post<{ file: string }>("/api/statistics/export/excel", { type: periodType });
      const link = document.createElement("a");
      link.href = res.data.file;
      link.download = `التقرير-المالي-${periodType}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      alert("فشل تصدير Excel");
    } finally {
      setExportingExcel(false);
    }
  }

  if (loading || !summary) return <div className="py-20 text-center text-sm text-gray-400">{t("common.loading")}</div>;

  const combinedPayments = [
    ...summary.details.revenue.map((r) => ({ ...r, kind: "إيراد" as const })),
    ...summary.details.salaries.map((r) => ({ ...r, kind: "راتب" as const })),
    ...summary.details.manualExpenses.map((r) => ({ ...r, kind: "مصروف" as const })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {PERIOD_TABS.map((p) => (
          <button key={p.key} onClick={() => setPeriodType(p.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${periodType === p.key ? "bg-white shadow text-[#111111]" : "text-gray-500 hover:text-gray-700"}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* المالية — top KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="الإيرادات" value={formatCurrency(summary.revenue.total)} colorClass="text-emerald-600" bgClass="bg-emerald-50" />
        <KpiCard label="المصروفات" value={formatCurrency(summary.expenses.total)} colorClass="text-orange-500" bgClass="bg-orange-50" />
        <KpiCard label="صافي الدخل" value={formatCurrency(summary.netIncome)} colorClass={summary.netIncome >= 0 ? "text-emerald-600" : "text-red-500"} bgClass={summary.netIncome >= 0 ? "bg-emerald-50" : "bg-red-50"} />
        <KpiCard label="المبالغ المستحقة" value={formatCurrency(summary.amountDue)} colorClass="text-purple-600" bgClass="bg-purple-50" />
      </div>

      {/* الأداء المالي */}
      <SectionCard title="الأداء المالي">
        <SummaryRow label="الإيرادات" value={formatCurrency(summary.revenue.total)} valueClass="text-emerald-600" />
        <SummaryRow label="المصروفات" value={formatCurrency(summary.expenses.total)} valueClass="text-orange-500" />
        <SummaryRow label="صافي الدخل" value={formatCurrency(summary.netIncome)} valueClass={summary.netIncome >= 0 ? "text-emerald-600" : "text-red-500"} />
        <div className="pt-3 border-t border-gray-100 space-y-2">
          <p className="text-xs text-gray-400">مقارنة بالفترة السابقة</p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">الإيرادات</span>
            {pctBadge(summary.comparison.revenuePct)}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">المصروفات</span>
            {pctBadge(summary.comparison.expensesPct)}
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* الإيرادات breakdown */}
        <SectionCard title="الإيرادات">
          <SummaryRow label="الرسوم الشهرية" value={formatCurrency(summary.revenue.monthlyFees)} />
          <SummaryRow label="غرامات التأخير" value={formatCurrency(summary.revenue.lateFees)} />
          <SummaryRow label="رسوم التسجيل المحصّلة" value={formatCurrency(summary.revenue.registrationFeesCollected)} />
          <SummaryRow label="رسوم الفعاليات" value={formatCurrency(summary.revenue.activities)} />
          <SummaryRow label="ضريبة القيمة المضافة المحصَّلة" value={formatCurrency(summary.revenue.vatCollected)} />
          <div className="pt-2 border-t border-gray-100">
            <SummaryRow label="إجمالي الإيرادات" value={formatCurrency(summary.revenue.total)} valueClass="text-emerald-600" />
          </div>
        </SectionCard>

        {/* التحصيل */}
        <SectionCard title="التحصيل (حسب حالة دفع الطلاب النشطين)">
          <div className="flex items-start justify-between py-1">
            <div className="text-left">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-emerald-600">{formatCurrency(summary.collection.paid)}</span>
                  <span className="text-xs text-gray-400">الإجمالي الصافي</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-emerald-600">{formatCurrency(summary.collection.paidWithVat)}</span>
                  <span className="text-xs text-gray-400">شامل الضريبة</span>
                </div>
              </div>
            </div>
            <span className="text-sm text-gray-500">مدفوع ({summary.collection.paidCount} طالب)</span>
          </div>
          <SummaryRow label={`متأخر (${summary.collection.lateCount} طالب)`} value={formatCurrency(summary.collection.late)} valueClass="text-red-500" />
          <SummaryRow label={`بانتظار الدفع (${summary.collection.pendingCount} طالب)`} value={formatCurrency(summary.collection.pending)} valueClass="text-amber-500" />
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* المصروفات breakdown */}
        <SectionCard title="المصروفات">
          <SummaryRow label="الرواتب" value={formatCurrency(summary.expenses.salaries)} />
          {summary.expenses.manual.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">لا توجد مصاريف مضافة يدويًا خلال هذه الفترة</p>
          ) : (
            summary.expenses.manual.map((e, i) => <SummaryRow key={i} label={e.title} value={formatCurrency(e.amount)} />)
          )}
          <div className="pt-2 border-t border-gray-100">
            <SummaryRow label="إجمالي المصروفات" value={formatCurrency(summary.expenses.total)} valueClass="text-orange-500" />
          </div>
        </SectionCard>

        {/* الرواتب */}
        <SectionCard title="الرواتب">
          <SummaryRow label="إجمالي الرواتب (حسب عقود المعلمين النشطين)" value={formatCurrency(summary.salaries.totalBudgeted)} />
          <SummaryRow label="مصروف" value={formatCurrency(summary.salaries.paid)} valueClass="text-emerald-600" />
          <SummaryRow label="متبقي" value={formatCurrency(summary.salaries.remaining)} valueClass="text-amber-500" />
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* التدفق النقدي */}
        <SectionCard title="التدفق النقدي">
          <SummaryRow label="الرصيد الافتتاحي" value={formatCurrency(summary.cashFlow.openingBalance)} />
          <SummaryRow label="المتحصلات" value={`+ ${formatCurrency(summary.cashFlow.inflows)}`} valueClass="text-emerald-600" />
          <SummaryRow label="المصروفات" value={`- ${formatCurrency(summary.cashFlow.outflows)}`} valueClass="text-red-500" />
          <div className="pt-2 border-t border-gray-100">
            <SummaryRow label="الرصيد الحالي" value={formatCurrency(summary.cashFlow.closingBalance)} valueClass={summary.cashFlow.closingBalance >= 0 ? "text-emerald-600" : "text-red-500"} />
          </div>
        </SectionCard>
      </div>

      {/* التفاصيل */}
      <SectionCard title="التفاصيل">
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setOpenPanel(openPanel === "revenue" ? null : "revenue")}
            className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            عرض جميع الإيرادات
          </button>
          <button onClick={() => setOpenPanel(openPanel === "expenses" ? null : "expenses")}
            className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            عرض جميع المصروفات
          </button>
          <button onClick={() => setOpenPanel(openPanel === "payments" ? null : "payments")}
            className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            عرض جميع المدفوعات
          </button>
          <button onClick={handleExportReport} disabled={generatingReport}
            className="px-4 py-2 text-sm bg-[#111111] text-white rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-60">
            {generatingReport ? "⏳ جارٍ التصدير…" : "⬇ تصدير PDF"}
          </button>
          <button onClick={handleExportExcel} disabled={exportingExcel}
            className="px-4 py-2 text-sm border-2 border-[#111111] text-[#111111] rounded-xl hover:bg-[#111111] hover:text-white transition-colors disabled:opacity-60">
            {exportingExcel ? "⏳ جارٍ التصدير…" : "⬇ تصدير Excel"}
          </button>
        </div>

        {openPanel === "revenue" && (
          <DetailList rows={summary.details.revenue.map((r) => ({ label: r.label, date: r.date, amount: r.amount }))} emptyText="لا توجد إيرادات خلال هذه الفترة" />
        )}
        {openPanel === "expenses" && (
          <DetailList
            rows={[...summary.details.salaries, ...summary.details.manualExpenses].map((r) => ({ label: r.label, date: r.date, amount: r.amount }))}
            emptyText="لا توجد مصروفات خلال هذه الفترة"
          />
        )}
        {openPanel === "payments" && (
          <div className="mt-3 overflow-x-auto">
            {combinedPayments.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">لا توجد حركات مالية خلال هذه الفترة</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-2 text-right font-medium text-gray-600">النوع</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">البند</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">التاريخ</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">المبلغ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {combinedPayments.map((r) => (
                    <tr key={`${r.kind}-${r.id}`}>
                      <td className="px-4 py-2 text-gray-500">{r.kind}</td>
                      <td className="px-4 py-2 text-gray-800">{r.label}</td>
                      <td className="px-4 py-2 text-gray-500">{new Date(r.date).toLocaleDateString("ar-SA")}</td>
                      <td className={`px-4 py-2 font-bold ${r.kind === "إيراد" ? "text-emerald-600" : "text-red-500"}`}>
                        {r.kind === "إيراد" ? "+" : "-"} {formatCurrency(r.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </SectionCard>

      {/* Exported reports */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-bold text-[#111111]">التقارير المصدرة</h3>
        </div>
        {loadingReports ? (
          <div className="p-6 text-sm text-gray-400 text-center">{t("common.loading")}</div>
        ) : reports.length === 0 ? (
          <div className="p-6 text-sm text-gray-400 text-center">{t("common.noData")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-right font-medium text-gray-600">اسم الملف</th>
                <th className="px-5 py-3 text-right font-medium text-gray-600">الفترة</th>
                <th className="px-5 py-3 text-right font-medium text-gray-600">تاريخ الإصدار</th>
                <th className="px-5 py-3 text-right font-medium text-gray-600">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {reports.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/50">
                  <td className="px-5 py-3 text-gray-800 font-medium">{r.name}</td>
                  <td className="px-5 py-3 text-gray-500">{r.period_label}</td>
                  <td className="px-5 py-3 text-gray-500">{new Date(r.issued_at).toLocaleDateString("ar-SA")}</td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => { const b64=r.file_url.split(",")[1]; const bytes=Uint8Array.from(atob(b64),(c)=>c.charCodeAt(0)); window.open(URL.createObjectURL(new Blob([bytes],{type:"application/pdf"})),"_blank"); }}
                        className="px-2.5 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100">عرض</button>
                      <button onClick={() => { const a=document.createElement("a"); a.href=r.file_url; a.download=`${r.name}.pdf`; document.body.appendChild(a); a.click(); document.body.removeChild(a); }}
                        className="px-2.5 py-1 text-xs bg-gray-50 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100">تنزيل</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── TAB 2: Expenses Management ────────────────────────────────────────────────

function ExpensesTab() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get<Expense[]>("/api/expenses");
      setExpenses(res.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await axios.delete(`/api/expenses/${id}`);
      setExpenses((prev) => prev.filter((e) => e.id !== id));
    } catch { /* silent */ }
    finally { setDeletingId(null); setConfirmDeleteId(null); }
  }

  function handleExpenseSaved(updated: Expense) {
    setExpenses((prev) => prev.map((e) => e.id === updated.id ? updated : e));
    setEditingId(null);
  }

  function handleExpenseAdded(newExp: Expense) {
    setExpenses((prev) => [newExp, ...prev]);
    setShowAddForm(false);
  }

  const filtered = expenses.filter((exp) => {
    if (typeFilter && exp.type !== typeFilter) return false;
    if (search && !exp.title.includes(search)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Confirm delete dialog */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
            <p className="text-sm font-medium text-[#111111]">هل تريد حذف هذا المصروف نهائياً؟ لن يظهر في أي تقارير مستقبلية</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => handleDelete(confirmDeleteId)} disabled={!!deletingId}
                className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60">
                {deletingId ? "..." : "حذف"}
              </button>
              <button onClick={() => setConfirmDeleteId(null)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex gap-2 flex-wrap">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم..."
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651] bg-white" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651] bg-white">
            <option value="">الكل</option>
            <option value="monthly">اشتراك شهري</option>
            <option value="one_time">دفعة مستقلة</option>
          </select>
        </div>
        <button onClick={() => setShowAddForm(true)}
          className="px-4 py-2 bg-[#F64651] text-white rounded-xl text-sm font-bold hover:bg-[#D93A44] transition-all shadow-md">
          + أضف مصروف
        </button>
      </div>

      {showAddForm && (
        <AddExpenseForm onSaved={handleExpenseAdded} onCancel={() => setShowAddForm(false)} />
      )}

      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">{t("common.loading")}</div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-sm text-gray-400">{t("common.noData")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-right font-medium text-gray-600">العنوان</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">النوع</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">السعر</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">تاريخ البداية</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">الحالة</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((exp) =>
                  editingId === exp.id ? (
                    <EditExpenseRow key={exp.id} expense={exp} onSaved={handleExpenseSaved} onCancel={() => setEditingId(null)} />
                  ) : (
                    <tr key={exp.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-[#111111]">
                        {exp.title}
                        {exp.description && <span className="block text-xs text-gray-400 font-normal">{exp.description}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {exp.type === "monthly" ? "اشتراك شهري" : "دفعة مستقلة"}
                      </td>
                      <td className="px-4 py-3 text-gray-800 font-medium">{formatCurrency(exp.amount)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {new Date(exp.start_date).toLocaleDateString("ar-SA")}
                      </td>
                      <td className="px-4 py-3">
                        {exp.type === "monthly" ? (
                          exp.is_active
                            ? <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success-bg text-success-text">نشط</span>
                            : <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">موقوف</span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => setEditingId(exp.id)}
                            className="px-3 py-1 text-xs border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                            تعديل
                          </button>
                          <button onClick={() => setConfirmDeleteId(exp.id)}
                            className="px-3 py-1 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
                            حذف
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function StatisticsPage() {
  const [activeTab, setActiveTab] = useState<"summary" | "expenses">("summary");

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50">
      <Topbar title={t("statistics.title")} />

      <div className="p-6 space-y-6">
        {/* Tab navigation */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab("summary")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "summary" ? "bg-white shadow text-[#111111]" : "text-gray-500 hover:text-gray-700"}`}
          >
            الملخص المالي
          </button>
          <button
            onClick={() => setActiveTab("expenses")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "expenses" ? "bg-white shadow text-[#111111]" : "text-gray-500 hover:text-gray-700"}`}
          >
            المصاريف
          </button>
        </div>

        {activeTab === "summary" ? <SummaryTab /> : <ExpensesTab />}
      </div>
    </div>
  );
}
