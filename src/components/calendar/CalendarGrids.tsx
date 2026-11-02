"use client";

import { useState } from "react";
import type { Activity as ActivityRecord } from "@/components/activities/ActivityGrid";
import type { CalendarEventType } from "@/generated/prisma/enums";
import { WEEKDAY_LABEL_KEYS } from "@/lib/attendance-schedule";
import {
  EVENT_TYPE_LABEL_KEYS,
  EVENT_TYPE_STYLES,
  calendarStartHour,
  hourLabel,
  isSameCalendarDay,
  isSameCalendarMonth,
  type CalendarTiming,
} from "@/lib/calendar";
import { dateKeyInTimeZone, zonedTimeOnDate } from "@/lib/device-date";
import { useT } from "@/lib/i18n-provider";

export interface EventRow {
  id: string;
  kind?: "event" | "activity";
  source: "event" | "activity";
  sourceId: string;
  timing: CalendarTiming;
  activity?: ActivityRecord;
  type: CalendarEventType;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  teacherId: string | null;
  location: string | null;
  classIds: string[];
  unit: { id: string; name: string } | null;
  classNames?: string[];
}

/** A rota entry, shown read-only. Editing one happens on the staff screens. */
export interface ShiftRow {
  id: string;
  teacherId: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** Day and week share this — one column is just a week with seven fewer. */
export function HourGrid({
  days,
  hours,
  eventsOn,
  shiftOn,
  locale,
  timeZone,
  onSelect,
  onCreate,
}: {
  days: Date[];
  hours: number[];
  eventsOn: (day: Date) => EventRow[];
  shiftOn: (day: Date) => ShiftRow[];
  locale: "ar" | "en";
  timeZone: string;
  onSelect: (event: EventRow) => void;
  onCreate?: (day: Date) => void;
}) {
  const t = useT();
  return (
    <div className="min-w-[640px]">
      <div className="grid border-b border-gray-100" style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((day) => (
          <div key={day.toISOString()} className="text-center py-2">
            <div className="text-xs text-gray-500">
              {t(WEEKDAY_LABEL_KEYS[new Date(`${dateKeyInTimeZone(day, timeZone)}T00:00:00.000Z`).getUTCDay()])}
            </div>
            <div className={`text-sm font-medium ${isSameCalendarDay(day, new Date(), timeZone) ? "text-[#5B14D1]" : "text-[#111111]"}`}>
              {Number(dateKeyInTimeZone(day, timeZone).slice(8, 10))}
            </div>
            {shiftOn(day).map((shift) => (
              <div key={shift.id} className="mt-1 mx-1 rounded-md bg-[#F3EEFF] text-[#4c1d95] text-[10px] py-0.5" dir="ltr" title={t("shifts.title")}>
                {shift.startTime}–{shift.endTime}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="grid border-b border-gray-100 bg-gray-50/50" style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="px-2 py-2 text-[11px] text-gray-500">{t("calendar.allDay")}</div>
        {days.map((day) => (
          <div key={`all-day-${day.toISOString()}`} className="flex min-h-10 flex-wrap content-start gap-1 border-s border-gray-100 p-1">
            {eventsOn(day).filter((event) => event.timing !== "timed").map((event) => (
              <button key={`${event.source}:${event.sourceId}`} type="button" onClick={() => onSelect(event)} className={`inline-flex w-fit max-w-full whitespace-normal break-words rounded-md border-s-2 px-1.5 py-1 text-start text-[11px] leading-tight ${EVENT_TYPE_STYLES[event.type]}`}>
                {event.title}
              </button>
            ))}
          </div>
        ))}
      </div>

      {hours.map((hour) => (
        <div key={hour} className="grid border-b border-gray-50" style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="text-[11px] text-gray-400 py-2 px-2 text-start whitespace-nowrap">{hourLabel(hour, locale)}</div>
          {days.map((day) => {
            const slotEvents = eventsOn(day).filter((event) => event.timing === "timed" && calendarStartHour(event, day, timeZone)?.hour === hour);
            const slotDate = zonedTimeOnDate(dateKeyInTimeZone(day, timeZone), `${String(hour).padStart(2, "0")}:00`, timeZone) ?? day;
            return (
              <div key={`${day.toISOString()}-${hour}`} className="min-h-[44px] border-s border-gray-50 p-1 align-top">
                {slotEvents.length === 0 ? (
                  <button type="button" onClick={() => onCreate?.(slotDate)} aria-label={`${t("calendar.newEvent")} ${hourLabel(hour, locale)}`} className="min-h-[36px] w-full rounded hover:bg-gray-50/60" />
                ) : (
                  <div className="flex flex-wrap items-start gap-1">
                    {slotEvents.map((event) => {
                      const placement = calendarStartHour(event, day, timeZone);
                      return (
                        <button key={`${event.source}:${event.sourceId}`} type="button" onClick={() => onSelect(event)} className={`inline-flex w-fit max-w-full whitespace-normal break-words rounded-md border-s-2 px-1.5 py-1 text-start text-[11px] leading-tight ${EVENT_TYPE_STYLES[event.type]}`}>
                          {placement?.continuation && <span aria-hidden="true">↪&nbsp;</span>}
                          {event.title}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function MonthGrid({ days, anchor, eventsOn, onSelect, timeZone }: {
  days: Date[];
  anchor: Date;
  eventsOn: (day: Date) => EventRow[];
  onSelect: (event: EventRow) => void;
  timeZone: string;
}) {
  const t = useT();
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  return (
    <div className="min-w-[640px]">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {WEEKDAY_LABEL_KEYS.map((key) => <div key={key} className="text-center text-xs text-gray-500 py-2">{t(key)}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayEvents = eventsOn(day);
          const dayKey = dateKeyInTimeZone(day, timeZone);
          const outside = !isSameCalendarMonth(day, anchor, timeZone);
          return (
            <div key={day.toISOString()} className={`min-h-[92px] border-b border-s border-gray-50 p-1.5 ${outside ? "bg-gray-50/40" : ""}`}>
              <div className={`text-xs mb-1 ${isSameCalendarDay(day, new Date(), timeZone) ? "text-[#5B14D1] font-bold" : outside ? "text-gray-300" : "text-gray-600"}`}>
                {Number(dayKey.slice(8, 10))}
              </div>
              {dayEvents.slice(0, expandedDay === dayKey ? dayEvents.length : 3).map((event) => (
                <button key={`${event.source}:${event.sourceId}`} onClick={() => onSelect(event)} className={`mb-1 block w-full whitespace-normal break-words rounded-md border-s-2 px-1.5 py-0.5 text-start text-[11px] leading-tight ${EVENT_TYPE_STYLES[event.type]}`} title={`${t(EVENT_TYPE_LABEL_KEYS[event.type])}: ${event.title}`}>
                  {event.title}
                </button>
              ))}
              {dayEvents.length > 3 && expandedDay !== dayKey && (
                <button type="button" onClick={() => setExpandedDay(dayKey)} className="text-[10px] text-gray-500 underline">
                  {t("calendar.moreEvents", { n: String(dayEvents.length - 3) })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
