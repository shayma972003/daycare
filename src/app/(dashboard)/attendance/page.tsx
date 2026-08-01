"use client";

import { useSession } from "next-auth/react";
import { AttendanceBoard } from "@/components/attendance/AttendanceBoard";

export default function AttendancePage() {
  const { data: session, status } = useSession();
  const schoolName = (session?.user as { schoolName?: string } | undefined)?.schoolName;

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-7 h-7 border-2 border-gray-200 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  // No token here on purpose: signed-in staff read and write through the
  // session-checked routes. The kiosk token is fetched only when printing a QR.
  return <AttendanceBoard isPublic={false} schoolName={schoolName} />;
}
