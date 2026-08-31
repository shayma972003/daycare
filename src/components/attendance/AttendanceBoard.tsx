"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import axios from "axios";
import { cn } from "@/lib/utils";
import { AttendanceCard } from "./AttendanceCard";
import type { AttendancePerson, AttendanceClass, AttendancePageData } from "@/lib/attendance-data";
import { useT } from "@/lib/i18n-provider";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { usePermissions } from "@/lib/use-permissions";
import { deviceHeaders } from "@/lib/device-date";

/**
 * Check-in and check-out, for signed-in staff.
 *
 * The walk-up QR kiosk this board also served is gone. It was the only way to
 * reach `/attendance/public/<token>`, so removing the code that printed the QR
 * would have left three unauthenticated endpoints alive with nothing able to
 * find them — attack surface with no user. Both halves went together.
 */
interface AttendanceBoardProps {
  schoolName?: string | null;
}

export function AttendanceBoard({ schoolName }: AttendanceBoardProps) {
  const t = useT();
  const { can, status: permissionStatus } = usePermissions();
  const canStudents = can("attendance.students");
  const canStaff = can("attendance.staff");
  const [activeTab, setActiveTab] = useState<"students" | "teachers">("students");
  const [selectedClass, setSelectedClass] = useState<string>("all");
  const [students, setStudents] = useState<AttendancePerson[]>([]);
  const [teachers, setTeachers] = useState<AttendancePerson[]>([]);
  const [classes, setClasses] = useState<AttendanceClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [error, setError] = useState<string | null>(null);
  const dataRequest = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    dataRequest.current?.abort();
    const controller = new AbortController();
    dataRequest.current = controller;
    setLoading(true);
    try {
      const res = await axios.get<AttendancePageData>(
        "/api/attendance/page-data",
        { headers: deviceHeaders(), signal: controller.signal }
      );
      if (dataRequest.current !== controller) return;
      setStudents(res.data.students ?? []);
      setTeachers(res.data.teachers ?? []);
      setClasses(res.data.classes);
      setError(null);
    } catch (err) {
      if (dataRequest.current === controller && !axios.isCancel(err)) {
        setError(t("attendance.loadDataFailed"));
      }
    } finally {
      if (dataRequest.current === controller) {
        dataRequest.current = null;
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    if (permissionStatus !== "ready" || (!canStudents && !canStaff)) return;
    dataRequest.current?.abort();
    const controller = new AbortController();
    dataRequest.current = controller;

    void axios.get<AttendancePageData>(
      "/api/attendance/page-data",
      { headers: deviceHeaders(), signal: controller.signal }
    ).then((res) => {
      if (dataRequest.current !== controller) return;
      setStudents(res.data.students ?? []);
      setTeachers(res.data.teachers ?? []);
      setClasses(res.data.classes);
      setError(null);
    }).catch((err: unknown) => {
      if (dataRequest.current === controller && !axios.isCancel(err)) {
        setError(t("attendance.loadDataFailed"));
      }
    }).finally(() => {
      if (dataRequest.current === controller) {
        dataRequest.current = null;
        setLoading(false);
      }
    });

    return () => controller.abort();
  }, [canStaff, canStudents, permissionStatus, t]);

  const currentTab = !canStudents && canStaff ? "teachers" : activeTab;
  const accessDenied = permissionStatus === "ready" && !canStudents && !canStaff;

  const filteredPeople = useMemo(() => {
    const people = currentTab === "students" ? students : teachers;
    const query = search.trim().toLocaleLowerCase();
    return people.filter((p) =>
      (selectedClass === "all" || p.class_id === selectedClass) &&
      (!query || p.full_name.toLocaleLowerCase().includes(query))
    );
  }, [currentTab, search, selectedClass, students, teachers]);

  /** Session-checked routes only — there is no unauthenticated path left. */
  async function submitAttendance(personId: string, action: "checkin" | "checkout") {
    const isStudent = currentTab === "students";
    const scope = isStudent ? "students" : "teachers";
    const payload = isStudent ? { student_id: personId } : { teacher_id: personId };
    await axios.post(`/api/attendance/${scope}/${action}`, payload, { headers: deviceHeaders() });
  }

  async function handleAction(personId: string, action: "checkin" | "checkout") {
    setActionLoadingId(personId);
    try {
      await submitAttendance(personId, action);
      await fetchData();
      setError(null);
    } catch (err) {
      const fallback =
        action === "checkin" ? t("attendance.checkInFailed") : t("attendance.checkOutFailed");
      setError(
        axios.isAxiosError(err) ? (err.response?.data?.error ?? fallback) : fallback
      );
    } finally {
      setActionLoadingId(null);
    }
  }

  const handleCheckin = (personId: string) => handleAction(personId, "checkin");
  const handleCheckout = (personId: string) => handleAction(personId, "checkout");


  return (
    <div
      data-attendance-board
      className="flex min-h-[calc(100dvh-6rem)] min-w-0 flex-col overflow-x-clip bg-gray-50 lg:h-[calc(100dvh-6rem)] lg:flex-row"
    >
      {/* Sidebar */}
      <aside
        aria-label={t("fields.filter")}
        role="region"
        tabIndex={0}
        className="w-full shrink-0 overflow-x-auto border-b border-gray-100 bg-white p-3 lg:w-56 lg:overflow-y-auto lg:border-b-0 lg:border-e lg:p-4"
      >
        {schoolName && <p className="text-sm font-bold text-navy mb-3 text-end truncate">{schoolName}</p>}
        <p className="mb-2 text-start text-xs font-bold text-gray-400">{t("fields.filter")}</p>

        <div
          data-attendance-class-filter
          className="flex min-w-max gap-2 pb-1 lg:min-w-0 lg:flex-col lg:gap-1 lg:pb-0"
        >

        <button
          onClick={() => setSelectedClass("all")}
          className={cn(
            "shrink-0 rounded-lg px-3 py-2 text-start text-sm font-medium transition-all lg:w-full",
            selectedClass === "all" ? "bg-coral text-white" : "text-gray-600 hover:bg-gray-50"
          )}
        >
          {t("common.all")}
        </button>

        {classes.map((cls) => (
          <button
            key={cls.id}
            onClick={() => setSelectedClass(cls.id)}
            className={cn(
              "shrink-0 rounded-lg px-3 py-2 text-start text-sm transition-all lg:w-full",
              selectedClass === cls.id ? "bg-coral text-white font-medium" : "text-gray-600 hover:bg-gray-50"
            )}
          >
            {cls.name}
            <span className="text-xs opacity-60 ms-1">{cls.period === "MORNING" ? "☀" : "🌙"}</span>
          </button>
        ))}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex w-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-col items-stretch gap-3 border-b border-gray-100 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 lg:px-6 lg:py-4">
          <label className="sr-only" htmlFor="attendance-search">{t("common.search")}</label>
          <input id="attendance-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("students.searchPlaceholder")} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm sm:w-48" />

          <div className="flex w-full rounded-xl bg-gray-100 p-1 sm:w-auto">
            <PermissionGate permission="attendance.students">
            <button
              type="button"
              onClick={() => setActiveTab("students")}
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all sm:flex-none sm:px-5",
                activeTab === "students" ? "bg-white text-navy shadow-sm" : "text-gray-500"
              )}
            >
              {t("nav.students")}
            </button>
            </PermissionGate>
            <PermissionGate permission="attendance.staff">
            <button
              type="button"
              onClick={() => setActiveTab("teachers")}
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all sm:flex-none sm:px-5",
                activeTab === "teachers" ? "bg-white text-navy shadow-sm" : "text-gray-500"
              )}
            >
              {t("fields.teacher")}
            </button>
            </PermissionGate>
          </div>

        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          {error && (
            <div
              role="alert"
              className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center"
            >
              <span>{error}</span>
              <button type="button" className="ms-2 underline" onClick={() => void fetchData()}>{t("common.retry")}</button>
            </div>
          )}
          {error ? null : accessDenied ? (
            <p role="alert" className="text-center text-gray-500 py-20 text-sm">{t("common.error")}</p>
          ) : loading ? (
            <div className="flex justify-center py-20">
              <div className="w-7 h-7 border-2 border-gray-200 border-t-coral rounded-full animate-spin" />
            </div>
          ) : filteredPeople.length === 0 ? (
            <p className="text-center text-gray-400 py-20 text-sm">
              {search.trim() ? t("common.noData") : t("attendance.nobodyToShow")}
            </p>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 lg:gap-4">
              {filteredPeople.map((person) => (
                <AttendanceCard
                  key={person.id}
                  person={person}
                  onCheckin={() => handleCheckin(person.id)}
                  onCheckout={() => handleCheckout(person.id)}
                  loading={actionLoadingId === person.id}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
