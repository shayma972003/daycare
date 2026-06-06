"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
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

const PAGE_SIZE = 15;

export default function HomePage() {
  const [currentActivities, setCurrentActivities] = useState<Activity[]>([]);
  const [pastActivities, setPastActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);

  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsSkip, setLogsSkip] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingMoreLogs, setLoadingMoreLogs] = useState(false);

  // Filters for the notification log
  const [filterStatus, setFilterStatus] = useState<"" | "SENT" | "FAILED">("");
  const [filterType, setFilterType] = useState<"" | "WHATSAPP" | "EMAIL">("");

  const buildLogsUrl = useCallback(
    (skip: number) => {
      const params = new URLSearchParams();
      params.set("source", "activity");
      params.set("skip", String(skip));
      params.set("take", String(PAGE_SIZE));
      if (filterStatus) params.set("status", filterStatus);
      if (filterType) params.set("channel", filterType);
      return `/api/notifications?${params.toString()}`;
    },
    [filterStatus, filterType]
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

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Re-fetch logs when filters change (reset to page 0)
  useEffect(() => {
    fetchLogs(0, false);
  }, [fetchLogs]);

  const openAddModal = () => {
    setSelectedActivity(null);
    setModalOpen(true);
  };

  const openEditModal = (activity: Activity) => {
    setSelectedActivity(activity);
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setSelectedActivity(null);
  };

  const handleSaved = () => {
    fetchActivities();
  };

  // Client-side filter on already-loaded logs (status + type)
  const visibleLogs = logs.filter((log) => {
    if (filterStatus && log.status !== filterStatus) return false;
    if (filterType && log.type !== filterType) return false;
    return true;
  });

  return (
    <div dir="rtl" className="min-h-screen bg-[#f4f6fb]">
      <Topbar title={t("home.title")} />

      <div className="p-6 space-y-8">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-[#22c55e] rounded-full animate-spin" />
              <span className="text-sm">{t("common.loading")}</span>
            </div>
          </div>
        ) : (
          <>
            <section>
              <h2 className="text-base font-bold text-[#1a2340] mb-4">
                {t("home.currentActivities")}
              </h2>
              <ActivityGrid
                activities={currentActivities}
                onAdd={openAddModal}
                onSelect={openEditModal}
              />
            </section>

            <section>
              <h2 className="text-base font-bold text-[#1a2340] mb-4">
                {t("home.pastActivities")}
              </h2>
              {pastActivities.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">
                  {t("common.noData")}
                </p>
              ) : (
                <ActivityGrid
                  activities={pastActivities}
                  onAdd={openAddModal}
                  onSelect={openEditModal}
                />
              )}
            </section>

            {/* ── سجل إشعارات الفعاليات ─────────────────────────────── */}
            <section>
              <h2 className="text-base font-bold text-[#1a2340] mb-4">سجل إشعارات الفعاليات</h2>

              {/* Filters */}
              <div className="flex flex-wrap gap-3 mb-3">
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as "" | "SENT" | "FAILED")}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#22c55e]"
                >
                  <option value="">كل الحالات</option>
                  <option value="SENT">تم الإرسال</option>
                  <option value="FAILED">فشل</option>
                </select>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as "" | "WHATSAPP" | "EMAIL")}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#22c55e]"
                >
                  <option value="">كل الأنواع</option>
                  <option value="WHATSAPP">واتساب</option>
                  <option value="EMAIL">بريد</option>
                </select>
              </div>

              <div className="bg-white rounded-xl shadow-md overflow-hidden">
                {loadingLogs ? (
                  <div className="flex items-center justify-center py-10 text-gray-400 text-sm gap-2">
                    <div className="w-5 h-5 border-2 border-gray-200 border-t-[#22c55e] rounded-full animate-spin" />
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
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {visibleLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                              <td className="px-4 py-3 font-medium text-[#1a2340]">{log.recipientName}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  log.type === "WHATSAPP"
                                    ? "bg-green-50 text-green-700"
                                    : "bg-blue-50 text-blue-700"
                                }`}>
                                  {log.type === "WHATSAPP" ? "واتساب" : "بريد"}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-600 max-w-xs">
                                <span title={log.content}>
                                  {log.content.length > 60 ? log.content.slice(0, 60) + "…" : log.content}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                {new Date(log.sentAt).toLocaleString("ar-SA", {
                                  year: "numeric", month: "2-digit", day: "2-digit",
                                  hour: "2-digit", minute: "2-digit",
                                })}
                              </td>
                              <td className="px-4 py-3">
                                <DeliveryStatusBadge status={log.status} />
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

      <ActivityFormModal
        open={modalOpen}
        onClose={handleModalClose}
        activity={selectedActivity}
        onSaved={handleSaved}
      />
    </div>
  );
}
