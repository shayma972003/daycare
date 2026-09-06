import { validTimeZone, zonedTimeOnDate } from "@/lib/device-date";

export type ActivityTimingInput = {
  startDate: string;
  endDate: string;
  allDay?: boolean;
  timeZone?: string;
};

export type ParsedActivityTiming = {
  startDate: Date;
  endDate: Date;
  allDay?: boolean;
};

export type ActivityFormRequestInput = {
  name: string;
  teacherId: string;
  childrenCount: number;
  stageId: string;
  period: "MORNING" | "EVENING";
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  fee: number;
  message: string;
  classIds: string[];
};

export type ActivityRequestPayload = Omit<
  ActivityFormRequestInput,
  "startTime" | "endTime"
> & {
  timeZone: string;
  imageUrl: string | null;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * New activities explicitly choose all-day or timed. Calls from an older
 * client omit allDay and retain the legacy date-only contract.
 */
export function parseActivityTiming(input: ActivityTimingInput): ParsedActivityTiming | null {
  if (input.allDay === false && (!input.timeZone || !validTimeZone(input.timeZone))) return null;

  const startDate = input.allDay === true && DATE_ONLY.test(input.startDate)
    ? new Date(`${input.startDate}T00:00:00.000Z`)
    : new Date(input.startDate);
  const endDate = input.allDay === true && DATE_ONLY.test(input.endDate)
    ? new Date(`${input.endDate}T00:00:00.000Z`)
    : new Date(input.endDate);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  if (input.allDay === false ? endDate <= startDate : endDate < startDate) return null;
  return {
    startDate,
    endDate,
    ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
  };
}

/**
 * Convert editor-only date/time controls into the strict Activity API contract.
 * Keeping the allow-list here prevents UI helpers such as startTime/endTime
 * from leaking into a `.strict()` route schema.
 */
export function buildActivityRequestPayload(
  input: ActivityFormRequestInput,
  imageUrl: string | null,
  timeZone: string
): ActivityRequestPayload | null {
  const startDate = input.allDay
    ? input.startDate
    : zonedTimeOnDate(input.startDate, input.startTime, timeZone)?.toISOString();
  const endDate = input.allDay
    ? input.endDate
    : zonedTimeOnDate(input.endDate, input.endTime, timeZone)?.toISOString();

  if (
    !startDate ||
    !endDate ||
    (input.allDay ? endDate < startDate : new Date(endDate) <= new Date(startDate))
  ) {
    return null;
  }

  return {
    name: input.name,
    teacherId: input.teacherId,
    childrenCount: input.childrenCount,
    stageId: input.stageId,
    period: input.period,
    startDate,
    endDate,
    allDay: input.allDay,
    timeZone,
    fee: input.fee,
    imageUrl,
    message: input.message,
    classIds: input.classIds,
  };
}
