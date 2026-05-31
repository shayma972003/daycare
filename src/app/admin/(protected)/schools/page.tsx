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

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "bg-emerald-500/20 text-emerald-300" },
  suspended: { label: "موقوف", cls: "bg-orange-500/20 text-orange-300" },
  expired: { label: "منتهٍ", cls: "bg-red-500/20 text-red-300" },
  trial: { label: "تجريبي", cls: "bg-blue-500/20 text-blue-300" },
};

export default function AdminSchoolsPage() {
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">المدارس</h1>
          <p className="text-gray-400 text-sm mt-1">{schools.length} مدرسة مسجلة</p>
        </div>
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
                      <Link
                        href={`/admin/schools/${s.id}`}
                        className="text-indigo-400 hover:text-indigo-300 text-xs font-medium"
                      >
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
