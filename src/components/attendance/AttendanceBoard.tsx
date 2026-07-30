"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { cn } from "@/lib/utils";
import { generateQRCode } from "@/lib/qr-generator";
import { AttendanceCard } from "./AttendanceCard";
import type { AttendancePerson, AttendanceClass } from "@/lib/attendance-data";

interface AttendanceBoardProps {
  schoolId: string;
  isPublic: boolean;
  schoolName?: string | null;
}

export function AttendanceBoard({ schoolId, isPublic, schoolName }: AttendanceBoardProps) {
  const [activeTab, setActiveTab] = useState<"students" | "teachers">("students");
  const [selectedClass, setSelectedClass] = useState<string>("all");
  const [students, setStudents] = useState<AttendancePerson[]>([]);
  const [teachers, setTeachers] = useState<AttendancePerson[]>([]);
  const [classes, setClasses] = useState<AttendanceClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const url = isPublic ? `/api/attendance/public/${schoolId}` : "/api/attendance/page-data";
    const res = await axios.get<{ students: AttendancePerson[]; teachers: AttendancePerson[]; classes: AttendanceClass[] }>(url);
    setStudents(res.data.students);
    setTeachers(res.data.teachers);
    setClasses(res.data.classes);
  }, [isPublic, schoolId]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const filteredPeople = useMemo(() => {
    const people = activeTab === "students" ? students : teachers;
    if (selectedClass === "all") return people;
    return people.filter((p) => p.class_id === selectedClass);
  }, [activeTab, selectedClass, students, teachers]);

  async function handleCheckin(personId: string) {
    setActionLoadingId(personId);
    try {
      await axios.post("/api/attendance/public/checkin", {
        person_id: personId,
        type: activeTab === "students" ? "student" : "teacher",
        school_id: schoolId,
      });
      await fetchData();
    } catch {
      alert("حدث خطأ أثناء تسجيل الدخول");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCheckout(personId: string) {
    setActionLoadingId(personId);
    try {
      await axios.post("/api/attendance/public/checkout", {
        person_id: personId,
        type: activeTab === "students" ? "student" : "teacher",
        school_id: schoolId,
      });
      await fetchData();
    } catch {
      alert("حدث خطأ أثناء تسجيل الخروج");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleDownloadQR() {
    const publicUrl = `${window.location.origin}/attendance/public/${schoolId}`;
    const qrDataUrl = await generateQRCode(publicUrl);
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `qr-attendance-${schoolId}.png`;
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
