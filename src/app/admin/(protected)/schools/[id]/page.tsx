"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import * as Tabs from "@radix-ui/react-tabs";

interface SchoolDetail {
  school: {
    id: string;
    name: string;
    email: string | null;
    plan_id: string | null;
    plan: { id: string; name: string; price: number } | null;
    subscription_status: string;
    renewal_date: string | null;
    suspended_at: string | null;
    suspension_reason: string | null;
    last_login_at: string | null;
    createdAt: string;
  };
  stats: { students: number; teachers: number; classes: number; invoices: number; notifications: number };
  activityLogs: { id: string; action: string; metadata: unknown; performed_by: string; performed_at: string }[];
  messages: { id: string; subject: string; sent_at: string | null; is_automated: boolean; delivered_at: string | null; read_at: string | null }[];
}

interface Plan { id: string; name: string; price: number }

const STATUS_LABELS: Record<string, string> = {
  active: "نشط", suspended: "موقوف", expired: "منتهٍ", trial: "تجريبي",
};

export default function SchoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<SchoolDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit form state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPlanId, setEditPlanId] = useState("");
  const [editRenewal, setEditRenewal] = useState("");
  const [editStatus, setEditStatus] = useState("");

  // Suspend dialog
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    Promise.all([
      axios.get<SchoolDetail>(`/api/admin/schools/${id}`),
      axios.get<Plan[]>("/api/admin/plans"),
    ]).then(([schoolRes, plansRes]) => {
      setData(schoolRes.data);
      setPlans(plansRes.data);
      const s = schoolRes.data.school;
      setEditName(s.name);
      setEditEmail(s.email ?? "");
      setEditPlanId(s.plan_id ?? "");
      setEditRenewal(s.renewal_date ? s.renewal_date.substring(0, 10) : "");
      setEditStatus(s.subscription_status);
    }).finally(() => setLoading(false));
  }, [id]);

  async function handleSave() {
    await axios.put(`/api/admin/schools/${id}`, {
      name: editName,
      email: editEmail || null,
      plan_id: editPlanId || null,
      renewal_date: editRenewal || null,
      subscription_status: editStatus,
    });
    const res = await axios.get<SchoolDetail>(`/api/admin/schools/${id}`);
    setData(res.data);
    setEditing(false);
  }

  async function handleSuspend() {
    await axios.post(`/api/admin/schools/${id}/suspend`, { reason: suspendReason });
    const res = await axios.get<SchoolDetail>(`/api/admin/schools/${id}`);
    setData(res.data);
    setSuspendOpen(false);
    setSuspendReason("");
  }

  async function handleReactivate() {
    await axios.post(`/api/admin/schools/${id}/reactivate`);
    const res = await axios.get<SchoolDetail>(`/api/admin/schools/${id}`);
    setData(res.data);
  }

  async function handleDelete() {
    if (deleteConfirm !== data?.school.name) return;
    await axios.delete(`/api/admin/schools/${id}`);
    router.push("/admin/schools");
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">جاري التحميل...</div>;
  if (!data) return null;

  const { school, stats, activityLogs, messages } = data;
  const isSuspended = school.subscription_status === "suspended";

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => router.push("/admin/schools")} className="text-gray-400 hover:text-white text-sm mb-2">← العودة</button>
          <h1 className="text-2xl font-bold text-white">{school.name}</h1>
        </div>
        <div className="flex gap-3">
          {!editing && <button onClick={() => setEditing(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-xl">تعديل</button>}
          {isSuspended
            ? <button onClick={handleReactivate} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-xl">إعادة تفعيل</button>
            : <button onClick={() => setSuspendOpen(true)} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-xl">إيقاف مؤقت</button>
          }
          <button onClick={() => setDeleteOpen(true)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-xl">حذف</button>
        </div>
      </div>

      <Tabs.Root defaultValue="info">
        <Tabs.List className="flex gap-1 bg-[#1e1e2e] p-1 rounded-xl w-fit border border-white/5 mb-6">
          {[
            { value: "info", label: "معلومات عامة" },
            { value: "stats", label: "الإحصائيات" },
            { value: "logs", label: "سجل النشاط" },
            { value: "messages", label: "الرسائل" },
          ].map((t) => (
            <Tabs.Trigger
              key={t.value}
              value={t.value}
              className="px-4 py-2 text-sm text-gray-400 rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-white transition-all"
            >
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* General Info Tab */}
        <Tabs.Content value="info">
          <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 p-6 space-y-4 max-w-lg">
            {editing ? (
              <>
                <Field label="اسم المدرسة"><input value={editName} onChange={(e) => setEditName(e.target.value)} className="input-admin" /></Field>
                <Field label="البريد الإلكتروني"><input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="input-admin" /></Field>
                <Field label="الخطة">
                  <select value={editPlanId} onChange={(e) => setEditPlanId(e.target.value)} className="input-admin">
                    <option value="">بدون خطة</option>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.price} ر.س</option>)}
                  </select>
                </Field>
                <Field label="تاريخ التجديد"><input type="date" value={editRenewal} onChange={(e) => setEditRenewal(e.target.value)} className="input-admin" /></Field>
                <Field label="الحالة">
                  <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className="input-admin">
                    {["active", "trial", "suspended", "expired"].map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </Field>
                <div className="flex gap-3 pt-2">
                  <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-xl">حفظ</button>
                  <button onClick={() => setEditing(false)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-sm rounded-xl">إلغاء</button>
                </div>
              </>
            ) : (
              <>
                <InfoRow label="الاسم" value={school.name} />
                <InfoRow label="البريد" value={school.email ?? "—"} />
                <InfoRow label="الخطة" value={school.plan?.name ?? "—"} />
                <InfoRow label="الحالة" value={STATUS_LABELS[school.subscription_status] ?? school.subscription_status} />
                <InfoRow label="التجديد" value={school.renewal_date ? new Date(school.renewal_date).toLocaleDateString("ar-SA") : "—"} />
                <InfoRow label="آخر دخول" value={school.last_login_at ? new Date(school.last_login_at).toLocaleDateString("ar-SA") : "—"} />
                <InfoRow label="تاريخ التسجيل" value={new Date(school.createdAt).toLocaleDateString("ar-SA")} />
                {school.suspension_reason && <InfoRow label="سبب الإيقاف" value={school.suspension_reason} />}
              </>
            )}
          </div>
        </Tabs.Content>

        {/* Stats Tab */}
        <Tabs.Content value="stats">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "الطلاب", value: stats.students },
              { label: "المعلمون", value: stats.teachers },
              { label: "الفصول", value: stats.classes },
              { label: "الفواتير", value: stats.invoices },
              { label: "الإشعارات المُرسلة", value: stats.notifications },
            ].map((s) => (
              <div key={s.label} className="bg-[#1e1e2e] rounded-2xl border border-white/5 p-5">
                <div className="text-2xl font-bold text-indigo-400">{s.value}</div>
                <div className="text-gray-400 text-xs mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </Tabs.Content>

        {/* Activity Logs Tab */}
        <Tabs.Content value="logs">
          <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">الإجراء</th>
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">المنفذ</th>
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {activityLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-3 text-white">{l.action}</td>
                    <td className="px-5 py-3 text-gray-400">{l.performed_by}</td>
                    <td className="px-5 py-3 text-gray-400">{new Date(l.performed_at).toLocaleString("ar-SA")}</td>
                  </tr>
                ))}
                {activityLogs.length === 0 && (
                  <tr><td colSpan={3} className="px-5 py-6 text-center text-gray-500">لا توجد سجلات</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        {/* Messages Tab */}
        <Tabs.Content value="messages">
          <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">الموضوع</th>
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">النوع</th>
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">أُرسل</th>
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">قُرئ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {messages.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 text-white">{m.subject}</td>
                    <td className="px-5 py-3 text-gray-400">{m.is_automated ? "تلقائي" : "يدوي"}</td>
                    <td className="px-5 py-3 text-gray-400">{m.sent_at ? new Date(m.sent_at).toLocaleDateString("ar-SA") : "—"}</td>
                    <td className="px-5 py-3 text-gray-400">{m.read_at ? "✓" : "—"}</td>
                  </tr>
                ))}
                {messages.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-gray-500">لا توجد رسائل</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Tabs.Content>
      </Tabs.Root>

      {/* Suspend Dialog */}
      {suspendOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1e1e2e] rounded-2xl p-6 w-96 border border-white/10">
            <h3 className="text-white font-bold mb-4">إيقاف مؤقت</h3>
            <textarea
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="سبب الإيقاف..."
              className="w-full bg-[#0f0f1a] border border-white/10 rounded-xl p-3 text-white text-sm resize-none h-24 focus:outline-none"
            />
            <div className="flex gap-3 mt-4">
              <button onClick={handleSuspend} disabled={!suspendReason} className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm py-2 rounded-xl">إيقاف</button>
              <button onClick={() => setSuspendOpen(false)} className="flex-1 bg-white/5 hover:bg-white/10 text-white text-sm py-2 rounded-xl">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Dialog */}
      {deleteOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1e1e2e] rounded-2xl p-6 w-96 border border-white/10">
            <h3 className="text-white font-bold mb-2">تأكيد الحذف</h3>
            <p className="text-gray-400 text-sm mb-4">اكتب اسم المدرسة لتأكيد الحذف النهائي:</p>
            <p className="text-orange-400 text-sm font-mono mb-3">{school.name}</p>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="اسم المدرسة..."
              className="w-full bg-[#0f0f1a] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleteConfirm !== school.name}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm py-2 rounded-xl"
              >
                حذف نهائي
              </button>
              <button onClick={() => setDeleteOpen(false)} className="flex-1 bg-white/5 hover:bg-white/10 text-white text-sm py-2 rounded-xl">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-gray-400 text-xs mb-1">{label}</label>
      {children}
    </div>
  );
}
