import { request } from "@/api/client";

export type CalendarEventType = "LESSON" | "ACTIVITY" | "ANNOUNCEMENT" | "UNIT";

export type MobileCalendarEvent = {
  id: string;
  type: CalendarEventType;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  classNames: string[];
  schoolWide: boolean;
};

type CalendarResponse = {
  from: string;
  to: string;
  events: MobileCalendarEvent[];
};

export function loadCalendar(from: string, to: string): Promise<CalendarResponse> {
  const query = new URLSearchParams({ from, to });
  return request<CalendarResponse>(`/api/mobile/v1/calendar?${query.toString()}`);
}
