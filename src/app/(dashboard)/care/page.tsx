"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { UnifiedDailyCareForm } from "@/components/care/UnifiedDailyCareForm";
import { Icon, CARE_TYPE_ICON_NAMES } from "@/components/ui/Icon";
import { CARE_TYPE_COLORS } from "@/lib/care-reports";
import { describeApiError } from "@/lib/api-error";
import { deviceDateInputValue, deviceHeaders, formatDeviceTime } from "@/lib/device-date";
import { useLocale, useT } from "@/lib/i18n-provider";
import type { CareReportType } from "@/generated/prisma/enums";

interface ClassItem { id: string; name: string }
interface StudentRow { id: string; name: string; avatarUrl?: string | null; classId?: string | null }
interface AttendanceRow { studentId: string; checkinAt: string | null }
interface ReportRow {
  id: string;
  type: CareReportType;
  summary: string;
  occurredAt: string;
  reportedByName: string;
  note: string | null;
  student: { id: string; name: string };
}

export default function CarePage() {
  const t = useT();
  const { locale } = useLocale();
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
        setPresentIds(new Set(response.data.filter((row) => Boolean(row.checkinAt)).map((row) => row.studentId)));
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

        {loading ? (
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
          ) : reports.length === 0 ? (
            <p className="py-7 text-center text-sm text-[#9A909F]">{t("care.noneYet")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-[#F0ECF3]">
              {reports.map((report) => (
                <li key={report.id} className="flex items-start gap-3 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F7F3FA]">
                    <Icon name={CARE_TYPE_ICON_NAMES[report.type]} size={18} className={CARE_TYPE_COLORS[report.type]} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[#44384E]"><span className="font-semibold">{report.student.name}</span><span className="text-[#AAA1B0]"> · </span>{report.summary}</p>
                    <p className="mt-1 text-[11px] text-[#9A909F]">
                      {formatDeviceTime(new Date(report.occurredAt), { hour: "2-digit", minute: "2-digit" }, locale)}{" · "}{report.reportedByName}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
