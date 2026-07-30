"use client";

import type { AttendancePerson } from "@/lib/attendance-data";

interface AttendanceCardProps {
  person: AttendancePerson;
  onCheckin: () => void;
  onCheckout: () => void;
  loading?: boolean;
}

export function AttendanceCard({ person, onCheckin, onCheckout, loading }: AttendanceCardProps) {
  const isCheckedIn = !!person.today_attendance?.checkin_time;
  const isCheckedOut = !!person.today_attendance?.checkout_time;

  return (
    <div className="bg-white rounded-xl p-4 shadow-card flex flex-col items-center gap-3 text-center">
      <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
        {person.avatar_url ? (
          <img src={person.avatar_url} alt={person.full_name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center text-gray-400 text-xs">
            [صورة]
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-bold text-gray-900 leading-tight">{person.full_name}</p>
        <p className="text-xs text-gray-400 mt-0.5">{person.class_name ?? "—"}</p>
        <p className="text-xs text-gray-300">{person.period === "MORNING" ? "صباحي" : person.period === "EVENING" ? "مسائي" : "—"}</p>
      </div>

      {isCheckedIn && (
        <div className="text-xs text-gray-500">
          <span>دخول: </span>
          <span className="font-medium text-teal">
            {new Date(person.today_attendance!.checkin_time!).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
          </span>
          {isCheckedOut && (
            <>
              <span className="mx-1">|</span>
              <span>خروج: </span>
              <span className="font-medium text-coral">
                {new Date(person.today_attendance!.checkout_time!).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 w-full">
        {!isCheckedIn && (
          <button
            onClick={onCheckin}
            disabled={loading}
            className="w-full py-2 rounded-lg bg-[#2D7A4F] text-white text-xs font-medium hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
          >
            تسجيل الدخول
          </button>
        )}
        {isCheckedIn && !isCheckedOut && (
          <button
            onClick={onCheckout}
            disabled={loading}
            className="w-full py-2 rounded-lg bg-coral text-white text-xs font-medium hover:bg-coral-dark transition-all active:scale-95 disabled:opacity-50"
          >
            تسجيل الخروج
          </button>
        )}
        {isCheckedOut && (
          <div className="w-full py-2 rounded-lg bg-gray-100 text-gray-400 text-xs text-center">انتهى الدوام</div>
        )}
      </div>
    </div>
  );
}
