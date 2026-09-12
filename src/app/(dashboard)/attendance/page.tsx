"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { AttendanceBoard } from "@/components/attendance/AttendanceBoard";
import { WeeklyAttendanceGrid } from "@/components/attendance/WeeklyAttendanceGrid";
import { WeeklyTeacherAttendanceGrid } from "@/components/attendance/WeeklyTeacherAttendanceGrid";
import { useT } from "@/lib/i18n-provider";
import { deviceHeaders } from "@/lib/device-date";
import { Topbar } from "@/components/layout/Topbar";

interface ClassItem {
  id: string;
  name: string;
}

/**
 * Two views of the same register.
 *
 * "Today" is the working screen — check in, check out, mark absent as the room
 * fills. "This week" is the reviewing screen: who keeps missing Sundays, is this
 * child actually attending the three days that were agreed. They are different
 * jobs done at different times of day, so they are tabs rather than one page
 * trying to serve both.
 */
export default function AttendancePage() {
  const t = useT();
  const { data: session, status } = useSession();
  const schoolName = (session?.user as { schoolName?: string } | undefined)?.schoolName;

  const [tab, setTab] = useState<"today" | "week">("today");
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classFilter, setClassFilter] = useState("");
  const [weekKind, setWeekKind] = useState<"students" | "teachers">("students");
  const [weekSearch, setWeekSearch] = useState("");
  const [classOptionsError, setClassOptionsError] = useState(false);
  const [classOptionsLoading, setClassOptionsLoading] = useState(false);
  const [classOptionsLoaded, setClassOptionsLoaded] = useState(false);

  async function loadClassOptions() {
    if (classOptionsLoading) return;
    setClassOptionsLoading(true);
    try {
      const response = await axios.get<{ classes: ClassItem[] }>("/api/attendance/page-data", { headers: deviceHeaders() });
      setClasses(response.data.classes ?? []);
      setClassOptionsLoaded(true);
      setClassOptionsError(false);
    } catch {
      setClassOptionsError(true);
    } finally {
      setClassOptionsLoading(false);
    }
  }

  function selectTab(nextTab: "today" | "week") {
    setTab(nextTab);
    if (nextTab === "week" && status === "authenticated" && !classOptionsLoaded) void loadClassOptions();
  }

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-7 h-7 border-2 border-gray-200 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      <Topbar title={t("nav.attendance")} />
      <div className="flex flex-wrap items-center gap-2 px-3 pt-4 sm:px-6 sm:pt-6">
        <div className="inline-flex bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => selectTab("today")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "today" ? "bg-white shadow text-[#111111]" : "text-gray-500"
            }`}
          >
            {t("common.today")}
          </button>
          <button
            onClick={() => selectTab("week")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "week" ? "bg-white shadow text-[#111111]" : "text-gray-500"
            }`}
          >
            {t("common.week")}
          </button>
        </div>

        {tab === "week" && (
          <>
            <div className="inline-flex rounded-xl bg-gray-100 p-1">
              <button onClick={() => setWeekKind("students")} className={`rounded-lg px-4 py-2 text-sm ${weekKind === "students" ? "bg-white shadow" : "text-gray-500"}`}>{t("nav.students")}</button>
              <button onClick={() => setWeekKind("teachers")} className={`rounded-lg px-4 py-2 text-sm ${weekKind === "teachers" ? "bg-white shadow" : "text-gray-500"}`}>{t("fields.teacher")}</button>
            </div>
            <label className="sr-only" htmlFor="week-attendance-search">{t("common.search")}</label>
            <input id="week-attendance-search" value={weekSearch} onChange={(event) => setWeekSearch(event.target.value)} placeholder={t("students.searchPlaceholder")} className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            {weekKind === "students" && <>
              <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm"><option value="">{t("common.allClasses")}</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              {classOptionsLoading && <span className="text-sm text-gray-500">{t("common.loading")}</span>}
              {classOptionsError && <span role="alert" className="text-sm text-red-600"><button type="button" className="underline" onClick={() => void loadClassOptions()}>{t("common.retry")}</button></span>}
            </>}
          </>
        )}
      </div>

      {tab === "today" ? (
        <AttendanceBoard schoolName={schoolName} />
      ) : (
        <div className="p-3 sm:p-6">
          <div className="bg-white rounded-2xl shadow-sm p-5">
            {weekKind === "students" ? <WeeklyAttendanceGrid classId={classFilter || undefined} search={weekSearch} /> : <WeeklyTeacherAttendanceGrid search={weekSearch} />}
          </div>
        </div>
      )}
    </div>
  );
}
