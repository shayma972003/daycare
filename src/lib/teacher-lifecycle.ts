import { calendarToday, storedDate } from "@/lib/device-date";

export interface TeacherLifecycleInput {
  isActive: boolean;
  status?: string | null;
  enrollmentEndDate?: Date | string | null;
}

/** Contract end is inclusive in the device calendar. */
export function isTeacherOperational(
  teacher: TeacherLifecycleInput,
  at: Date = new Date(),
  timeZone?: string,
): boolean {
  if (!teacher.isActive || (teacher.status != null && teacher.status !== "ACTIVE")) return false;
  if (!teacher.enrollmentEndDate) return true;
  return storedDate(teacher.enrollmentEndDate).getTime() >= calendarToday(at, timeZone).getTime();
}
