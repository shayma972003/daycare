"use client";

import type { AttendancePerson } from "@/lib/attendance-data";
import { useT } from "@/lib/i18n-provider";
import { useLocale } from "@/lib/i18n-provider";
import { formatDeviceTime } from "@/lib/device-date";

interface AttendanceCardProps {
  person: AttendancePerson;
  onCheckin: () => void;
  onCheckout: () => void;
  loading?: boolean;
}

export function AttendanceCard({ person, onCheckin, onCheckout, loading }: AttendanceCardProps) {
  const t = useT();
  const { locale } = useLocale();
  const displayedAttendance = person.open_attendance ?? person.today_attendance;
  const isCheckedIn = !!displayedAttendance?.checkin_time;
  const isCheckedOut = !!displayedAttendance?.checkout_time;
  const openFromPreviousDay = Boolean(
    person.open_attendance &&
      person.today_attendance?.checkin_time !== person.open_attendance.checkin_time
  );

  return (
    <div className="bg-white rounded-xl p-4 shadow-card flex flex-col items-center gap-3 text-center">
      <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
        {person.avatar_url ? (
          <img src={person.avatar_url} alt={person.full_name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center text-gray-400 text-xs">
            {t("common.imagePlaceholder")}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-bold text-gray-900 leading-tight">{person.full_name}</p>
        <p className="text-xs text-gray-400 mt-0.5">{person.class_name ?? "—"}</p>
        <p className="text-xs text-gray-300">{person.period === "MORNING" ? t("fields.morning") : person.period === "EVENING" ? t("fields.evening") : "—"}</p>
      </div>

      {isCheckedIn && (
        <div className="text-xs text-gray-500">
          <span>{t("attendance.checkInLabel")} </span>
          <span className="font-medium text-teal">
            {formatDeviceTime(new Date(displayedAttendance!.checkin_time!), openFromPreviousDay
              ? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
              : { hour: "2-digit", minute: "2-digit" }, locale)}
          </span>
          {isCheckedOut && (
            <>
              <span className="mx-1">|</span>
              <span>{t("attendance.checkOutLabel")} </span>
              <span className="font-medium text-coral">
                {formatDeviceTime(new Date(displayedAttendance!.checkout_time!), { hour: "2-digit", minute: "2-digit" }, locale)}
              </span>
            </>
          )}
          {!isCheckedOut && (
            <span className="ms-2 text-amber-600">{t("attendance.notCheckedOut")}</span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 w-full">
        {person.has_overlapping_open_attendance && (
          <div role="alert" className="w-full rounded-lg bg-red-50 px-2 py-2 text-xs text-red-700">
            {t("attendance.overlappingOpenSessions")}
          </div>
        )}
        {!isCheckedIn && person.eligible_for_attendance !== false && !person.has_overlapping_open_attendance && (
          <button
            onClick={onCheckin}
            disabled={loading}
            className="w-full py-2 rounded-lg bg-[#2D7A4F] text-white text-xs font-medium hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
          >
            {t("auth.login")}
          </button>
        )}
        {isCheckedIn && !isCheckedOut && !person.has_overlapping_open_attendance && (
          <button
            onClick={onCheckout}
            disabled={loading}
            className="w-full py-2 rounded-lg bg-coral text-white text-xs font-medium hover:bg-coral-dark transition-all active:scale-95 disabled:opacity-50"
          >
            {t("auth.logout")}
          </button>
        )}
        {isCheckedOut && (
          <div className="w-full py-2 rounded-lg bg-gray-100 text-gray-400 text-xs text-center">{t("attendanceStatus.CHECKED_OUT")}</div>
        )}
        {!isCheckedIn && person.eligible_for_attendance === false && (
          <div className="w-full py-2 rounded-lg bg-gray-100 text-gray-500 text-xs text-center">
            {t("attendance.notEligible")}
          </div>
        )}
      </div>
    </div>
  );
}
