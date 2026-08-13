"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { ActivityGrid, type Activity } from "@/components/activities/ActivityGrid";
import { AttendanceDonut } from "@/components/attendance/AttendanceDonut";
import { ActivityFormModal } from "@/components/activities/ActivityFormModal";
import { DeliveryStatusBadge } from "@/components/ui/StatusBadge";
import { useT, useLocale } from "@/lib/i18n-provider";
import { formatAst } from "@/lib/datetime";
import { SetupChecklist } from "@/components/dashboard/SetupChecklist";
import { TodayTasks, useDashboardTasks } from "@/components/dashboard/TodayTasks";
import { usePermissions } from "@/lib/use-permissions";
import { ENROLLMENT_MANAGE_PERMISSION } from "@/lib/enrollment-access";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { DataErrorState, RefreshIndicator } from "@/components/ui/DataLoadState";
import { collectionView, type CollectionStatus } from "@/lib/collection-state";
import { LatestRequest } from "@/lib/latest-request";
import { describeApiError } from "@/lib/api-error";


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

function buildLogsUrl(skip: number) {
  const params = new URLSearchParams();
  params.set("source", "activity");
  params.set("skip", String(skip));
  params.set("take", String(PAGE_SIZE));
  return `/api/notifications?${params.toString()}`;
}

export default function HomePage() {
  const { locale } = useLocale();
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const router = useRouter();
  const { can } = usePermissions();
  const canManageEnrollment = can(ENROLLMENT_MANAGE_PERMISSION);
  const canViewDeliveryLogs = can("settings.manage");
  // One request covers both the checklist and the task list.
  const { tasks, setup, loading: tasksLoading } = useDashboardTasks();
  const [currentActivities, setCurrentActivities] = useState<Activity[]>([]);
  const [pastActivities, setPastActivities] = useState<Activity[]>([]);
  const [activityStatus, setActivityStatus] = useState<CollectionStatus>("loading");
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityRefresh, setActivityRefresh] = useState(0);
  const [activityRequests] = useState(() => new LatestRequest());
  const [pendingEnrollments, setPendingEnrollments] = useState<EnrollmentNotif[]>([]);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);

  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsSkip, setLogsSkip] = useState(0);
  const [logStatus, setLogStatus] = useState<CollectionStatus>("loading");
  const [logError, setLogError] = useState<string | null>(null);
  const [logRefresh, setLogRefresh] = useState(0);
  const [logRequests] = useState(() => new LatestRequest());
  const [moreLogRequests] = useState(() => new LatestRequest());
  const [loadingMoreLogs, setLoadingMoreLogs] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingBulk, setDeletingBulk] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState<"" | "SENT" | "FAILED">("");
  const [filterType, setFilterType] = useState<"" | "EMAIL">("");

  useEffect(() => {
    const ticket = activityRequests.begin();
    Promise.all([
      axios.get<Activity[]>("/api/activities?dateFilter=current", { signal: ticket.signal }),
      axios.get<Activity[]>("/api/activities?dateFilter=past", { signal: ticket.signal }),
    ])
      .then(([currentRes, pastRes]) => {
        ticket.commit(() => {
          setCurrentActivities(currentRes.data);
          setPastActivities(pastRes.data);
          setActivityError(null);
          setActivityStatus("ready");
        });
      })
      .catch((requestError: unknown) => {
        if (axios.isCancel(requestError)) return;
        ticket.commit(() => {
          setActivityError(describeApiError(requestError, t("common.error")));
          setActivityStatus("error");
        });
      });
    return ticket.cancel;
  }, [activityRefresh, activityRequests, t]);

  useEffect(() => {
    if (!canViewDeliveryLogs) return;
    const ticket = logRequests.begin();
    axios
      .get<{ logs: NotificationLog[]; total: number }>(buildLogsUrl(0), { signal: ticket.signal })
      .then((res) => {
        ticket.commit(() => {
          setLogs(res.data.logs);
          setLogsTotal(res.data.total);
          setLogsSkip(res.data.logs.length);
          setLogError(null);
          setLogStatus("ready");
        });
      })
      .catch((requestError: unknown) => {
        if (axios.isCancel(requestError)) return;
        ticket.commit(() => {
          setLogError(describeApiError(requestError, t("common.error")));
          setLogStatus("error");
        });
      });
    return ticket.cancel;
  }, [canViewDeliveryLogs, logRefresh, logRequests, t]);

  useEffect(() => {
    if (!canManageEnrollment) return;
    const controller = new AbortController();
    axios.get<EnrollmentNotif[]>("/api/enrollment/submissions", { signal: controller.signal })
      .then((r) => {
        setPendingEnrollments(r.data);
        setEnrollmentError(null);
      })
      .catch((requestError: unknown) => {
        if (!axios.isCancel(requestError)) {
          setEnrollmentError(describeApiError(requestError, t("common.error")));
        }
      });
    return () => controller.abort();
  }, [canManageEnrollment, t]);

  const openAddModal = () => { setSelectedActivity(null); setModalOpen(true); };
  const openEditModal = (activity: Activity) => { setSelectedActivity(activity); setModalOpen(true); };
  const handleModalClose = () => { setModalOpen(false); setSelectedActivity(null); };
  const handleSaved = () => {
    setActivityStatus(currentActivities.length + pastActivities.length > 0 ? "refreshing" : "loading");
    setActivityError(null);
    setActivityRefresh((value) => value + 1);
  };

  function retryActivities() {
    setActivityStatus(currentActivities.length + pastActivities.length > 0 ? "refreshing" : "loading");
    setActivityError(null);
    setActivityRefresh((value) => value + 1);
  }

  function retryLogs() {
    setLogStatus(logs.length > 0 ? "refreshing" : "loading");
    setLogError(null);
    setLogRefresh((value) => value + 1);
  }

  async function loadMoreLogs() {
    const ticket = moreLogRequests.begin();
    setLoadingMoreLogs(true);
    setLogError(null);
    try {
      const res = await axios.get<{ logs: NotificationLog[]; total: number }>(buildLogsUrl(logsSkip), {
        signal: ticket.signal,
      });
      ticket.commit(() => {
        setLogs((previous) => [...previous, ...res.data.logs]);
        setLogsTotal(res.data.total);
        setLogsSkip((skip) => skip + res.data.logs.length);
      });
    } catch (requestError) {
      if (!axios.isCancel(requestError)) {
        ticket.commit(() => setLogError(describeApiError(requestError, t("common.error"))));
      }
    } finally {
      ticket.commit(() => setLoadingMoreLogs(false));
    }
  }

  async function handleDeleteOne(id: string) {
    setDeletingId(id);
    try {
      await axios.delete(`/api/notifications/log/${id}`);
      setLogs((prev) => prev.filter((l) => l.id !== id));
      setLogsTotal((t) => t - 1);
    } catch (requestError) {
      setLogError(describeApiError(requestError, t("common.error")));
    }
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
    } catch (requestError) {
      setLogError(describeApiError(requestError, t("common.error")));
    }
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
  const activityView = collectionView(activityStatus, currentActivities.length + pastActivities.length);
  const logView = collectionView(logStatus, logs.length);

  return (
    <div className="min-h-screen bg-brand-bg">
      <Topbar title={t("home.title")} />

      {/* Confirm delete one */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 text-center space-y-4">
            <p className="text-sm font-medium text-[#111111]">{t("home.confirmDeleteLog")}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => handleDeleteOne(confirmDeleteId)}
                disabled={!!deletingId}
                className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60"
              >
                {deletingId ? "..." : t("common.delete")}
              </button>
              <button onClick={() => setConfirmDeleteId(null)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm bulk delete */}
      {confirmBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
            <p className="text-sm font-medium text-[#111111]">{t("home.confirmClearLogs")}</p>
            <p className="text-xs text-red-500">{t("home.cannotBeUndone")}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleDeleteBulk}
                disabled={deletingBulk}
                className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60"
              >
                {deletingBulk ? "..." : t("home.clearAll")}
              </button>
              <button onClick={() => setConfirmBulkDelete(false)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-8 p-3 sm:p-4 lg:p-6">
        {/* Setup first, and only while it is unfinished — a school still filling
            in its rooms has nothing useful in the task list below yet. */}
        {setup && <SetupChecklist steps={setup.steps} />}

        <section className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6 space-y-3">
          <h2 className="font-bold text-[#111111]">{t("todo.title")}</h2>
          <TodayTasks tasks={tasks} loading={tasksLoading} />
        </section>

        {/* ── طلبات التسجيل المعلقة ── */}
        <PermissionGate permission={ENROLLMENT_MANAGE_PERMISSION}>
        {enrollmentError && (
          <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {enrollmentError}
          </div>
        )}
        {pendingEnrollments.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-amber-400 flex items-center justify-center text-white font-bold text-sm">
                  {pendingEnrollments.length}
                </span>
                <div>
                  <p className="text-sm font-bold text-[#111111]">{t("home.pendingEnrollments")}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t("home.latestRequest")}: {pendingEnrollments[0]?.full_name} —{" "}
                    {formatAst(new Date(pendingEnrollments[0]?.submitted_at), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }, locale)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => router.push("/students")}
                className="px-4 py-2 bg-[#111111] text-white rounded-xl text-sm font-medium hover:bg-[#2a3460] transition-colors"
              >
                {t("home.reviewRequests")}
              </button>
            </div>
            {pendingEnrollments.length > 1 && (
              <div className="mt-3 space-y-1.5">
                {pendingEnrollments.slice(0, 5).map((e) => (
                  <div key={e.id} className="flex items-center justify-between text-xs text-gray-600 bg-white/60 rounded-lg px-3 py-1.5">
                    <span className="font-medium">{e.full_name}</span>
                    <span className="text-gray-400">
                      {formatAst(new Date(e.submitted_at), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }, locale)}
                    </span>
                  </div>
                ))}
                {pendingEnrollments.length > 5 && (
                  <p className="text-xs text-gray-400 text-center pt-1">{t("home.andMoreRequests", { count: pendingEnrollments.length - 5 })}</p>
                )}
              </div>
            )}
          </div>
        )}
        </PermissionGate>

        <section className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-base font-bold text-[#111111] mb-2">{t("home.todayAttendance")}</h2>
          <AttendanceDonut />
        </section>

        {activityStatus === "refreshing" && <RefreshIndicator label={t("common.loading")} />}
        {activityError && activityView === "content" && (
          <DataErrorState message={activityError} retryLabel={t("common.retry")} onRetry={retryActivities} />
        )}
        {activityView === "loading" ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-[#F64651] rounded-full animate-spin" />
              <span className="text-sm">{t("common.loading")}</span>
            </div>
          </div>
        ) : activityView === "error" ? (
          <DataErrorState
            message={activityError ?? t("common.error")}
            retryLabel={t("common.retry")}
            onRetry={retryActivities}
          />
        ) : (
          <>
            {/* Today's register at a glance — task 2.17. Above the activities
                because "who is in the building" is the first question of the
                day, every day. */}
            <section>
              <h2 className="text-base font-bold text-[#111111] mb-4">{t("home.currentActivities")}</h2>
              {currentActivities.length === 0 && (
                <p className="text-sm text-gray-400 py-6 text-center">{t("common.noData")}</p>
              )}
              <ActivityGrid activities={currentActivities} onAdd={openAddModal} onSelect={openEditModal} />
            </section>

            <section>
              <h2 className="text-base font-bold text-[#111111] mb-4">{t("home.pastActivities")}</h2>
              {pastActivities.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">{t("common.noData")}</p>
              ) : (
                <ActivityGrid activities={pastActivities} onSelect={openEditModal} />
              )}
            </section>
          </>
        )}

            {/* ── سجل إشعارات الفعاليات ─────────────────────────────── */}
            <PermissionGate permission="settings.manage">
            <section>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h2 className="text-base font-bold text-[#111111]">{t("home.activityLog")}</h2>
                <div className="flex flex-wrap gap-2 items-center">
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as "" | "SENT" | "FAILED")}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none"
                  >
                    <option value="">{t("home.allStatuses")}</option>
                    <option value="SENT">{t("home.sent")}</option>
                    <option value="FAILED">{t("home.failed")}</option>
                  </select>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as "" | "EMAIL")}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none"
                  >
                    <option value="">{t("home.allTypes")}</option>
                    <option value="EMAIL">{t("home.email")}</option>
                  </select>
                  {logs.length > 0 && (
                    <button
                      onClick={() => setConfirmBulkDelete(true)}
                      className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-xl hover:bg-red-50 transition-all"
                    >
                      {t("common.clearAll")}
                    </button>
                  )}
                </div>
              </div>

              {logStatus === "refreshing" && <RefreshIndicator label={t("common.loading")} />}
              {logError && logView === "content" && (
                <DataErrorState message={logError} retryLabel={t("common.retry")} onRetry={retryLogs} />
              )}
              <div className="bg-white rounded-xl shadow-md overflow-hidden">
                {logView === "loading" ? (
                  <div className="flex items-center justify-center py-10 text-gray-400 text-sm gap-2">
                    <div className="w-5 h-5 border-2 border-gray-200 border-t-[#F64651] rounded-full animate-spin" />
                    {t("common.loading")}
                  </div>
                ) : logView === "error" ? (
                  <DataErrorState
                    message={logError ?? t("common.error")}
                    retryLabel={t("common.retry")}
                    onRetry={retryLogs}
                  />
                ) : visibleLogs.length === 0 ? (
                  <div className="py-10 text-center text-sm text-gray-400">{t("common.noData")}</div>
                ) : (
                  <>
                    <div role="region" aria-label={t("home.activityLog")} tabIndex={0} className="max-w-full overflow-x-auto">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50">
                            <th className="px-4 py-3 text-start font-medium text-gray-600">{t("home.recipient")}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600">{t("home.type")}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600">{t("home.content")}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 whitespace-nowrap">{t("home.sentAt")}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600">{t("home.status")}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {visibleLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                              <td className="px-4 py-3 font-medium text-[#111111]">{log.recipientName}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${log.type === "WHATSAPP" ? "bg-gray-100 text-gray-600" : "bg-blue-50 text-blue-700"}`}>
                                  {t(`notificationType.${log.type}`)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-600 max-w-xs">
                                <span title={log.content}>{log.content.length > 60 ? log.content.slice(0, 60) + "…" : log.content}</span>
                              </td>
                              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                {formatAst(new Date(log.sentAt), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }, locale)}
                              </td>
                              <td className="px-4 py-3"><DeliveryStatusBadge status={log.status} /></td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => setConfirmDeleteId(log.id)}
                                  className="text-gray-400 hover:text-red-500 transition-colors text-base"
                                  title={t("common.delete")}
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
                          onClick={loadMoreLogs}
                          disabled={loadingMoreLogs}
                          className="px-6 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium transition-all disabled:opacity-60"
                        >
                          {loadingMoreLogs ? t("common.loading") : t("home.showMore", { count: logsTotal - logs.length })}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
            </PermissionGate>
      </div>

      <ActivityFormModal open={modalOpen} onClose={handleModalClose} activity={selectedActivity} onSaved={handleSaved} />
    </div>
  );
}
