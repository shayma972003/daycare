"use client";

import { useSession } from "next-auth/react";
import { AttendanceBoard } from "@/components/attendance/AttendanceBoard";

export default function AttendancePage() {
  const { data: session } = useSession();
  const schoolId = (session?.user as { schoolId?: string } | undefined)?.schoolId;
  const schoolName = (session?.user as { schoolName?: string } | undefined)?.schoolName;

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-7 h-7 border-2 border-gray-200 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  return <AttendanceBoard schoolId={schoolId} isPublic={false} schoolName={schoolName} />;
}
