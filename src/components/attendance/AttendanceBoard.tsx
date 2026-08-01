"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { cn } from "@/lib/utils";
import { generateQRCode } from "@/lib/qr-generator";
import { AttendanceCard } from "./AttendanceCard";
import type { AttendancePerson, AttendanceClass } from "@/lib/attendance-data";

interface AttendanceBoardProps {
  /** Kiosk token. Present on the public board; fetched on demand in the dashboard. */
  token?: string;
  isPublic: boolean;
  schoolName?: string | null;
}

export function AttendanceBoard({ token, isPublic, schoolName }: AttendanceBoardProps) {
  const [activeTab, setActiveTab] = useState<"students" | "teachers">("students");
  const [selectedClass, setSelectedClass] = useState<string>("all");
  const [students, setStudents] = useState<AttendancePerson[]>([]);
  const [teachers, setTeachers] = useState<AttendancePerson[]>([]);
  const [classes, setClasses] = useState<AttendanceClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const url = isPublic ? `/api/attendance/public/${token}` : "/api/attendance/page-data";
    const res = await axios.get<{ students: AttendancePerson[]; teachers: AttendancePerson[]; classes: AttendanceClass[] }>(url);
    setStudents(res.data.students);
    setTeachers(res.data.teachers);
    setClasses(res.data.classes);
  }, [isPublic, token]);

  useEffect(() => {
    // Without a catch a failed load left an empty board with no explanation.
    // `loading` starts true, so it is only ever cleared from a callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
      .then(() => setError(null))
      .catch(() => setError("تعذر تحميل البيانات. تحقق من الاتصال وحاول مجدداً."))
      .finally(() => setLoading(false));
  }, [fetchData]);

  const filteredPeople = useMemo(() => {
    const people = activeTab === "students" ? students : teachers;
    if (selectedClass === "all") return people;
    return people.filter((p) => p.class_id === selectedClass);
  }, [activeTab, selectedClass, students, teachers]);

  /**
   * The dashboard used to post to the *public* endpoints, bypassing its own
   * session-checked routes entirely. Signed-in staff now go through the
   * authenticated ones; only the kiosk uses the token path.
   */
  async function submitAttendance(personId: string, action: "checkin" | "checkout") {
    const isStudent = activeTab === "students";

    if (isPublic) {
      await axios.post(`/api/attendance/public/${action}`, {
        token,
        person_id: personId,
        type: isStudent ? "student" : "teacher",
      });
      return;
    }

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
        action === "checkin" ? "حدث خطأ أثناء تسجيل الحضور" : "حدث خطأ أثناء تسجيل الانصراف";
      setError(
        axios.isAxiosError(err) ? (err.response?.data?.error ?? fallback) : fallback
      );
    } finally {
      setActionLoadingId(null);
    }
  }

  const handleCheckin = (personId: string) => handleAction(personId, "checkin");
  const handleCheckout = (personId: string) => handleAction(personId, "checkout");

  async function handleDownloadQR() {
    // The dashboard does not hold the token — fetch it only when a QR is wanted.
    const kioskToken =
      token ?? (await axios.get<{ token: string }>("/api/attendance/token")).data.token;

    const publicUrl = `${window.location.origin}/attendance/public/${kioskToken}`;
    const qrDataUrl = await generateQRCode(publicUrl);
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = "qr-attendance.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="flex h-screen bg-gray-50" dir="rtl">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-l border-gray-100 flex flex-col p-4 gap-1 overflow-y-auto flex-shrink-0">
        {schoolName && <p className="text-sm font-bold text-navy mb-3 text-right truncate">{schoolName}</p>}
        <p className="text-xs font-bold text-gray-400 mb-2 text-right">الفلتر</p>

        <button
          onClick={() => setSelectedClass("all")}
          className={cn(
            "text-right px-3 py-2 rounded-lg text-sm font-medium transition-all",
            selectedClass === "all" ? "bg-coral text-white" : "text-gray-600 hover:bg-gray-50"
          )}
        >
          الكل
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
          <div className="flex items-center gap-3">
            <button
              onClick={handleDownloadQR}
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-gray-200 text-gray-600 text-sm hover:border-teal hover:text-teal hover:bg-teal-light transition-all"
              title="تنزيل QR Code"
            >
              <div className="w-5 h-5 bg-gray-300 rounded" />
              <span className="text-xs">تنزيل QR</span>
            </button>
          </div>

          <div className="flex bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setActiveTab("students")}
              className={cn(
                "px-5 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === "students" ? "bg-white text-navy shadow-sm" : "text-gray-500"
              )}
            >
              الطلاب
            </button>
            <button
              onClick={() => setActiveTab("teachers")}
              className={cn(
                "px-5 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === "teachers" ? "bg-white text-navy shadow-sm" : "text-gray-500"
              )}
            >
              المعلم
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
            <p className="text-center text-gray-400 py-20 text-sm">لا يوجد أحد لعرضه</p>
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
