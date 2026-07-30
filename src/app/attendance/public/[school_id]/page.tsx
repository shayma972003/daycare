"use client";

import { useEffect, useState, use } from "react";
import axios from "axios";
import { AttendanceBoard } from "@/components/attendance/AttendanceBoard";

export default function PublicAttendancePage({ params }: { params: Promise<{ school_id: string }> }) {
  const { school_id } = use(params);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    axios
      .get<{ school: { name: string } }>(`/api/attendance/public/${school_id}`)
      .then((res) => setSchoolName(res.data.school.name))
      .catch(() => setNotFound(true))
      .finally(() => setChecked(true));
  }, [school_id]);

  if (!checked) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="w-7 h-7 border-2 border-gray-200 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 text-center px-4" dir="rtl">
        <p className="text-gray-500 text-sm">لم يتم العثور على هذه المنشأة</p>
      </div>
    );
  }

  return <AttendanceBoard schoolId={school_id} isPublic schoolName={schoolName} />;
}
