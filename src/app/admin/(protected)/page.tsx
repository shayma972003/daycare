"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import Link from "next/link";

interface OverviewData {
  stats: {
    totalActiveSchools: number;
    totalStudents: number;
    mrr: number;
    newSchoolsThisMonth: number;
    cancelledThisMonth: number;
  };
  alerts: { schoolId: string; schoolName: string; type: string; detail: string }[];
  recentLogs: {
    id: string;
    action: string;
    schoolName: string | null;
    metadata: unknown;
    performedBy: string;
    performedAt: string;
  }[];
}

const ALERT_LABELS: Record<string, string> = {
  no_login: "عدم دخول",
  renewal_soon: "تجديد قريب",
  expired: "منتهٍ",
  plan_limit: "تجاوز الحد",
};

const ACTION_LABELS: Record<string, string> = {
  school_registered: "تسجيل مدرسة",
  school_suspended: "إيقاف مدرسة",
  school_reactivated: "تفعيل مدرسة",
  school_deleted: "حذف مدرسة",
  plan_changed: "تغيير خطة",
  renewal_extended: "تجديد اشتراك",
  message_sent: "إرسال رسالة",
  alert_triggered: "تنبيه تلقائي",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "الآن";
  if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  return `منذ ${Math.floor(h / 24)} يوم`;
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get<OverviewData>("/api/admin/overview")
      .then((r) => setData(r.data))
      // Without this a failed load left "جاري التحميل..." on screen forever.
      .catch((err) => setError(describeApiError(err, "فشل تحميل لوحة المعلومات")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-gray-400 text-sm">جاري التحميل...</div>
    );
  }

  // `return null` on failure rendered a blank page with no explanation.
  if (!data) {
    return (
      <div className="p-8">
        <div
          role="alert"
          className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300"
        >
          {error ?? "تعذر تحميل البيانات"}
        </div>
      </div>
    );
  }

  const { stats, alerts, recentLogs } = data;

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">الرئيسية</h1>
        <p className="text-gray-400 text-sm mt-1">نظرة عامة على النظام</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: "المدارس النشطة", value: stats.totalActiveSchools, color: "text-indigo-400" },
          { label: "إجمالي الطلاب", value: stats.totalStudents, color: "text-emerald-400" },
          { label: "الإيرادات الشهرية", value: `${stats.mrr.toLocaleString("ar-SA")} ر.س`, color: "text-yellow-400" },
          { label: "مدارس جديدة", value: stats.newSchoolsThisMonth, color: "text-blue-400" },
          { label: "ألغت هذا الشهر", value: stats.cancelledThisMonth, color: "text-red-400" },
        ].map((card) => (
          <div key={card.label} className="bg-[#1e1e2e] rounded-2xl p-5 border border-white/5">
            <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
            <div className="text-gray-400 text-xs mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Alerts Panel */}
        <div className="col-span-1 bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
          <div className="p-5 border-b border-white/5">
            <h2 className="text-white font-semibold text-sm">التنبيهات</h2>
            <p className="text-gray-500 text-xs mt-0.5">{alerts.length} تنبيه نشط</p>
          </div>
          <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
            {alerts.length === 0 && (
              <div className="p-5 text-gray-500 text-sm text-center">لا توجد تنبيهات</div>
            )}
            {alerts.map((a, i) => (
              <div key={i} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-white text-sm font-medium">{a.schoolName}</div>
                    <div className="text-gray-400 text-xs mt-0.5">{a.detail}</div>
                  </div>
                  <span className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full shrink-0">
                    {ALERT_LABELS[a.type] ?? a.type}
                  </span>
                </div>
                <Link
                  href={`/admin/schools/${a.schoolId}`}
                  className="mt-2 text-xs text-indigo-400 hover:text-indigo-300"
                >
                  عرض المدرسة ←
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="col-span-2 bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
          <div className="p-5 border-b border-white/5">
            <h2 className="text-white font-semibold text-sm">آخر النشاطات</h2>
          </div>
          <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
            {recentLogs.length === 0 && (
              <div className="p-5 text-gray-500 text-sm text-center">لا توجد نشاطات</div>
            )}
            {recentLogs.map((log) => (
              <div key={log.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <span className="text-white text-sm">{ACTION_LABELS[log.action] ?? log.action}</span>
                  {log.schoolName && (
                    <span className="text-gray-400 text-sm"> — {log.schoolName}</span>
                  )}
                </div>
                <span className="text-gray-500 text-xs">{timeAgo(log.performedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
