import { request } from "@/api/client";

export type AttendanceAction = "checkin" | "checkout" | "done";

export type AttendanceChild = {
  id: string;
  name: string;
  avatarUrl: string | null;
  period: "MORNING" | "EVENING" | null;
  classId: string | null;
  className: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  nextAction: AttendanceAction;
};

type TodayAttendanceResponse = {
  date: string;
  children: AttendanceChild[];
};

type RecordAttendanceResponse = {
  id: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  nextAction: AttendanceAction;
};

export function loadTodayAttendance() {
  return request<TodayAttendanceResponse>("/api/mobile/v1/attendance/today");
}

export function recordAttendance(
  studentId: string,
  action: Exclude<AttendanceAction, "done">
) {
  return request<RecordAttendanceResponse>("/api/mobile/v1/attendance", {
    method: "POST",
    body: { studentId, action },
  });
}
