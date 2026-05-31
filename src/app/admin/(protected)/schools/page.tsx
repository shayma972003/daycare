"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";

interface SchoolRow {
  id: string;
  name: string;
  email: string | null;
  plan: { id: string; name: string; price: number } | null;
  subscription_status: string;
  renewal_date: string | null;
  last_login_at: string | null;
  createdAt: string;
  studentCount: number;
  teacherCount: number;
}

interface CreatedAccount {
  name: string;
  email: string;
  tempPassword: string;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "bg-emerald-500/20 text-emerald-300" },
  suspended: { label: "موقوف", cls: "bg-orange-500/20 text-orange-300" },
  expired: { label: "منتهٍ", cls: "bg-red-500/20 text-red-300" },
  trial: { label: "تجريبي", cls: "bg-blue-500/20 text-blue-300" },
};

function CreateSchoolModal({ onClose, onCreated }: { onClose: () => void; onCreated: (s: SchoolRow) => void }) {
  const [schoolName, setSchoolName] = useState("");
  const [email, setEmail] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedAccount | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await axios.post<SchoolRow & { tempPassword: string }>("/api/admin/schools", {
        schoolName, email, contactNumber: contactNumber || undefined,
      });
      setCreated({ name: schoolName, email, tempPassword: res.data.tempPassword });
      onCreated(res.data);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? "حدث خطأ" : "حدث خطأ");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "w-full bg-[#0f0f1a] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-bold text-lg">إنشاء حساب جديد</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl font-bold w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10">×</button>
        </div>

        {created ? (
          <div className="space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-2">
              <p className="text-emerald-400 font-bold text-sm">✓ تم إنشاء الحساب بنجاح</p>
              <p className="text-gray-300 text-sm">المنشأة: <span className="text-white font-medium">{created.name}</span></p>
              <p className="text-gray-300 text-sm">البريد: <span className="text-white font-medium" dir="ltr">{created.email}</span></p>
              <div className="mt-3 bg-[#0f0f1a] rounded-lg p-3">
                <p className="text-gray-400 text-xs mb-1">كلمة المرور المؤقتة</p>
                <p className="text-yellow-400 font-mono text-lg tracking-widest">{created.tempPassword}</p>
              </div>
              <p className="text-gray-500 text-xs mt-2">تم إرسال بيانات الدخول للبريد الإلكتروني إن كان Resend مُفعّلاً.</p>
            </div>
            <button onClick={onClose} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm transition-colors">
              إغلاق
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">اسم المنشأة *</label>
              <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} required placeholder="روضة النور" className={inputCls} />
            </div>
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">البريد الإلكتروني *</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="admin@school.com" dir="ltr" className={inputCls} />
            </div>
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">رقم الجوال (اختياري)</label>
              <input type="tel" value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} placeholder="05xxxxxxxx" dir="ltr" className={inputCls} />
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400 text-center">{error}</div>
            )}

            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-60">
                {loading ? "جارٍ الإنشاء…" : "إنشاء الحساب"}
              </button>
              <button type="button" onClick={onClose} className="px-5 py-2.5 border border-white/10 rounded-xl text-sm text-gray-400 hover:bg-white/5 transition-colors">
                إلغاء
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AdminSchoolsPage() {
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    axios.get<SchoolRow[]>("/api/admin/schools").then((r) => setSchools(r.data)).finally(() => setLoading(false));
  }, []);

  const filtered = schools.filter((s) => {
    const matchSearch = !search || s.name.includes(search) || (s.email?.includes(search) ?? false);
    const matchStatus = !statusFilter || s.subscription_status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="p-8 space-y-6">
      {showCreate && (
        <CreateSchoolModal
          onClose={() => setShowCreate(false)}
          onCreated={(s) => setSchools((prev) => [s, ...prev])}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">المدارس</h1>
          <p className="text-gray-400 text-sm mt-1">{schools.length} مدرسة مسجلة</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm transition-colors"
        >
          + إنشاء حساب جديد
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث بالاسم أو البريد..."
          className="bg-[#1e1e2e] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500 w-72"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-[#1e1e2e] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="suspended">موقوف</option>
          <option value="expired">منتهٍ</option>
          <option value="trial">تجريبي</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400 text-sm text-center">جاري التحميل...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-5 py-4 text-right text-gray-400 font-medium">المدرسة</th>
                <th className="px-5 py-4 text-right text-gray-400 font-medium">الخطة</th>
                <th className="px-5 py-4 text-right text-gray-400 font-medium">الحالة</th>
                <th className="px-5 py-4 text-right text-gray-400 font-medium">الطلاب</th>
                <th className="px-5 py-4 text-right text-gray-400 font-medium">التجديد</th>
                <th className="px-5 py-4 text-right text-gray-400 font-medium">آخر دخول</th>
                <th className="px-5 py-4 text-right text-gray-400 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map((s) => {
                const status = STATUS_LABELS[s.subscription_status] ?? { label: s.subscription_status, cls: "bg-gray-500/20 text-gray-300" };
                return (
                  <tr key={s.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-5 py-4">
                      <div className="text-white font-medium">{s.name}</div>
                      {s.email && <div className="text-gray-500 text-xs">{s.email}</div>}
                    </td>
                    <td className="px-5 py-4 text-gray-300">{s.plan?.name ?? "—"}</td>
                    <td className="px-5 py-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${status.cls}`}>{status.label}</span>
                    </td>
                    <td className="px-5 py-4 text-gray-300">{s.studentCount}</td>
                    <td className="px-5 py-4 text-gray-300">
                      {s.renewal_date ? new Date(s.renewal_date).toLocaleDateString("ar-SA") : "—"}
                    </td>
                    <td className="px-5 py-4 text-gray-300">
                      {s.last_login_at ? new Date(s.last_login_at).toLocaleDateString("ar-SA") : "—"}
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/admin/schools/${s.id}`} className="text-indigo-400 hover:text-indigo-300 text-xs font-medium">
                        عرض
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-gray-500">لا توجد نتائج</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
