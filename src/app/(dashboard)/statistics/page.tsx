"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Topbar } from "@/components/layout/Topbar";
import { formatCurrency, t } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface FinancialSummary {
  revenue: number;
  expenses: number;
  netProfit: number;
  totalRegistrationFees: number;
}

interface PaymentStatusBreakdown {
  PAID: number;
  LATE: number;
  CANCELLED: number;
  SUSPENDED: number;
}

interface ExpenseBreakdown {
  rent: number;
  maintenance: number;
  materials: number;
  misc: number;
  salaries: number;
}

interface EnrollmentPoint {
  month: number;
  year: number;
  boys: number;
  girls: number;
}

interface AttendanceByClass {
  className: string;
  attendanceRate: number;
}

interface TopStudent {
  name: string;
  lateHours: number;
}

interface LateSummary {
  totalLateHours: number;
  totalLateFees: number;
  topStudents: TopStudent[];
}

interface StatisticsData {
  financialSummary: FinancialSummary;
  paymentStatusBreakdown: PaymentStatusBreakdown;
  expenseBreakdown: ExpenseBreakdown;
  enrollmentTrend: EnrollmentPoint[];
  attendanceByClass: AttendanceByClass[];
  lateSummary: LateSummary;
}

interface ExpenseData {
  expense: {
    rent: number;
    maintenance: number;
    materials: number;
    misc: number;
  };
  salaries: number;
  month: number;
  year: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PAID: "#22c55e",
  LATE: "#f97316",
  CANCELLED: "#ef4444",
  SUSPENDED: "#94a3b8",
  "بانتظار الدفع": "#8b5cf6",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PAID: "مدفوع",
  LATE: "متأخر",
  CANCELLED: "ملغي",
  SUSPENDED: "موقف",
  "بانتظار الدفع": "بانتظار الدفع",
};

const EXPENSE_COLORS: Record<string, string> = {
  rent: "#6366f1",
  maintenance: "#f59e0b",
  materials: "#10b981",
  misc: "#8b5cf6",
  salaries: "#1a2340",
};

const EXPENSE_LABELS: Record<string, string> = {
  rent: "الإيجار",
  maintenance: "الصيانة",
  materials: "المواد",
  misc: "مصاريف إضافية",
  salaries: "الرواتب",
};

const ARABIC_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

// ── Helper Components ────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  colorClass,
  bgClass,
}: {
  label: string;
  value: string;
  colorClass: string;
  bgClass: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6 flex flex-col gap-2">
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center ${bgClass} mb-1`}
      >
        <span className="text-lg">📊</span>
      </div>
      <p className={`text-3xl font-bold ${colorClass}`}>{value}</p>
      <p className="text-sm text-gray-500 font-medium">{label}</p>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="text-base font-bold text-[#1a2340] mb-4">{title}</h2>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function StatisticsPage() {
  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [expenseData, setExpenseData] = useState<ExpenseData | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingExpense, setLoadingExpense] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [expenseError, setExpenseError] = useState("");
  const [savingExpense, setSavingExpense] = useState(false);
  const [expenseSaved, setExpenseSaved] = useState(false);

  const [reports, setReports] = useState<Array<{ id: string; name: string; type: string; period_label: string; file_url: string; issued_at: string }>>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [generatingReport, setGeneratingReport] = useState<string | null>(null);

  const [expenseForm, setExpenseForm] = useState({
    rent: 0,
    maintenance: 0,
    materials: 0,
    misc: 0,
  });

  const now = new Date();
  const [expenseMonth, setExpenseMonth] = useState(now.getMonth() + 1);
  const [expenseYear, setExpenseYear] = useState(now.getFullYear());

  // Fetch statistics
  useEffect(() => {
    setLoadingStats(true);
    axios
      .get<StatisticsData>("/api/statistics")
      .then((res) => {
        setStats(res.data);
        setStatsError("");
      })
      .catch(() => setStatsError("فشل تحميل البيانات الإحصائية"))
      .finally(() => setLoadingStats(false));
  }, []);

  // Fetch expenses for selected month/year
  useEffect(() => {
    setLoadingExpense(true);
    axios
      .get<ExpenseData>(`/api/expenses?month=${expenseMonth}&year=${expenseYear}`)
      .then((res) => {
        setExpenseData(res.data);
        setExpenseForm({
          rent: res.data.expense.rent,
          maintenance: res.data.expense.maintenance,
          materials: res.data.expense.materials,
          misc: res.data.expense.misc,
        });
        setExpenseError("");
      })
      .catch(() => setExpenseError("فشل تحميل بيانات المصاريف"))
      .finally(() => setLoadingExpense(false));
  }, [expenseMonth, expenseYear]);

  useEffect(() => {
    axios.get<typeof reports>("/api/financial-reports")
      .then((r) => setReports(r.data))
      .finally(() => setLoadingReports(false));
  }, []);

  async function handleExportReport(key: string, label: string) {
    setGeneratingReport(key);
    try {
      const typeMap: Record<string, "monthly" | "semi_annual" | "annual"> = {
        monthly: "monthly", semiAnnual: "semi_annual", annual: "annual",
      };
      const res = await axios.post<{ id: string; name: string; type: string; period_label: string; file_url: string; issued_at: string }>(
        "/api/financial-reports/generate",
        { type: typeMap[key], period_label: label, stats, expenseData }
      );
      setReports((prev) => [res.data, ...prev]);
      // Open immediately
      const b64 = res.data.file_url.split(",")[1];
      if (b64) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        window.open(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), "_blank");
      }
    } catch {
      alert("فشل إنشاء التقرير");
    } finally {
      setGeneratingReport(null);
    }
  }

  async function handleSaveExpense() {
    setSavingExpense(true);
    try {
      await axios.put("/api/expenses", { ...expenseForm, month: expenseMonth, year: expenseYear });
      setExpenseSaved(true);
      setTimeout(() => setExpenseSaved(false), 3000);
      // Refresh stats after saving
      const res = await axios.get<StatisticsData>("/api/statistics");
      setStats(res.data);
    } catch {
      alert("فشل حفظ المصاريف");
    } finally {
      setSavingExpense(false);
    }
  }

  // ── Derived chart data ──────────────────────────────────────────────────

  const paymentPieData = stats
    ? Object.entries(stats.paymentStatusBreakdown)
        .filter(([, v]) => v > 0)
        .map(([key, count]) => ({
          name: PAYMENT_STATUS_LABELS[key] ?? key,
          value: count,
          color: PAYMENT_STATUS_COLORS[key] ?? "#ccc",
        }))
    : [];

  const totalPayment = paymentPieData.reduce((s, d) => s + d.value, 0);

  const expensePieData = stats
    ? Object.entries(stats.expenseBreakdown)
        .filter(([, v]) => v > 0)
        .map(([key, amount]) => ({
          name: EXPENSE_LABELS[key] ?? key,
          value: amount,
          color: EXPENSE_COLORS[key] ?? "#ccc",
        }))
    : [];

  const enrollmentChartData = stats
    ? stats.enrollmentTrend.map((pt) => ({
        label: ARABIC_MONTHS[pt.month - 1],
        boys: pt.boys,
        girls: pt.girls,
      }))
    : [];

  const attendanceChartData = stats
    ? stats.attendanceByClass.map((c) => ({
        name: c.className,
        rate: c.attendanceRate,
      }))
    : [];

  const salaries = expenseData?.salaries ?? 0;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50">
      <Topbar title={t("statistics.title")} />

      <div className="p-6 space-y-8">
        {statsError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {statsError}
          </div>
        )}

        {/* ── Section 1: Financial KPIs ─────────────────────────────────── */}
        <section>
          <SectionTitle title={t("statistics.financial.title")} />
          {loadingStats ? (
            <div className="text-sm text-gray-400">{t("common.loading")}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <KpiCard
                label="رسوم التسجيل"
                value={formatCurrency(stats?.financialSummary.totalRegistrationFees ?? 0)}
                colorClass="text-purple-600"
                bgClass="bg-purple-50"
              />
              <KpiCard
                label={t("statistics.financial.expenses")}
                value={formatCurrency(stats?.financialSummary.expenses ?? 0)}
                colorClass="text-orange-500"
                bgClass="bg-orange-50"
              />
            </div>
          )}
        </section>

        {/* ── Section 2: Payment Status Pie Chart ──────────────────────── */}
        <section>
          <SectionTitle title={t("statistics.paymentStatus.title")} />
          <div className="bg-white rounded-xl shadow-md p-6">
            {loadingStats ? (
              <div className="text-sm text-gray-400">{t("common.loading")}</div>
            ) : paymentPieData.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">
                {t("common.noData")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={paymentPieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={110}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) =>
                      `${name}: ${value} (${
                        totalPayment > 0
                          ? Math.round((value / totalPayment) * 100)
                          : 0
                      }%)`
                    }
                  >
                    {paymentPieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [
                      `${Number(value)} طالب (${
                        totalPayment > 0
                          ? Math.round((Number(value) / totalPayment) * 100)
                          : 0
                      }%)`,
                      name,
                    ]}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ── Section 3: Expense Breakdown Pie Chart ───────────────────── */}
        <section>
          <SectionTitle title={t("statistics.expenseBreakdown.title")} />
          <div className="bg-white rounded-xl shadow-md p-6">
            {loadingStats ? (
              <div className="text-sm text-gray-400">{t("common.loading")}</div>
            ) : expensePieData.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">
                {t("common.noData")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={expensePieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={110}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) => `${name}: ${formatCurrency(value)}`}
                  >
                    {expensePieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [
                      formatCurrency(Number(value)),
                      name,
                    ]}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ── Section 4: Enrollment Trend Line Chart ───────────────────── */}
        <section>
          <SectionTitle title={t("statistics.enrollmentTrend.title")} />
          <div className="bg-white rounded-xl shadow-md p-6">
            {loadingStats ? (
              <div className="text-sm text-gray-400">{t("common.loading")}</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={enrollmentChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend
                    formatter={(value) =>
                      value === "boys"
                        ? t("statistics.enrollmentTrend.boys")
                        : t("statistics.enrollmentTrend.girls")
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="boys"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="boys"
                  />
                  <Line
                    type="monotone"
                    dataKey="girls"
                    stroke="#ec4899"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="girls"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ── Section 5: Attendance Rate Bar Chart ─────────────────────── */}
        <section>
          <SectionTitle title={t("statistics.attendanceRate.title")} />
          <div className="bg-white rounded-xl shadow-md p-6">
            {loadingStats ? (
              <div className="text-sm text-gray-400">{t("common.loading")}</div>
            ) : attendanceChartData.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">
                {t("common.noData")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={attendanceChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    formatter={(value) => [`${Number(value)}%`, "معدل الحضور"]}
                  />
                  <Bar dataKey="rate" fill="#1a2340" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ── Section 6: Late Departure Summary ────────────────────────── */}
        <section>
          <SectionTitle title={t("statistics.lateDeparture.title")} />
          {loadingStats ? (
            <div className="text-sm text-gray-400">{t("common.loading")}</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <p className="text-3xl font-bold text-orange-500">
                    {stats?.lateSummary.totalLateHours ?? 0}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {t("statistics.lateDeparture.totalLateHours")}
                  </p>
                </div>
                <div className="bg-white rounded-xl shadow-md p-6">
                  <p className="text-3xl font-bold text-red-600">
                    {formatCurrency(stats?.lateSummary.totalLateFees ?? 0)}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {t("statistics.lateDeparture.totalLateFees")}
                  </p>
                </div>
              </div>

              {/* Top 5 students table */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <p className="text-sm font-bold text-[#1a2340] mb-3">
                  {t("statistics.lateDeparture.topStudents")}
                </p>
                {(stats?.lateSummary.topStudents ?? []).length === 0 ? (
                  <p className="text-sm text-gray-400">{t("common.noData")}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-right py-2 font-semibold text-gray-600">
                          {t("statistics.lateDeparture.student")}
                        </th>
                        <th className="text-right py-2 font-semibold text-gray-600">
                          {t("statistics.lateDeparture.lateHours")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats?.lateSummary.topStudents.map((s, i) => (
                        <tr
                          key={i}
                          className="border-b border-gray-50 hover:bg-gray-50"
                        >
                          <td className="py-2 text-gray-800">{s.name}</td>
                          <td className="py-2 text-orange-600 font-medium">
                            {s.lateHours} {t("common.hour")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── Section 7: Expense Entry Form ────────────────────────────── */}
        <section>
          <SectionTitle title={t("statistics.expenseEntry.title")} />
          <div className="bg-white rounded-xl shadow-md p-6">
            {loadingExpense ? (
              <div className="text-sm text-gray-400">{t("common.loading")}</div>
            ) : expenseError ? (
              <div className="text-sm text-red-600">{expenseError}</div>
            ) : (
              <div className="space-y-4">
                {/* Month/Year picker */}
                <div className="flex items-center gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">الشهر</label>
                    <select
                      value={expenseMonth}
                      onChange={(e) => setExpenseMonth(Number(e.target.value))}
                      className="px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                    >
                      {ARABIC_MONTHS.map((m, i) => (
                        <option key={i + 1} value={i + 1}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">السنة</label>
                    <input
                      type="number"
                      value={expenseYear}
                      onChange={(e) => setExpenseYear(Number(e.target.value))}
                      min={2020}
                      max={2099}
                      className="w-28 px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(
                    [
                      ["rent", t("statistics.expenseEntry.rent")],
                      ["maintenance", t("statistics.expenseEntry.maintenance")],
                      ["materials", t("statistics.expenseEntry.materials")],
                      ["misc", t("statistics.expenseEntry.misc")],
                    ] as [keyof typeof expenseForm, string][]
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {label}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={expenseForm[field]}
                        onChange={(e) =>
                          setExpenseForm((prev) => ({
                            ...prev,
                            [field]: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                      />
                    </div>
                  ))}
                </div>

                {/* Salaries read-only */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("statistics.expenseEntry.salaries")}
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={formatCurrency(salaries)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-500 cursor-not-allowed"
                  />
                </div>

                {/* Registration fees read-only */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    إجمالي رسوم التسجيل
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={formatCurrency(stats?.financialSummary.totalRegistrationFees ?? 0)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-purple-50 text-sm text-purple-700 cursor-not-allowed"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSaveExpense}
                    disabled={savingExpense}
                    className="px-6 py-2.5 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-md"
                  >
                    {savingExpense
                      ? t("common.loading")
                      : t("statistics.expenseEntry.save")}
                  </button>
                  {expenseSaved && (
                    <span className="text-green-600 text-sm font-medium">
                      {t("common.success")}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Export Buttons ────────────────────────────────────────────── */}
        <section>
          <div className="flex flex-wrap gap-3">
            {(
              [
                ["monthly", t("statistics.reports.monthly")],
                ["semiAnnual", t("statistics.reports.semiAnnual")],
                ["annual", t("statistics.reports.annual")],
              ] as [string, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                disabled={generatingReport === key}
                onClick={() => handleExportReport(key, label)}
                className="flex items-center gap-2 px-5 py-2.5 border-2 border-[#1a2340] text-[#1a2340] hover:bg-[#1a2340] hover:text-white rounded-xl font-medium text-sm transition-all disabled:opacity-60"
              >
                <span>{generatingReport === key ? "⏳" : "⬇"}</span>
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* ── التقارير المصدرة ──────────────────────────────────────────── */}
        <section>
          <SectionTitle title="التقارير المصدرة" />
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
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
                      <td className="px-5 py-3 text-gray-500">
                        {new Date(r.issued_at).toLocaleDateString("ar-SA")}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => { const b64=r.file_url.split(",")[1]; const bytes=Uint8Array.from(atob(b64),(c)=>c.charCodeAt(0)); window.open(URL.createObjectURL(new Blob([bytes],{type:"application/pdf"})),"_blank"); }}
                            className="px-2.5 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100"
                          >عرض</button>
                          <button
                            onClick={() => { const a=document.createElement("a"); a.href=r.file_url; a.download=`${r.name}.pdf`; document.body.appendChild(a); a.click(); document.body.removeChild(a); }}
                            className="px-2.5 py-1 text-xs bg-gray-50 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100"
                          >تنزيل</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
