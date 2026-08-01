"use client";

import { useEffect, useState, use } from "react";
import axios from "axios";
import { AttendanceBoard } from "@/components/attendance/AttendanceBoard";

export default function PublicAttendancePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    axios
      .get<{ school: { name: string } }>(`/api/attendance/public/${token}`)
      .then((res) => setSchoolName(res.data.school.name))
      .catch(() => setNotFound(true))
      .finally(() => setChecked(true));
  }, [token]);

  if (!checked) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="w-7 h-7 border-2 border-gray-200 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div
        className="flex items-center justify-center h-screen bg-gray-50 text-center px-4"
        dir="rtl"
      >
        <div className="max-w-sm">
          <p className="text-gray-700 text-sm font-bold mb-2">هذا الرابط لم يعد صالحاً</p>
          <p className="text-gray-500 text-sm leading-relaxed">
            قد يكون رمز الجهاز قد جُدِّد. اطلبي رمز QR جديداً من صفحة الحضور في لوحة التحكم.
          </p>
        </div>
      </div>
    );
  }

  return <AttendanceBoard token={token} isPublic schoolName={schoolName} />;
}
