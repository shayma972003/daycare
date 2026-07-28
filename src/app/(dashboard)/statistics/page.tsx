"use client";

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Topbar } from "@/components/layout/Topbar";
import { formatCurrency, t } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface PaymentStatusBreakdown {
  PAID: number; LATE: number; CANCELLED: number; SUSPENDED: number; "بانتظار الدفع": number;
}

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

interface FinancialSummary {
  totalRegistrationFees: number;
  paymentStatusBreakdown: PaymentStatusBreakdown;
}

interface Report {
  id: string; name: string; type: string; period_label: string; file_url: string; issued_at: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PAID: "#2D7A4F", LATE: "#C45000", CANCELLED: "#C0232C", SUSPENDED: "#666666", "بانتظار الدفع": "#7C3AED",
};
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PAID: "مدفوع", LATE: "متأخر", CANCELLED: "ملغي", SUSPENDED: "موقف", "بانتظار الدفع": "بانتظار الدفع",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function countOverlappingMonths(from: Date, to: Date): number {
  if (from > to) return 0;
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1;
}

function calculateExpensesForPeriod(expenses: Expense[], from: Date, to: Date): number {
  return expenses.reduce((total, exp) => {
    const startDate = new Date(exp.start_date);
    if (exp.type === "one_time") {
      if (startDate >= from && startDate <= to) return total + exp.amount;
    } else {
      const effectiveEnd = exp.stopped_at
        ? new Date(Math.min(new Date(exp.stopped_at).getTime(), to.getTime()))
        : to;
      if (startDate <= effectiveEnd) {
        const months = countOverlappingMonths(
          new Date(Math.max(startDate.getTime(), from.getTime())),
          effectiveEnd
        );
        return total + exp.amount * months;
      }
    }
    return total;
  }, 0);
}

function getCurrentMonthExpenses(expenses: Expense[]): number {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return calculateExpensesForPeriod(expenses, from, to);
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

function SummaryTab() {
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [generatingReport, setGeneratingReport] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      axios.get<{ totalRegistrationFees: number; paymentStatusBreakdown: PaymentStatusBreakdown }>("/api/statistics/summary"),
      axios.get<Expense[]>("/api/expenses"),
    ]).then(([sumRes, expRes]) => {
      setSummary(sumRes.data);
      setExpenses(expRes.data);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    axios.get<Report[]>("/api/financial-reports")
      .then((r) => setReports(r.data))
      .finally(() => setLoadingReports(false));
  }, []);

  const totalExpenses = getCurrentMonthExpenses(expenses);

  const paymentPieData = summary
    ? Object.entries(summary.paymentStatusBreakdown).filter(([, v]) => v > 0).map(([key, count]) => ({
        name: PAYMENT_STATUS_LABELS[key] ?? key, value: count, color: PAYMENT_STATUS_COLORS[key] ?? "#ccc",
      }))
    : [];
  const totalPayment = paymentPieData.reduce((s, d) => s + d.value, 0);

  // Expense pie: group by title for one-time, or show monthly grouped
  const expensePieData = expenses.reduce<{ name: string; value: number; color: string }[]>((acc, exp) => {
    const existing = acc.find((x) => x.name === exp.title);
    const val = exp.type === "monthly" ? exp.amount : exp.amount;
    if (existing) { existing.value += val; }
    else { acc.push({ name: exp.title, value: val, color: `hsl(${(acc.length * 60) % 360}, 65%, 55%)` }); }
    return acc;
  }, []).filter((d) => d.value > 0);

  async function handleExportReport(key: string, label: string) {
    setGeneratingReport(key);
    try {
      const typeMap: Record<string, string> = { monthly: "monthly", semiAnnual: "semi_annual", annual: "annual" };
      const res = await axios.post<Report>("/api/financial-reports/generate", { type: typeMap[key], period_label: label });
      setReports((prev) => [res.data, ...prev]);
      const b64 = res.data.file_url.split(",")[1];
      if (b64) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        window.open(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), "_blank");
      }
    } catch { alert("فشل إنشاء التقرير"); }
    finally { setGeneratingReport(null); }
  }

  if (loading) return <div className="py-20 text-center text-sm text-gray-400">{t("common.loading")}</div>;

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiCard label="إجمالي رسوم التسجيل" value={formatCurrency(summary?.totalRegistrationFees ?? 0)} colorClass="text-purple-600" bgClass="bg-purple-50" />
        <KpiCard label="إجمالي المصاريف (هذا الشهر)" value={formatCurrency(totalExpenses)} colorClass="text-orange-500" bgClass="bg-orange-50" />
      </div>

      {/* Payment status pie */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <h3 className="text-sm font-bold text-[#111111] mb-4">{t("statistics.paymentStatus.title")}</h3>
        {paymentPieData.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">{t("common.noData")}</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={paymentPieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" nameKey="name"
                label={({ name, value }) => `${name}: ${value} (${totalPayment > 0 ? Math.round((value / totalPayment) * 100) : 0}%)`}>
                {paymentPieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(value, name) => [`${Number(value)} طالب (${totalPayment > 0 ? Math.round((Number(value) / totalPayment) * 100) : 0}%)`, name]} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Expense breakdown pie */}
      {expensePieData.length > 0 && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <h3 className="text-sm font-bold text-[#111111] mb-4">توزيع المصاريف</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={expensePieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" nameKey="name"
                label={({ name, value }) => `${name}: ${formatCurrency(value)}`}>
                {expensePieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(value, name) => [formatCurrency(Number(value)), name]} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Report export buttons */}
      <div className="flex flex-wrap gap-3">
        {([["monthly", t("statistics.reports.monthly")], ["semiAnnual", t("statistics.reports.semiAnnual")], ["annual", t("statistics.reports.annual")]] as [string, string][]).map(([key, label]) => (
          <button key={key} disabled={generatingReport === key} onClick={() => handleExportReport(key, label)}
            className="flex items-center gap-2 px-5 py-2.5 border-2 border-[#111111] text-[#111111] hover:bg-[#111111] hover:text-white rounded-xl font-medium text-sm transition-all disabled:opacity-60">
            <span>{generatingReport === key ? "⏳" : "⬇"}</span>{label}
          </button>
        ))}
      </div>

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
