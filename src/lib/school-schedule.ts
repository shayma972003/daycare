export type SchoolPeriod = "MORNING" | "EVENING";
export type ScheduleAudience = "student" | "teacher";

export const SCHOOL_SCHEDULE_FIELDS = [
  "teacherMorningCheckinTime",
  "teacherMorningCheckoutTime",
  "teacherEveningCheckinTime",
  "teacherEveningCheckoutTime",
  "studentMorningCheckinTime",
  "studentMorningCheckoutTime",
  "studentEveningCheckinTime",
  "studentEveningCheckoutTime",
] as const;

export type SchoolScheduleField = (typeof SCHOOL_SCHEDULE_FIELDS)[number];
export type SchoolSchedule = Record<SchoolScheduleField, string | null>;

export function scheduleFieldNames(audience: ScheduleAudience, period: SchoolPeriod) {
  const prefix = `${audience}${period === "MORNING" ? "Morning" : "Evening"}` as const;
  return {
    checkin: `${prefix}CheckinTime` as SchoolScheduleField,
    checkout: `${prefix}CheckoutTime` as SchoolScheduleField,
  };
}

export function scheduleFor(
  schedule: Partial<SchoolSchedule> | null | undefined,
  audience: ScheduleAudience,
  period: SchoolPeriod
) {
  const fields = scheduleFieldNames(audience, period);
  return {
    checkin: schedule?.[fields.checkin] ?? null,
    checkout: schedule?.[fields.checkout] ?? null,
  };
}

export type ScheduleValidationIssue = "INCOMPLETE_SCHEDULE" | "INVALID_SCHEDULE_RANGE";

export function validateSchoolSchedule(schedule: Partial<SchoolSchedule>): ScheduleValidationIssue | null {
  for (const audience of ["student", "teacher"] as const) {
    for (const period of ["MORNING", "EVENING"] as const) {
      const { checkin, checkout } = scheduleFor(schedule, audience, period);
      if (Boolean(checkin) !== Boolean(checkout)) return "INCOMPLETE_SCHEDULE";
      if (checkin && checkout && checkout <= checkin) return "INVALID_SCHEDULE_RANGE";
    }
  }
  return null;
}
