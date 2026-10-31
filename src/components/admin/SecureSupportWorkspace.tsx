"use client";

import axios from "axios";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { describeApiError } from "@/lib/api-error";
import type { SupportPreviewView } from "@/lib/support-access";

interface AccessData {
  access: { id: string; reason: string; createdAt: string; expiresAt: string; ticket: { id: string; reference: string; title: string } | null };
  school: { id: string; name: string; plan: string; subscription_status: string; renewal_date: string | null; last_login_at: string | null; settings: { careReportReviewRequired: boolean } | null };
  summary: {
    activeStudents: number;
    activeTeachers: number;
    activeClasses: number;
    activeGuardians: number;
    staff: { total: number; disabled: number; pending: number };
    devices: { total: number; failed: number };
    pendingCareReports: number;
    arrivalRecipients: number;
    failedPushLast30Days: number;
  };
  recentLogs: Array<{ id: string; action: string; performed_by: string; performed_at: string }>;
  restrictions: { readOnly: boolean; sensitiveHealthHidden: boolean; personalRecordsHidden: boolean; writesAllowed: boolean };
}

interface PreviewData {
  view: SupportPreviewView;
  auditedAt: string;
  sections: Array<{
    title: string;
    description?: string;
    metrics: Array<{ label: string; value: string | number; tone?: "default" | "success" | "warning" | "danger" }>;
  }>;
}

const PREVIEW_TABS: Array<{ id: SupportPreviewView; label: string }> = [
  { id: "overview", label: "الملخص" },
  { id: "attendance", label: "الحضور" },
  { id: "calendar", label: "التقويم" },
  { id: "finance", label: "المالية" },
  { id: "accounts", label: "الحسابات" },
  { id: "settings", label: "الإعدادات" },
];

const TONE_CLASSES = {
  default: "text-indigo-300",
  success: "text-emerald-300",
  warning: "text-amber-300",
  danger: "text-red-300",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(value));
}

export default function SecureSupportWorkspace() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [expired, setExpired] = useState(false);
  const [view, setView] = useState<SupportPreviewView>("overview");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [toolReason, setToolReason] = useState("");
  const [toolConfirmed, setToolConfirmed] = useState(false);
  const [toolRunning, setToolRunning] = useState(false);
  const [toolMessage, setToolMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    axios
      .get<AccessData>(`/api/admin/support-access/${params.id}`)
      .then((response) => {
        if (active) setData(response.data);
      })
      .catch((loadError) => {
        if (active) setError(describeApiError(loadError, "تعذر فتح جلسة الدعم"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [params.id]);

  useEffect(() => {
    if (!data) return;
    const update = () => {
      const milliseconds = new Date(data.access.expiresAt).getTime() - Date.now();
      setExpired(milliseconds <= 0);
      setRemaining(Math.max(0, Math.ceil(milliseconds / 60000)));
    };
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, [data]);

  useEffect(() => {
    if (!data || expired) return;
    let active = true;
    axios
      .get<PreviewData>(`/api/admin/support-access/${params.id}/preview`, { params: { view } })
      .then((response) => {
        if (active) setPreview(response.data);
      })
      .catch((loadError) => {
        if (active) setPreviewError(describeApiError(loadError, "تعذر تحميل قسم المعاينة"));
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [data, expired, params.id, view]);

  async function endSession() {
    setEnding(true);
    try {
      await axios.patch(`/api/admin/support-access/${params.id}`);
      router.push("/admin/support");
    } catch (endError) {
      setError(describeApiError(endError, "تعذر إنهاء جلسة الدعم"));
      setEnding(false);
    }
  }

  async function enterTenantAccount() {
    setEntering(true);
    setError(null);
    try {
      const response = await axios.post<{ redirectTo: string }>(`/api/admin/support-access/${params.id}/enter`);
      window.location.assign(response.data.redirectTo);
    } catch (enterError) {
      setError(describeApiError(enterError, "تعذر الدخول المؤقت إلى حساب المنشأة"));
      setEntering(false);
    }
  }

  async function runStorageRefresh() {
    setToolRunning(true);
    setToolMessage(null);
    try {
      await axios.post(`/api/admin/support-access/${params.id}/actions`, {
        action: "REFRESH_STORAGE_USAGE",
        reason: toolReason,
        confirmed: toolConfirmed,
      });
      setToolMessage("تم تحديث حساب مساحة التخزين وتسجيل السبب والإجراء.");
      setToolReason("");
      setToolConfirmed(false);
    } catch (toolError) {
      setToolMessage(describeApiError(toolError, "تعذر تنفيذ أداة الدعم"));
    } finally {
      setToolRunning(false);
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">جاري فتح مساحة الدعم الآمنة...</div>;
  if (!data) return <div className="p-8"><div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error ?? "جلسة الدعم غير متاحة"}</div></div>;

  const { school, summary } = data;
  const toolReady = !expired && toolConfirmed && toolReason.trim().length >= 10 && !toolRunning;
  return (
    <div className="space-y-6 p-8">
      <section className="sticky top-0 z-20 rounded-2xl border border-amber-400/40 bg-[#3a2d12]/95 p-5 shadow-xl backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-amber-200">الدعم الفني يشاهد حساب المنشأة — قراءة فقط</div>
            <h1 className="mt-1 text-2xl font-bold text-white">{school.name}</h1>
            <p className="mt-2 text-xs leading-5 text-amber-100/70">السبب: {data.access.reason}</p>
            <p className="mt-1 text-[11px] text-amber-100/60">كل قسم يتم فتحه وكل أداة يتم تشغيلها تُسجل باسم مسؤول الدعم.</p>
          </div>
          <div className="text-left">
            <div className={`text-sm ${expired ? "text-red-300" : "text-amber-200"}`}>{expired ? "انتهت الجلسة" : `متبقي نحو ${remaining} دقيقة`}</div>
            <div className="mt-1 text-[11px] text-amber-100/50">تنتهي {formatDate(data.access.expiresAt)}</div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" disabled={expired || entering || ending} onClick={() => void enterTenantAccount()} className="rounded-xl bg-amber-300 px-4 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-200 disabled:opacity-50">{entering ? "جاري الدخول..." : "الدخول إلى حساب المنشأة مؤقتًا"}</button>
              <button type="button" disabled={ending || entering} onClick={() => void endSession()} className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-xs text-red-200 hover:bg-red-500/20 disabled:opacity-50">إنهاء الجلسة</button>
            </div>
          </div>
        </div>
      </section>

      {(error || expired) && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error ?? "انتهت مدة المعاينة. ابدئي جلسة دعم جديدة للمتابعة."}</div>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["الأطفال النشطون", summary.activeStudents], ["المعلمون النشطون", summary.activeTeachers], ["الفصول النشطة", summary.activeClasses], ["حسابات أولياء الأمور", summary.activeGuardians]].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
            <div className="text-2xl font-bold text-indigo-300">{value}</div>
            <div className="mt-1 text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/5 bg-[#1e1e2e]">
        <div className="border-b border-white/5 p-5">
          <h2 className="font-semibold text-white">معاينة المنشأة الآمنة</h2>
          <p className="mt-1 text-xs text-gray-500">تعرض مؤشرات مجمعة فقط. لا تُنشأ جلسة موظف ولا تُعرض سجلات الأشخاص.</p>
        </div>
        <div role="tablist" aria-label="أقسام معاينة المنشأة" className="flex gap-2 overflow-x-auto border-b border-white/5 p-4">
          {PREVIEW_TABS.map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} disabled={expired} onClick={() => { setPreviewLoading(true); setPreviewError(null); setView(tab.id); }} className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs transition ${view === tab.id ? "bg-indigo-500 text-white" : "bg-white/[0.04] text-gray-400 hover:bg-white/[0.08]"} disabled:opacity-40`}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="p-5">
          {previewLoading && <div className="py-10 text-center text-sm text-gray-500">جاري تحميل القسم وتسجيل فتحه...</div>}
          {previewError && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{previewError}</div>}
          {!previewLoading && !previewError && preview && (
            <div className="space-y-4">
              {preview.sections.map((section) => (
                <div key={section.title} className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                  <h3 className="font-semibold text-white">{section.title}</h3>
                  {section.description && <p className="mt-1 text-xs leading-5 text-gray-500">{section.description}</p>}
                  <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
                    {section.metrics.map((metric) => (
                      <div key={metric.label} className="rounded-xl border border-white/5 bg-black/10 p-4">
                        <div className={`text-xl font-bold ${TONE_CLASSES[metric.tone ?? "default"]}`}>{metric.value}</div>
                        <div className="mt-1 text-[11px] text-gray-500">{metric.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-emerald-300">تم تسجيل فتح هذا القسم في سجل الإدارة عند {formatDate(preview.auditedAt)}.</p>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-violet-500/20 bg-[#1e1e2e] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold text-white">أداة الدعم المسموحة</h2><p className="mt-1 text-xs leading-5 text-gray-500">الأداة الوحيدة المتاحة داخل المعاينة هي إعادة حساب مساحة التخزين. لا تعدّل ملفات الأطفال أو بيانات المنشأة.</p></div>
          <span className="rounded-full bg-violet-500/10 px-3 py-1 text-[11px] text-violet-300">تأكيد وسبب إلزاميان</span>
        </div>
        <label className="mt-5 block text-xs text-gray-400" htmlFor="support-tool-reason">سبب تنفيذ الأداة</label>
        <textarea id="support-tool-reason" value={toolReason} disabled={expired || toolRunning} onChange={(event) => setToolReason(event.target.value)} rows={3} placeholder="اكتبي سببًا واضحًا لا يقل عن 10 أحرف..." className="mt-2 w-full rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white outline-none focus:border-violet-400 disabled:opacity-50" />
        <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-gray-300">
          <input type="checkbox" checked={toolConfirmed} disabled={expired || toolRunning} onChange={(event) => setToolConfirmed(event.target.checked)} className="mt-1" />
          أؤكد تنفيذ إعادة حساب مساحة التخزين للمنشأة، وأفهم أن السبب والنتيجة سيُسجلان في سجل الإدارة.
        </label>
        <button type="button" disabled={!toolReady} onClick={() => void runStorageRefresh()} className="mt-4 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">{toolRunning ? "جاري التنفيذ..." : "تحديث حساب مساحة التخزين"}</button>
        {toolMessage && <div role="status" className="mt-3 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-xs text-gray-300">{toolMessage}</div>}
      </section>

      <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs leading-6 text-emerald-200">
        الجلسة قراءة فقط افتراضيًا ولا تعرض أسماء الأطفال أو أولياء الأمور أو البيانات الصحية أو الحساسة. لا يوجد تعديل عام؛ فقط أداة الدعم المحددة أعلاه بعد التأكيد وكتابة السبب.
      </section>
    </div>
  );
}
