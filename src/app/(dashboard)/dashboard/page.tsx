"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { ActivityGrid, type Activity } from "@/components/activities/ActivityGrid";
import { ActivityFormModal } from "@/components/activities/ActivityFormModal";
import { DeliveryStatusBadge } from "@/components/ui/StatusBadge";
import { t } from "@/lib/utils";

interface NotificationLog {
  id: string;
  recipientName: string;
  type: "WHATSAPP" | "EMAIL";
  content: string;
  status: "SENT" | "FAILED";
  sentAt: string;
}

type EnrollmentNotif = { id: string; full_name: string; submitted_at: string };

const PAGE_SIZE = 15;

export default function HomePage() {
  const router = useRouter();
  const [currentActivities, setCurrentActivities] = useState<Activity[]>([]);
  const [pastActivities, setPastActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingEnrollments, setPendingEnrollments] = useState<EnrollmentNotif[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);

  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsSkip, setLogsSkip] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingMoreLogs, setLoadingMoreLogs] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingBulk, setDeletingBulk] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState<"" | "SENT" | "FAILED">("");
  const [filterType, setFilterType] = useState<"" | "WHATSAPP" | "EMAIL">("");

  const buildLogsUrl = useCallback(
    (skip: number) => {
      const params = new URLSearchParams();
      params.set("source", "activity");
      params.set("skip", String(skip));
      params.set("take", String(PAGE_SIZE));
      return `/api/notifications?${params.toString()}`;
    },
    []
  );

  const fetchLogs = useCallback(
    async (skip = 0, append = false) => {
      if (skip === 0) setLoadingLogs(true);
      else setLoadingMoreLogs(true);
      try {
        const res = await axios.get<{ logs: NotificationLog[]; total: number }>(
          buildLogsUrl(skip)
        );
        setLogs((prev) => (append ? [...prev, ...res.data.logs] : res.data.logs));
        setLogsTotal(res.data.total);
        setLogsSkip(skip + res.data.logs.length);
      } catch { /* silent */ }
      finally {
        setLoadingLogs(false);
        setLoadingMoreLogs(false);
      }
    },
    [buildLogsUrl]
  );

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [currentRes, pastRes] = await Promise.all([
        axios.get<Activity[]>("/api/activities?dateFilter=current"),
        axios.get<Activity[]>("/api/activities?dateFilter=past"),
      ]);
      setCurrentActivities(currentRes.data);
      setPastActivities(pastRes.data);
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);
  useEffect(() => { fetchLogs(0, false); }, [fetchLogs]);
  useEffect(() => {
    axios.get<EnrollmentNotif[]>("/api/enrollment/submissions")
      .then((r) => setPendingEnrollments(r.data))
      .catch(() => {});
  }, []);

  const openAddModal = () => { setSelectedActivity(null); setModalOpen(true); };
  const openEditModal = (activity: Activity) => { setSelectedActivity(activity); setModalOpen(true); };
  const handleModalClose = () => { setModalOpen(false); setSelectedActivity(null); };
  const handleSaved = () => { fetchActivities(); };

  async function handleDeleteOne(id: string) {
    setDeletingId(id);
    try {
      await axios.delete(`/api/notifications/log/${id}`);
      setLogs((prev) => prev.filter((l) => l.id !== id));
      setLogsTotal((t) => t - 1);
    } catch { /* silent */ }
    finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  async function handleDeleteBulk() {
    setDeletingBulk(true);
    try {
      await axios.delete(`/api/notifications/log/bulk?source=activity`);
      setLogs([]);
      setLogsTotal(0);
      setLogsSkip(0);
    } catch { /* silent */ }
    finally {
      setDeletingBulk(false);
      setConfirmBulkDelete(false);
    }
  }

  // Client-side filter
  const visibleLogs = logs.filter((log) => {
    if (filterStatus && log.status !== filterStatus) return false;
    if (filterType && log.type !== filterType) return false;
    return true;
  });

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title={t("home.title")} />

      {/* Confirm delete one */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 text-center space-y-4">
            <p className="text-sm font-medium text-[#111111]">هل تريد حذف هذا السجل؟</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => handleDeleteOne(confirmDeleteId)}
                disabled={!!deletingId}
                className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60"
              >
                {deletingId ? "..." : "حذف"}
              </button>
              <button onClick={() => setConfirmDeleteId(null)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm bulk delete */}
      {confirmBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
            <p className="text-sm font-medium text-[#111111]">هل تريد حذف جميع سجلات إشعارات الفعاليات؟</p>
            <p className="text-xs text-red-500">لا يمكن التراجع عن هذا الإجراء</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleDeleteBulk}
                disabled={deletingBulk}
                className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60"
              >
                {deletingBulk ? "..." : "مسح الكل"}
              </button>
              <button onClick={() => setConfirmBulkDelete(false)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 space-y-8">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        )}

        {/* ── طلبات التسجيل المعلقة ── */}
        {pendingEnrollments.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-amber-400 flex items-center justify-center text-white font-bold text-sm">
                  {pendingEnrollments.length}
                </span>
                <div>
                  <p className="text-sm font-bold text-[#111111]">طلبات تسجيل جديدة تنتظر المراجعة</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    آخر طلب: {pendingEnrollments[0]?.full_name} —{" "}
                    {new Date(pendingEnrollments[0]?.submitted_at).toLocaleString("ar-SA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
              <button
                onClick={() => router.push("/students")}
                className="px-4 py-2 bg-[#111111] text-white rounded-xl text-sm font-medium hover:bg-[#2a3460] transition-colors"
              >
                مراجعة الطلبات
              </button>
            </div>
            {pendingEnrollments.length > 1 && (
              <div className="mt-3 space-y-1.5">
                {pendingEnrollments.slice(0, 5).map((e) => (
                  <div key={e.id} className="flex items-center justify-between text-xs text-gray-600 bg-white/60 rounded-lg px-3 py-1.5">
                    <span className="font-medium">{e.full_name}</span>
                    <span className="text-gray-400">
                      {new Date(e.submitted_at).toLocaleString("ar-SA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
                {pendingEnrollments.length > 5 && (
                  <p className="text-xs text-gray-400 text-center pt-1">و {pendingEnrollments.length - 5} طلبات أخرى...</p>
                )}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-[#F64651] rounded-full animate-spin" />
              <span className="text-sm">{t("common.loading")}</span>
            </div>
          </div>
        ) : (
          <>
            <section>
              <h2 className="text-base font-bold text-[#111111] mb-4">{t("home.currentActivities")}</h2>
              <ActivityGrid activities={currentActivities} onAdd={openAddModal} onSelect={openEditModal} />
            </section>

            <section>
              <h2 className="text-base font-bold text-[#111111] mb-4">{t("home.pastActivities")}</h2>
              {pastActivities.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">{t("common.noData")}</p>
              ) : (
                <ActivityGrid activities={pastActivities} onAdd={openAddModal} onSelect={openEditModal} />
              )}
            </section>

            {/* ── سجل إشعارات الفعاليات ─────────────────────────────── */}
            <section>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h2 className="text-base font-bold text-[#111111]">سجل إشعارات الفعاليات</h2>
                <div className="flex flex-wrap gap-2 items-center">
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as "" | "SENT" | "FAILED")}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none"
                  >
                    <option value="">كل الحالات</option>
                    <option value="SENT">تم الإرسال</option>
                    <option value="FAILED">فشل</option>
                  </select>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as "" | "WHATSAPP" | "EMAIL")}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none"
                  >
                    <option value="">كل الأنواع</option>
                    <option value="WHATSAPP">واتساب</option>
                    <option value="EMAIL">بريد</option>
                  </select>
                  {logs.length > 0 && (
                    <button
                      onClick={() => setConfirmBulkDelete(true)}
                      className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-xl hover:bg-red-50 transition-all"
                    >
                      مسح الكل
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-md overflow-hidden">
                {loadingLogs ? (
                  <div className="flex items-center justify-center py-10 text-gray-400 text-sm gap-2">
                    <div className="w-5 h-5 border-2 border-gray-200 border-t-[#F64651] rounded-full animate-spin" />
                    {t("common.loading")}
                  </div>
                ) : visibleLogs.length === 0 ? (
                  <div className="py-10 text-center text-sm text-gray-400">{t("common.noData")}</div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50">
                            <th className="px-4 py-3 text-right font-medium text-gray-600">المستلم</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">النوع</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">المحتوى</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">وقت الإرسال</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">الحالة</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {visibleLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                              <td className="px-4 py-3 font-medium text-[#111111]">{log.recipientName}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${log.type === "WHATSAPP" ? "bg-success-bg text-success-text" : "bg-blue-50 text-blue-700"}`}>
                                  {log.type === "WHATSAPP" ? "واتساب" : "بريد"}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-600 max-w-xs">
                                <span title={log.content}>{log.content.length > 60 ? log.content.slice(0, 60) + "…" : log.content}</span>
                              </td>
                              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                {new Date(log.sentAt).toLocaleString("ar-SA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </td>
                              <td className="px-4 py-3"><DeliveryStatusBadge status={log.status} /></td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => setConfirmDeleteId(log.id)}
                                  className="text-gray-400 hover:text-red-500 transition-colors text-base"
                                  title="حذف"
                                >
                                  🗑
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {logs.length < logsTotal && (
                      <div className="px-4 py-3 border-t border-gray-50 text-center">
                        <button
                          onClick={() => fetchLogs(logsSkip, true)}
                          disabled={loadingMoreLogs}
                          className="px-6 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium transition-all disabled:opacity-60"
                        >
                          {loadingMoreLogs ? t("common.loading") : `عرض المزيد (${logsTotal - logs.length} متبقي)`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      <ActivityFormModal open={modalOpen} onClose={handleModalClose} activity={selectedActivity} onSaved={handleSaved} />
    </div>
  );
}
