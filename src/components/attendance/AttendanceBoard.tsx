"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { cn } from "@/lib/utils";
import { AttendanceCard } from "./AttendanceCard";
import type { AttendancePerson, AttendanceClass } from "@/lib/attendance-data";
import { useT } from "@/lib/i18n-provider";

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
  const [activeTab, setActiveTab] = useState<"students" | "teachers">("students");
  const [selectedClass, setSelectedClass] = useState<string>("all");
  const [students, setStudents] = useState<AttendancePerson[]>([]);
  const [teachers, setTeachers] = useState<AttendancePerson[]>([]);
  const [classes, setClasses] = useState<AttendanceClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const res = await axios.get<{ students: AttendancePerson[]; teachers: AttendancePerson[]; classes: AttendanceClass[] }>(
      "/api/attendance/page-data"
    );
    setStudents(res.data.students);
    setTeachers(res.data.teachers);
    setClasses(res.data.classes);
  }, []);

  useEffect(() => {
    // Without a catch a failed load left an empty board with no explanation.
    // `loading` starts true, so it is only ever cleared from a callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
      .then(() => setError(null))
      .catch(() => setError(t("attendance.loadDataFailed")))
      .finally(() => setLoading(false));
  }, [fetchData, t]);

  const filteredPeople = useMemo(() => {
    const people = activeTab === "students" ? students : teachers;
    if (selectedClass === "all") return people;
    return people.filter((p) => p.class_id === selectedClass);
  }, [activeTab, selectedClass, students, teachers]);

  /** Session-checked routes only — there is no unauthenticated path left. */
  async function submitAttendance(personId: string, action: "checkin" | "checkout") {
    const isStudent = activeTab === "students";
    const scope = isStudent ? "students" : "teachers";
    const payload = isStudent ? { student_id: personId } : { teacher_id: personId };
    await axios.post(`/api/attendance/${scope}/${action}`, payload);
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
    <div className="flex h-screen bg-gray-50" dir="rtl">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-l border-gray-100 flex flex-col p-4 gap-1 overflow-y-auto flex-shrink-0">
        {schoolName && <p className="text-sm font-bold text-navy mb-3 text-right truncate">{schoolName}</p>}
        <p className="text-xs font-bold text-gray-400 mb-2 text-right">{t("fields.filter")}</p>

        <button
          onClick={() => setSelectedClass("all")}
          className={cn(
            "text-right px-3 py-2 rounded-lg text-sm font-medium transition-all",
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
              "text-right px-3 py-2 rounded-lg text-sm transition-all",
              selectedClass === cls.id ? "bg-coral text-white font-medium" : "text-gray-600 hover:bg-gray-50"
            )}
          >
            {cls.name}
            <span className="text-xs opacity-60 mr-1">{cls.period === "MORNING" ? "☀" : "🌙"}</span>
          </button>
        ))}
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div />

          <div className="flex bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setActiveTab("students")}
              className={cn(
                "px-5 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === "students" ? "bg-white text-navy shadow-sm" : "text-gray-500"
              )}
            >
              {t("nav.students")}
            </button>
            <button
              onClick={() => setActiveTab("teachers")}
              className={cn(
                "px-5 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === "teachers" ? "bg-white text-navy shadow-sm" : "text-gray-500"
              )}
            >
              {t("fields.teacher")}
            </button>
          </div>

          <div className="w-24" />
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div
              role="alert"
              className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center"
            >
              {error}
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-7 h-7 border-2 border-gray-200 border-t-coral rounded-full animate-spin" />
            </div>
          ) : filteredPeople.length === 0 ? (
            <p className="text-center text-gray-400 py-20 text-sm">{t("attendance.nobodyToShow")}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
