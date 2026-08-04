"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { AttendanceBoard } from "@/components/attendance/AttendanceBoard";
import { WeeklyAttendanceGrid } from "@/components/attendance/WeeklyAttendanceGrid";
import { useT } from "@/lib/i18n-provider";

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

  useEffect(() => {
    let cancelled = false;
    axios
      .get<ClassItem[]>("/api/classes")
      .then((response) => {
        if (!cancelled) setClasses(response.data);
      })
      .catch(() => {
        // The weekly grid works school-wide without the filter, so a failure
        // here degrades the screen rather than breaking it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-7 h-7 border-2 border-gray-200 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div dir="rtl">
      <div className="px-6 pt-6 flex items-center gap-2 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setTab("today")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "today" ? "bg-white shadow text-[#111111]" : "text-gray-500"
            }`}
          >
            {t("common.today")}
          </button>
          <button
            onClick={() => setTab("week")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "week" ? "bg-white shadow text-[#111111]" : "text-gray-500"
            }`}
          >
            {t("common.week")}
          </button>
        </div>

        {tab === "week" && (
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">{t("common.allClasses")}</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {tab === "today" ? (
        // No token here on purpose: signed-in staff read and write through the
        // session-checked routes. The kiosk token is fetched only when printing
        // a QR.
        <AttendanceBoard isPublic={false} schoolName={schoolName} />
      ) : (
        <div className="p-6">
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <WeeklyAttendanceGrid classId={classFilter || undefined} />
          </div>
        </div>
      )}
    </div>
  );
}
