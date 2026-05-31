"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface SubscriptionsData {
  schools: {
    id: string;
    name: string;
    plan: { id: string; name: string; price: number } | null;
    subscription_status: string;
    renewal_date: string | null;
    studentCount: number;
    daysUntilRenewal: number | null;
  }[];
  mrr: { month: string; revenue: number }[];
}

interface Plan {
  id: string;
  name: string;
  price: number;
  max_students: number;
  max_classes: number;
  max_whatsapp_per_month: number;
  is_active: boolean;
}

const STATUS_CLS: Record<string, string> = {
  active: "text-emerald-400",
  suspended: "text-orange-400",
  expired: "text-red-400",
  trial: "text-blue-400",
};

export default function SubscriptionsPage() {
  const [data, setData] = useState<SubscriptionsData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [addPlanOpen, setAddPlanOpen] = useState(false);
  const [newPlan, setNewPlan] = useState({ name: "", price: 0, max_students: 50, max_classes: 5, max_whatsapp_per_month: 200 });
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

  async function load() {
    const [subRes, planRes] = await Promise.all([
      axios.get<SubscriptionsData>("/api/admin/subscriptions"),
      axios.get<Plan[]>("/api/admin/plans"),
    ]);
    setData(subRes.data);
    setPlans(planRes.data);
  }

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  async function extend(schoolId: string) {
    await axios.put(`/api/admin/subscriptions/${schoolId}`, { action: "extend" });
    await load();
  }

  async function changePlan(schoolId: string, plan_id: string) {
    await axios.put(`/api/admin/subscriptions/${schoolId}`, { action: "change_plan", plan_id });
    await load();
  }

  async function createPlan() {
    await axios.post("/api/admin/plans", newPlan);
    setAddPlanOpen(false);
    setNewPlan({ name: "", price: 0, max_students: 50, max_classes: 5, max_whatsapp_per_month: 200 });
    const res = await axios.get<Plan[]>("/api/admin/plans");
    setPlans(res.data);
  }

  async function savePlan(plan: Plan) {
    await axios.put(`/api/admin/plans/${plan.id}`, plan);
    setEditingPlan(null);
    const res = await axios.get<Plan[]>("/api/admin/plans");
    setPlans(res.data);
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">جاري التحميل...</div>;

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-2xl font-bold text-white">الاشتراكات</h1>

      {/* Section A - Schools Table */}
      <section>
        <h2 className="text-white font-semibold mb-4">حالة اشتراكات المدارس</h2>
        <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {["المدرسة", "الخطة", "الحالة", "التجديد", "أيام متبقية", "الطلاب", "إجراءات"].map((h) => (
                  <th key={h} className="px-5 py-3 text-right text-gray-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data?.schools.map((s) => {
                const days = s.daysUntilRenewal;
                const rowCls = days !== null && days < 0 ? "bg-red-500/5" : days !== null && days <= 7 ? "bg-orange-500/5" : "";
                return (
                  <tr key={s.id} className={`${rowCls} hover:bg-white/2 transition-colors`}>
                    <td className="px-5 py-3 text-white font-medium">{s.name}</td>
                    <td className="px-5 py-3">
                      <select
                        value={s.plan?.id ?? ""}
                        onChange={(e) => changePlan(s.id, e.target.value)}
                        className="bg-[#0f0f1a] border border-white/10 rounded-lg px-2 py-1 text-white text-xs"
                      >
                        <option value="">بدون خطة</option>
                        {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
                    <td className={`px-5 py-3 font-medium text-xs ${STATUS_CLS[s.subscription_status] ?? "text-gray-400"}`}>
                      {s.subscription_status}
                    </td>
                    <td className="px-5 py-3 text-gray-300">
                      {s.renewal_date ? new Date(s.renewal_date).toLocaleDateString("ar-SA") : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {days !== null ? (
                        <span className={`font-mono text-xs ${days < 0 ? "text-red-400" : days <= 7 ? "text-orange-400" : "text-gray-300"}`}>
                          {days < 0 ? `منتهٍ منذ ${Math.abs(days)}` : days}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-300">{s.studentCount}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => extend(s.id)}
                        className="text-xs bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 px-3 py-1 rounded-lg"
                      >
                        تجديد 30 يوم
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section B - MRR Chart */}
      <section>
        <h2 className="text-white font-semibold mb-4">الإيرادات الشهرية (MRR)</h2>
        <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 p-6">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data?.mrr} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1e1e2e", border: "1px solid #ffffff20", borderRadius: 8, color: "#fff" }}
                formatter={(v: unknown) => [`${v} ر.س`, "الإيرادات"] as [string, string]}
              />
              <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} dot={{ fill: "#6366f1" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Section C - Plans */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">إدارة الخطط</h2>
          <button onClick={() => setAddPlanOpen(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-xl">
            إضافة خطة
          </button>
        </div>
        <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {["الاسم", "السعر", "الطلاب", "الفصول", "واتساب/شهر", "مفعّل", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-right text-gray-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {plans.map((p) => (
                <tr key={p.id}>
                  {editingPlan?.id === p.id ? (
                    <>
                      <td className="px-5 py-3"><input value={editingPlan.name} onChange={(e) => setEditingPlan({ ...editingPlan, name: e.target.value })} className="input-admin w-24" /></td>
                      <td className="px-5 py-3"><input type="number" value={editingPlan.price} onChange={(e) => setEditingPlan({ ...editingPlan, price: Number(e.target.value) })} className="input-admin w-20" /></td>
                      <td className="px-5 py-3"><input type="number" value={editingPlan.max_students} onChange={(e) => setEditingPlan({ ...editingPlan, max_students: Number(e.target.value) })} className="input-admin w-20" /></td>
                      <td className="px-5 py-3"><input type="number" value={editingPlan.max_classes} onChange={(e) => setEditingPlan({ ...editingPlan, max_classes: Number(e.target.value) })} className="input-admin w-20" /></td>
                      <td className="px-5 py-3"><input type="number" value={editingPlan.max_whatsapp_per_month} onChange={(e) => setEditingPlan({ ...editingPlan, max_whatsapp_per_month: Number(e.target.value) })} className="input-admin w-24" /></td>
                      <td className="px-5 py-3"><input type="checkbox" checked={editingPlan.is_active} onChange={(e) => setEditingPlan({ ...editingPlan, is_active: e.target.checked })} /></td>
                      <td className="px-5 py-3 flex gap-2">
                        <button onClick={() => savePlan(editingPlan)} className="text-xs text-emerald-400 hover:text-emerald-300">حفظ</button>
                        <button onClick={() => setEditingPlan(null)} className="text-xs text-gray-400 hover:text-gray-300">إلغاء</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-5 py-3 text-white font-medium">{p.name}</td>
                      <td className="px-5 py-3 text-gray-300">{p.price} ر.س</td>
                      <td className="px-5 py-3 text-gray-300">{p.max_students}</td>
                      <td className="px-5 py-3 text-gray-300">{p.max_classes}</td>
                      <td className="px-5 py-3 text-gray-300">{p.max_whatsapp_per_month}</td>
                      <td className="px-5 py-3">{p.is_active ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>}</td>
                      <td className="px-5 py-3"><button onClick={() => setEditingPlan(p)} className="text-xs text-indigo-400 hover:text-indigo-300">تعديل</button></td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Add Plan Modal */}
      {addPlanOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1e1e2e] rounded-2xl p-6 w-96 border border-white/10 space-y-4">
            <h3 className="text-white font-bold">إضافة خطة جديدة</h3>
            {[
              { label: "الاسم", key: "name", type: "text" },
              { label: "السعر (ر.س)", key: "price", type: "number" },
              { label: "الحد الأقصى للطلاب", key: "max_students", type: "number" },
              { label: "الحد الأقصى للفصول", key: "max_classes", type: "number" },
              { label: "رسائل واتساب/شهر", key: "max_whatsapp_per_month", type: "number" },
            ].map((f) => (
              <div key={f.key}>
                <label className="text-gray-400 text-xs block mb-1">{f.label}</label>
                <input
                  type={f.type}
                  value={newPlan[f.key as keyof typeof newPlan]}
                  onChange={(e) => setNewPlan({ ...newPlan, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })}
                  className="input-admin w-full"
                />
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <button onClick={createPlan} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm py-2 rounded-xl">إنشاء</button>
              <button onClick={() => setAddPlanOpen(false)} className="flex-1 bg-white/5 hover:bg-white/10 text-white text-sm py-2 rounded-xl">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
