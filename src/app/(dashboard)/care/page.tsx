"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import {
  UnifiedDailyCareForm,
  type DailyCareStudent,
  type ReturnedDailyCareDraft,
} from "@/components/care/UnifiedDailyCareForm";
import { Icon, CARE_TYPE_ICON_NAMES } from "@/components/ui/Icon";
import { CARE_TYPE_COLORS } from "@/lib/care-reports";
import { describeApiError } from "@/lib/api-error";
import { deviceDateInputValue, deviceHeaders, formatDeviceTime } from "@/lib/device-date";
import { useLocale, useT } from "@/lib/i18n-provider";
import { usePermissions } from "@/lib/use-permissions";
import type { CareReportType } from "@/generated/prisma/enums";

interface ClassItem { id: string; name: string }
interface StudentRow { id: string; name: string; avatarUrl?: string | null; classId?: string | null }
interface AttendanceRow { studentId: string; date: string; checkinAt: string | null }
interface ReportRow {
  id: string;
  type: CareReportType;
  summary: string;
  occurredAt: string;
  reportedByName: string;
  note: string | null;
  dailyBatchId: string | null;
  reviewStatus: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  reviewNote: string | null;
  student: { id: string; name: string };
}

interface ReportGroup {
  key: string;
  anchor: ReportRow;
  reports: ReportRow[];
  studentCount: number;
  students: Array<{
    key: string;
    student: ReportRow["student"];
    reports: ReportRow[];
    authors: string[];
  }>;
}

interface ReturnedBatch extends ReturnedDailyCareDraft {
  returnedAt: string | null;
  reportedByName: string;
  students: DailyCareStudent[];
}

export default function CarePage() {
  const t = useT();
  const { locale } = useLocale();
  const { can, me } = usePermissions();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [presentIds, setPresentIds] = useState<Set<string>>(new Set());
  const [attendanceAvailable, setAttendanceAvailable] = useState(true);
  const [classFilter, setClassFilter] = useState("");
  const [showNonPresent, setShowNonPresent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [expandedReviewChildren, setExpandedReviewChildren] = useState<Set<string>>(() => new Set());
  const [returnedBatches, setReturnedBatches] = useState<ReturnedBatch[]>([]);
  const [returnedLoading, setReturnedLoading] = useState(false);
  const [editingReturnedBatchId, setEditingReturnedBatchId] = useState<string | null>(null);
  const [reviewRequired, setReviewRequired] = useState(true);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policySaving, setPolicySaving] = useState(false);
  const today = deviceDateInputValue();

  const loadReports = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await axios.get<ReportRow[]>(`/api/care-reports?date=${today}`, {
        headers: deviceHeaders(),
        signal,
      });
      setReports(response.data);
    } catch (loadError) {
      if (!axios.isCancel(loadError)) setError(describeApiError(loadError, t("care.loadTodayFailed")));
    } finally {
      if (!signal?.aborted) setReportsLoading(false);
    }
  }, [t, today]);

  const loadReturnedBatches = useCallback(async (signal?: AbortSignal) => {
    // Keep state updates after the effect's synchronous phase. This loader is
    // also reused after a successful resubmission.
    await Promise.resolve();
    if (!me?.classroomScoped) {
      setReturnedBatches([]);
      return;
    }
    setReturnedLoading(true);
    try {
      const response = await axios.get<ReturnedBatch[]>("/api/care-reports/returned", { signal });
      setReturnedBatches(response.data);
    } catch (loadError) {
      if (!axios.isCancel(loadError)) setError(describeApiError(loadError, t("care.loadReturnedFailed")));
    } finally {
      if (!signal?.aborted) setReturnedLoading(false);
    }
  }, [me?.classroomScoped, t]);

  useEffect(() => {
    if (!me?.classroomScoped) return;
    const controller = new AbortController();
    void axios.get<ReturnedBatch[]>("/api/care-reports/returned", { signal: controller.signal })
      .then((response) => setReturnedBatches(response.data))
      .catch((loadError) => {
        if (!axios.isCancel(loadError)) setError(describeApiError(loadError, t("care.loadReturnedFailed")));
      });
    return () => controller.abort();
  }, [me?.classroomScoped, t]);

  useEffect(() => {
    const controller = new AbortController();
    void axios.get<ClassItem[]>("/api/classes", { signal: controller.signal })
      .then((response) => setClasses(response.data))
      .catch((loadError) => {
        if (!axios.isCancel(loadError)) setError(describeApiError(loadError, t("common.loadFailed")));
      });

    void axios.get<{ students?: StudentRow[] } | StudentRow[]>("/api/students", { signal: controller.signal })
      .then((studentsResponse) => {
        const studentList = Array.isArray(studentsResponse.data)
          ? studentsResponse.data
          : (studentsResponse.data.students ?? []);
        setStudents(studentList);
      })
      .catch((loadError) => {
        if (!axios.isCancel(loadError)) setError(describeApiError(loadError, t("common.loadFailed")));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    void axios.get<AttendanceRow[]>("/api/attendance/students/today", {
      signal: controller.signal,
      headers: deviceHeaders(),
    })
      .then((response) => {
        setAttendanceAvailable(true);
        // The attendance endpoint also returns an older open row so the school
        // can close a forgotten checkout. That row must not make the child look
        // present today in care reports.
        setPresentIds(new Set(
          response.data
            .filter((row) => Boolean(row.checkinAt) && row.date.slice(0, 10) === today)
            .map((row) => row.studentId)
        ));
      })
      .catch((loadError) => {
        if (!axios.isCancel(loadError)) {
          setAttendanceAvailable(false);
          setPresentIds(new Set());
        }
      });

    void axios.get<ReportRow[]>(`/api/care-reports?date=${today}`, {
      headers: deviceHeaders(),
      signal: controller.signal,
    })
      .then((response) => setReports(response.data))
      .catch((loadError) => {
        if (!axios.isCancel(loadError)) setError(describeApiError(loadError, t("care.loadTodayFailed")));
      })
      .finally(() => {
        if (!controller.signal.aborted) setReportsLoading(false);
      });
    return () => controller.abort();
  }, [t, today]);

  useEffect(() => {
    const controller = new AbortController();
    void axios.get<{ reviewRequired: boolean }>("/api/care-reports/settings", {
      signal: controller.signal,
    })
      .then((response) => setReviewRequired(response.data.reviewRequired))
      .catch((loadError) => {
        if (!axios.isCancel(loadError)) {
          setError(describeApiError(loadError, t("care.policyLoadFailed")));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPolicyLoading(false);
      });
    return () => controller.abort();
  }, [t]);

  const classStudents = useMemo(
    () => classFilter ? students.filter((student) => student.classId === classFilter) : students,
    [classFilter, students]
  );
  const visibleStudents = useMemo(
    () => showNonPresent || !attendanceAvailable
      ? classStudents
      : classStudents.filter((student) => presentIds.has(student.id)),
    [attendanceAvailable, classStudents, presentIds, showNonPresent]
  );
  const formKey = `${classFilter}:${showNonPresent}:${visibleStudents.map((student) => student.id).join(",")}`;
  const mayReview = can("students.manage") && !me?.classroomScoped;
  const editingReturnedBatch = returnedBatches.find((batch) => batch.batchId === editingReturnedBatchId) ?? null;
  const reportGroups = useMemo<ReportGroup[]>(() => {
    const groups = new Map<string, ReportRow[]>();
    for (const report of reports) {
      const key = report.dailyBatchId ? `batch:${report.dailyBatchId}` : `report:${report.id}`;
      groups.set(key, [...(groups.get(key) ?? []), report]);
    }
    return [...groups.entries()].map(([key, groupReports]) => {
      const byStudent = new Map<string, ReportRow[]>();
      for (const report of groupReports) {
        byStudent.set(report.student.id, [...(byStudent.get(report.student.id) ?? []), report]);
      }
      const studentGroups = [...byStudent.entries()].map(([studentId, studentReports]) => ({
        key: `${key}:${studentId}`,
        student: studentReports[0].student,
        reports: studentReports,
        authors: [...new Set(studentReports.map((report) => report.reportedByName))],
      }));
      return {
        key,
        anchor: groupReports[0],
        reports: groupReports,
        studentCount: studentGroups.length,
        students: studentGroups,
      };
    });
  }, [reports]);
  const visibleReportGroups = useMemo(
    () => reportGroups.filter((group) => group.anchor.reviewStatus !== "REJECTED"),
    [reportGroups]
  );
  const returnedManagerGroups = useMemo(
    () => mayReview ? reportGroups.filter((group) => group.anchor.reviewStatus === "REJECTED") : [],
    [mayReview, reportGroups]
  );

  function toggleReviewChild(key: string) {
    setExpandedReviewChildren((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function reviewReport(report: ReportRow, action: "APPROVE" | "REJECT", note: string | null = null) {
    setReviewingId(report.id);
    setError(null);
    try {
      await axios.post(`/api/care-reports/${report.id}/review`, { action, note });
      setNotice(action === "APPROVE" ? t("care.approvedAndSent") : t("care.returnedForEdit"));
      setRejectingId(null);
      setRejectNote("");
      await loadReports();
    } catch (reviewError) {
      setError(describeApiError(reviewError, t("care.reviewFailed")));
    } finally {
      setReviewingId(null);
    }
  }

  async function updateReviewPolicy(nextReviewRequired: boolean) {
    if (nextReviewRequired === reviewRequired || policySaving) return;
    if (!nextReviewRequired && !window.confirm(t("care.directSendConfirm"))) return;
    setPolicySaving(true);
    setError(null);
    try {
      const response = await axios.put<{ reviewRequired: boolean }>(
        "/api/care-reports/settings",
        { reviewRequired: nextReviewRequired }
      );
      setReviewRequired(response.data.reviewRequired);
      setNotice(t("care.policySaved"));
    } catch (saveError) {
      setError(describeApiError(saveError, t("care.policySaveFailed")));
    } finally {
      setPolicySaving(false);
    }
  }

  return (
    <div dir={locale === "ar" ? "rtl" : "ltr"} className="min-h-screen bg-[#F8F7FA]">
      <Topbar title={t("care.title")} />
      <main className="mx-auto max-w-[1180px] space-y-5 px-4 py-6 sm:px-6 lg:py-8">
        <section className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#2D2238] sm:text-2xl">{t("care.oneReportTitle")}</h2>
            <p className="mt-1 text-sm text-[#8B8095]">{t("care.oneReportSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#8B8095]">
            <span className="h-2 w-2 rounded-full bg-[#EC5FB1]" />
            {t("care.todayDraft")}
          </div>
        </section>

        {mayReview && (
          <section className="rounded-2xl border border-[#E8E3EF] bg-white p-4 sm:p-5">
            <div>
              <h2 className="font-bold text-[#2D2238]">{t("care.reportDeliveryMode")}</h2>
              <p className="mt-1 text-xs leading-5 text-[#8B8095]">{t("care.reportDeliveryModeHint")}</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={reviewRequired}
                disabled={policyLoading || policySaving}
                onClick={() => void updateReviewPolicy(true)}
                className={`rounded-xl border p-4 text-start transition disabled:opacity-50 ${reviewRequired
                  ? "border-[#5B14D1] bg-[#F4EEFF]"
                  : "border-[#E8E3EF] bg-white hover:border-[#C9B8EA]"}`}
              >
                <span className="block text-sm font-bold text-[#2D2238]">{t("care.reviewBeforeSend")}</span>
                <span className="mt-1 block text-xs leading-5 text-[#766B80]">{t("care.reviewBeforeSendDescription")}</span>
              </button>
              <button
                type="button"
                aria-pressed={!reviewRequired}
                disabled={policyLoading || policySaving}
                onClick={() => void updateReviewPolicy(false)}
                className={`rounded-xl border p-4 text-start transition disabled:opacity-50 ${!reviewRequired
                  ? "border-emerald-600 bg-emerald-50"
                  : "border-[#E8E3EF] bg-white hover:border-[#C9B8EA]"}`}
              >
                <span className="block text-sm font-bold text-[#2D2238]">{t("care.directSend")}</span>
                <span className="mt-1 block text-xs leading-5 text-[#766B80]">{t("care.directSendDescription")}</span>
              </button>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-4 rounded-2xl border border-[#E8E3EF] bg-white p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <label className="w-full space-y-1.5 sm:max-w-[260px]">
            <span className="text-xs text-[#766B80]">{t("care.classFilter")}</span>
            <select
              value={classFilter}
              onChange={(event) => setClassFilter(event.target.value)}
              className="h-11 w-full rounded-xl border border-[#E6E0EB] bg-white px-3 text-sm outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#EDE4FF]"
            >
              <option value="">{t("common.allClasses")}</option>
              {classes.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-sm text-[#6F6379]">
              {attendanceAvailable
                ? t("care.presentToday", { n: String(classStudents.filter((student) => presentIds.has(student.id)).length) })
                : t("care.attendanceUnavailable")}
            </p>
            <label className="flex items-center gap-2 text-xs text-[#6F6379]">
              <input type="checkbox" checked={showNonPresent} onChange={(event) => setShowNonPresent(event.target.checked)} className="h-4 w-4 accent-[#5B14D1]" />
              {t("care.showNonPresent")}
            </label>
          </div>
        </section>

        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        {me?.classroomScoped && (returnedLoading || returnedBatches.length > 0) && (
          <section className="rounded-2xl border border-amber-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-[#2D2238]">{t("care.returnedReportsTitle")}</h2>
                <p className="mt-1 text-xs text-[#8B8095]">{t("care.returnedReportsSubtitle")}</p>
              </div>
              {editingReturnedBatch && (
                <button
                  type="button"
                  onClick={() => setEditingReturnedBatchId(null)}
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-[#5B14D1] hover:bg-[#F1E8FF]"
                >
                  {t("care.closeReturnedEditor")}
                </button>
              )}
            </div>
            {returnedLoading ? (
              <p className="py-5 text-center text-sm text-[#9A909F]">{t("common.loadingDots")}</p>
            ) : !editingReturnedBatch ? (
              <ul className="mt-4 space-y-2">
                {returnedBatches.map((batch) => (
                  <li key={batch.batchId} className="flex flex-col gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-bold text-[#3D3346]">
                        {t("care.returnedBatchSummary", { n: String(batch.students.length) })}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-amber-800">
                        {batch.reviewNote || t("care.returnedWithoutNote")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingReturnedBatchId(batch.batchId)}
                      className="min-h-10 shrink-0 rounded-xl bg-[#5B14D1] px-4 text-xs font-bold text-white hover:bg-[#490EA9]"
                    >
                      {t("care.openReturnedReport")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        )}

        {editingReturnedBatch ? (
          <UnifiedDailyCareForm
            key={`returned:${editingReturnedBatch.batchId}`}
            students={editingReturnedBatch.students}
            date={deviceDateInputValue(new Date(editingReturnedBatch.meal.occurredAt))}
            initialDraft={editingReturnedBatch}
            reviewRequired={reviewRequired}
            onSaved={(message) => {
              setNotice(message);
              setError(null);
              setEditingReturnedBatchId(null);
              void Promise.all([loadReturnedBatches(), loadReports()]);
            }}
          />
        ) : loading ? (
          <div className="rounded-2xl border border-[#E8E3EF] bg-white p-10 text-center text-sm text-[#8B8095]">{t("common.loadingDots")}</div>
        ) : visibleStudents.length === 0 ? (
          <div className="rounded-2xl border border-[#E8E3EF] bg-white p-10 text-center">
            <p className="text-sm text-[#6F6379]">{t("care.noPresentChildren")}</p>
            {!showNonPresent && <button type="button" onClick={() => setShowNonPresent(true)} className="mt-3 text-sm font-semibold text-[#5B14D1] hover:underline">{t("care.showAllChildren")}</button>}
          </div>
        ) : (
          <UnifiedDailyCareForm
            key={formKey}
            students={visibleStudents}
            date={today}
            reviewRequired={reviewRequired}
            onSaved={(message) => {
              setNotice(message);
              setError(null);
              void loadReports();
            }}
          />
        )}

        <section className="rounded-2xl border border-[#E8E3EF] bg-white p-5">
          <h2 className="font-bold text-[#2D2238]">{t("care.todayReports")}</h2>
          {reportsLoading ? (
            <p className="py-7 text-center text-sm text-[#9A909F]">{t("common.loadingDots")}</p>
          ) : visibleReportGroups.length === 0 ? (
            <p className="py-7 text-center text-sm text-[#9A909F]">{t("care.noneYet")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {visibleReportGroups.map((group) => {
                const report = group.anchor;
                return (
                <li key={group.key} className="rounded-xl border border-[#EEE8F2] bg-[#FCFAFD] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0ECF3] pb-2">
                    <p className="text-xs font-semibold text-[#6F6379]">
                      {t("care.reviewBatchSummary", { children: String(group.studentCount), items: String(group.reports.length) })}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        report.reviewStatus === "APPROVED"
                          ? "bg-emerald-50 text-emerald-700"
                          : report.reviewStatus === "REJECTED"
                            ? "bg-red-50 text-red-700"
                            : "bg-amber-50 text-amber-700"
                      }`}>
                        {t(`care.reviewStatus.${report.reviewStatus}`)}
                      </span>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-2">
                    {group.students.map((studentGroup) => {
                      const expanded = expandedReviewChildren.has(studentGroup.key);
                      const detailsId = `care-review-${studentGroup.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                      return (
                        <li key={studentGroup.key} className="overflow-hidden rounded-xl border border-[#E9E2EE] bg-white">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={detailsId}
                            aria-label={t("care.toggleChildReview", { name: studentGroup.student.name })}
                            onClick={() => toggleReviewChild(studentGroup.key)}
                            className="flex w-full items-center gap-3 px-3 py-3 text-start transition-colors hover:bg-[#FBF8FD] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8B5CF6]"
                          >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F2EAFE] text-sm font-bold text-[#6D28D9]">
                              {studentGroup.student.name.trim().slice(0, 1)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-bold text-[#352A3E]">{studentGroup.student.name}</span>
                              <span className="mt-0.5 block text-xs text-[#8B8095]">
                                {t("care.childEntries", { n: String(studentGroup.reports.length) })}
                                <span className="px-1 text-[#C3BBC8]">·</span>
                                {t("care.reportAuthor", { name: studentGroup.authors.join(locale === "ar" ? "، " : ", ") })}
                              </span>
                            </span>
                            <Icon
                              name="chevron"
                              size={18}
                              className={`shrink-0 text-[#8B8095] transition-transform ${expanded ? "rotate-180" : ""}`}
                            />
                          </button>
                          {expanded && (
                            <div id={detailsId} className="border-t border-[#F0ECF3] bg-[#FCFAFD] p-3">
                              <div className="grid gap-2 sm:grid-cols-2">
                                {studentGroup.reports.map((item) => (
                                  <div key={item.id} className="flex items-start gap-3 rounded-xl border border-[#EEE8F2] bg-white p-3">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FCFAFD]">
                                      <Icon name={CARE_TYPE_ICON_NAMES[item.type]} size={18} className={CARE_TYPE_COLORS[item.type]} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-[#44384E]">{item.summary}</p>
                                      <p className="mt-1 text-[11px] text-[#9A909F]">
                                        {formatDeviceTime(new Date(item.occurredAt), { hour: "2-digit", minute: "2-digit" }, locale)}
                                      </p>
                                      {item.note && <p className="mt-2 text-xs leading-5 text-[#6F6379]">{item.note}</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="border-t border-[#F0ECF3] pt-2">
                    {report.reviewNote && <p className="mt-1 text-xs text-red-600">{report.reviewNote}</p>}
                    {mayReview && report.reviewStatus === "PENDING_REVIEW" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={Boolean(reviewingId)}
                          onClick={() => void reviewReport(report, "APPROVE")}
                          className="rounded-lg bg-[#5B14D1] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {reviewingId === report.id ? t("common.loadingDots") : t("care.approveAndSend")}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(reviewingId)}
                          onClick={() => {
                            setRejectingId(report.id);
                            setRejectNote("");
                          }}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"
                        >
                          {t("care.returnForEdit")}
                        </button>
                      </div>
                    )}
                    {mayReview && rejectingId === report.id && report.reviewStatus === "PENDING_REVIEW" && (
                      <div className="mt-2 flex flex-col gap-2 rounded-xl border border-red-100 bg-red-50/50 p-2 sm:flex-row">
                        <input
                          value={rejectNote}
                          onChange={(event) => setRejectNote(event.target.value)}
                          maxLength={500}
                          placeholder={t("care.rejectReasonPrompt")}
                          className="h-9 min-w-0 flex-1 rounded-lg border border-red-100 bg-white px-3 text-xs outline-none focus:border-red-300"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={Boolean(reviewingId)}
                            onClick={() => void reviewReport(report, "REJECT", rejectNote.trim() || null)}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {t("care.confirmReturn")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingId(null);
                              setRejectNote("");
                            }}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#6F6379]"
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              )})}
            </ul>
          )}
        </section>

        {returnedManagerGroups.length > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-white p-5">
            <h2 className="font-bold text-[#2D2238]">{t("care.returnedToTeacherTitle")}</h2>
            <p className="mt-1 text-xs text-[#8B8095]">{t("care.returnedToTeacherSubtitle")}</p>
            <ul className="mt-3 space-y-2">
              {returnedManagerGroups.map((group) => (
                <li key={group.key} className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[#44384E]">
                      {t("care.reviewBatchSummary", { children: String(group.studentCount), items: String(group.reports.length) })}
                    </p>
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                      {t("care.reviewStatus.REJECTED")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#8B8095]">
                    {t("care.reportAuthor", { name: [...new Set(group.reports.map((report) => report.reportedByName))].join(locale === "ar" ? "، " : ", ") })}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-amber-800">
                    {group.anchor.reviewNote || t("care.returnedWithoutNote")}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
