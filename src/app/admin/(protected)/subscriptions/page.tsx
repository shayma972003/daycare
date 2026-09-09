"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

type Plan = { id: string; name: string; price: number; billing_interval: "MONTHLY" | "YEARLY" };
type SubscriptionType = "TRIAL" | "MONTHLY" | "YEARLY" | "UNASSIGNED";
type SubscriptionsData = {
  schools: { id: string; name: string; plan: Plan | null; subscription_type: SubscriptionType; subscription_status: string; access_mode: "active" | "grace" | "locked"; renewal_date: string | null; studentCount: number; daysUntilRenewal: number | null }[];
  mrr: { month: string; revenue: number }[];
};

const STATUS_CLS: Record<string, string> = { active: "text-emerald-400", suspended: "text-orange-400", expired: "text-red-400", trial: "text-blue-400" };
const STATUS_LABELS: Record<string, string> = { active: "نشط", suspended: "موقوف", expired: "منتهٍ", trial: "تجريبي" };
const planLabel = (plan: Plan) => plan.billing_interval === "MONTHLY" ? "شهري" : "سنوي";

export default function SubscriptionsPage() {
  const [data, setData] = useState<SubscriptionsData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingSchoolId, setUpdatingSchoolId] = useState<string | null>(null);

  async function load() {
    const [subscriptions, planResponse] = await Promise.all([
      axios.get<SubscriptionsData>("/api/admin/subscriptions"),
      axios.get<Plan[]>("/api/admin/plans"),
    ]);
    setData(subscriptions.data);
    setPlans(planResponse.data);
  }

  useEffect(() => { void Promise.resolve().then(load).catch((cause) => setError(describeApiError(cause, "فشل تحميل الاشتراكات"))).finally(() => setLoading(false)); }, []);

  async function run(action: () => Promise<void>, fallback: string) {
    setError(null);
    try { await action(); } catch (cause) { setError(describeApiError(cause, fallback)); }
  }

  async function updateSchool(schoolId: string, operation: () => Promise<void>, fallback: string) {
    if (updatingSchoolId) return;
    setUpdatingSchoolId(schoolId);
    try {
      await run(operation, fallback);
    } finally {
      setUpdatingSchoolId(null);
    }
  }

  const extend = (schoolId: string) => updateSchool(schoolId, async () => { await axios.put(`/api/admin/subscriptions/${schoolId}`, { action: "extend" }); await load(); }, "تعذر تجديد الاشتراك");
  const changeType = (schoolId: string, subscription_type: Exclude<SubscriptionType, "UNASSIGNED">) => updateSchool(schoolId, async () => { await axios.put(`/api/admin/subscriptions/${schoolId}`, { action: "change_type", subscription_type }); await load(); }, "تعذر تغيير نوع الاشتراك");

  if (loading) return <div className="p-8 text-sm text-gray-400">جاري التحميل...</div>;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-8 p-4 sm:p-6 lg:p-8">
      <div><h1 className="text-2xl font-bold text-white">الاشتراكات</h1><p className="mt-1 text-sm text-gray-400">تجربة شهر، ثم اشتراك شهري أو سنوي. تغيير النوع يحدّث المدة والحالة تلقائيًا.</p></div>
      {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      <section className="grid gap-4 sm:grid-cols-2">
        {plans.map((plan) => <article key={plan.id} className="rounded-2xl border border-white/10 bg-[#1e1e2e] p-6"><div className="text-sm text-indigo-300">{planLabel(plan)}</div><div className="mt-2 text-3xl font-black text-white">{plan.price} <span className="text-sm font-normal text-gray-400">ر.س</span></div><p className="mt-2 text-xs text-gray-400">{plan.billing_interval === "MONTHLY" ? "لمدة شهر تقويمي" : "لمدة سنة تقويمية"}</p></article>)}
      </section>

      <section>
        <h2 className="mb-4 font-semibold text-white">حالة اشتراكات المدارس</h2>
        <div className="overflow-x-auto rounded-2xl border border-white/5 bg-[#1e1e2e]">
          <table className="min-w-[900px] w-full text-sm">
            <thead><tr className="border-b border-white/5">{["المدرسة", "الخطة", "الحالة", "التجديد", "أيام متبقية", "الطلاب", "إجراءات"].map((heading) => <th key={heading} className="px-5 py-3 text-right font-medium text-gray-400">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-white/5">{data?.schools.map((school) => {
              const days = school.daysUntilRenewal;
              return <tr key={school.id} className={days !== null && days < 0 ? "bg-red-500/5" : days !== null && days <= 7 ? "bg-orange-500/5" : ""}>
                <td className="px-5 py-3 font-medium text-white">{school.name}</td>
                <td className="px-5 py-3"><select aria-label={`نوع اشتراك ${school.name}`} value={school.subscription_type} disabled={updatingSchoolId !== null} onChange={(event) => void changeType(school.id, event.target.value as Exclude<SubscriptionType, "UNASSIGNED">)} className="rounded-lg border border-white/10 bg-[#0f0f1a] px-2 py-1 text-xs text-white disabled:cursor-wait disabled:opacity-50">{school.subscription_type === "UNASSIGNED" && <option value="UNASSIGNED" disabled>غير محدد — اختاري النوع</option>}<option value="TRIAL">تجريبي — شهر</option><option value="MONTHLY">شهري — 299 ر.س</option><option value="YEARLY">سنوي — 2990 ر.س</option></select></td>
                <td className={`px-5 py-3 text-xs font-medium ${STATUS_CLS[school.subscription_status] ?? "text-gray-400"}`}>{STATUS_LABELS[school.subscription_status] ?? school.subscription_status}{school.access_mode === "grace" ? " — ضمن المهلة" : school.access_mode === "locked" && school.subscription_status === "expired" ? " — قراءة فقط" : ""}</td>
                <td className="px-5 py-3 text-gray-300">{school.renewal_date ? new Date(school.renewal_date).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn") : "—"}</td>
                <td className="px-5 py-3 text-gray-300">{days === null ? "—" : days < 0 ? `منتهٍ منذ ${Math.abs(days)} يوم` : days}</td>
                <td className="px-5 py-3 text-gray-300">{school.studentCount}</td>
                <td className="px-5 py-3"><button type="button" onClick={() => void extend(school.id)} disabled={school.subscription_type === "UNASSIGNED" || updatingSchoolId !== null} className="rounded-lg bg-indigo-600/20 px-3 py-1 text-xs text-indigo-300 hover:bg-indigo-600/40 disabled:cursor-not-allowed disabled:opacity-40">{updatingSchoolId === school.id ? "جاري التحديث..." : "تجديد حسب النوع"}</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <section><h2 className="mb-4 font-semibold text-white">الإيراد الشهري المكافئ</h2><div className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-6"><ResponsiveContainer width="100%" height={240}><LineChart data={data?.mrr}><CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" /><XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 11 }} /><YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} /><Tooltip contentStyle={{ backgroundColor: "#1e1e2e", border: "1px solid #ffffff20", borderRadius: 8, color: "#fff" }} formatter={(value: unknown) => [`${Number(value).toFixed(2)} ر.س`, "الإيراد"] as [string, string]} /><Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} /></LineChart></ResponsiveContainer></div></section>
    </div>
  );
}
