"use client";

/**
 * The nursery calendar (tasks 2.19–2.21).
 *
 * Day and week are drawn on an hour grid because their question is "when, and
 * does it clash". Month is drawn as cells because at that zoom the hour is
 * noise and the question is "what is happening this month" — so it lists titles
 * rather than positioning blocks.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { describeApiError } from "@/lib/api-error";
import { formatAst, astParts } from "@/lib/datetime";
import { WEEKDAY_LABELS } from "@/lib/attendance-schedule";
import {
  rangeFor,
  shiftAnchor,
  isSameAstDay,
  isSameAstMonth,
  CALENDAR_VIEW_LABELS,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_STYLES,
  DAY_START_HOUR,
  DAY_END_HOUR,
  type CalendarView,
} from "@/lib/calendar";
import { CalendarEventModal } from "@/components/calendar/CalendarEventModal";
import type { CalendarEventType } from "@/generated/prisma/enums";

interface EventRow {
  id: string;
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
}

interface Option {
  id: string;
  name: string;
}

export default function CalendarPage() {
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<EventRow[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [teachers, setTeachers] = useState<Option[]>([]);
  const [classFilter, setClassFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [creating, setCreating] = useState<Date | null>(null);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    });
    if (classFilter) params.set("classId", classFilter);
    if (teacherFilter) params.set("teacherId", teacherFilter);

    try {
      const response = await axios.get<EventRow[]>(`/api/calendar?${params.toString()}`);
      setEvents(response.data);
      setError(null);
    } catch (err) {
      setError(describeApiError(err, "تعذر تحميل التقويم"));
    }
  }, [range.from, range.to, classFilter, teacherFilter]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    });
    if (classFilter) params.set("classId", classFilter);
    if (teacherFilter) params.set("teacherId", teacherFilter);

    axios
      .get<EventRow[]>(`/api/calendar?${params.toString()}`)
      .then((response) => {
        if (!cancelled) setEvents(response.data);
      })
      .catch((err) => {
        if (!cancelled) setError(describeApiError(err, "تعذر تحميل التقويم"));
      });

    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, classFilter, teacherFilter]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      axios.get<Option[]>("/api/classes"),
      axios.get<Option[]>("/api/teachers"),
    ])
      .then(([classesRes, teachersRes]) => {
        if (cancelled) return;
        setClasses(classesRes.data);
        setTeachers(teachersRes.data);
      })
      .catch(() => {
        // Filters are optional; the calendar works without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hours = useMemo(
    () =>
      Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i),
    []
  );

  function eventsOn(day: Date) {
    return events.filter((event) => isSameAstDay(new Date(event.startAt), day));
  }

  const periodLabel =
    view === "month"
      ? formatAst(anchor, { year: "numeric", month: "long" })
      : view === "day"
        ? formatAst(anchor, { weekday: "long", year: "numeric", month: "long", day: "numeric" })
        : `${formatAst(range.days[0], { month: "short", day: "numeric" })} — ${formatAst(
            range.days[6],
            { month: "short", day: "numeric" }
          )}`;

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title="التقويم" />

      <div className="p-6 space-y-4">
        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex bg-gray-100 rounded-xl p-1">
            {(["day", "week", "month"] as CalendarView[]).map((option) => (
              <button
                key={option}
                onClick={() => setView(option)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  view === option ? "bg-white shadow text-[#111111]" : "text-gray-500"
                }`}
              >
                {CALENDAR_VIEW_LABELS[option]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setAnchor((current) => shiftAnchor(view, current, -1))}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
            >
              السابق
            </button>
            <button
              onClick={() => setAnchor(new Date())}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
            >
              اليوم
            </button>
            <button
              onClick={() => setAnchor((current) => shiftAnchor(view, current, 1))}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
            >
              التالي
            </button>
          </div>

          <span className="text-sm font-medium text-[#111111]">{periodLabel}</span>

          <div className="flex items-center gap-2 mr-auto">
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">كل الفصول</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <select
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">كل المعلمات</option>
              {teachers.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <button
              onClick={() => setCreating(anchor)}
              className="px-4 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e]"
            >
              إضافة
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4 overflow-x-auto">
          {view === "month" ? (
            <MonthGrid days={range.days} anchor={anchor} eventsOn={eventsOn} onSelect={setEditing} />
          ) : (
            <HourGrid
              days={range.days}
              hours={hours}
              eventsOn={eventsOn}
              onSelect={setEditing}
              onCreate={setCreating}
            />
          )}
        </div>
      </div>

      {(creating || editing) && (
        <CalendarEventModal
          event={editing}
          defaultDate={creating ?? new Date()}
          classes={classes}
          teachers={teachers}
          onClose={() => {
            setCreating(null);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(null);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/** Day and week share this — one column is just a week with seven fewer. */
function HourGrid({
  days,
  hours,
  eventsOn,
  onSelect,
  onCreate,
}: {
  days: Date[];
  hours: number[];
  eventsOn: (day: Date) => EventRow[];
  onSelect: (event: EventRow) => void;
  onCreate: (day: Date) => void;
}) {
  return (
    <div className="min-w-[640px]">
      <div
        className="grid border-b border-gray-100"
        style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}
      >
        <div />
        {days.map((day) => (
          <div key={day.toISOString()} className="text-center py-2">
            <div className="text-xs text-gray-500">
              {WEEKDAY_LABELS[new Date(Date.UTC(astParts(day).year, astParts(day).month, astParts(day).day)).getUTCDay()]}
            </div>
            <div
              className={`text-sm font-medium ${
                isSameAstDay(day, new Date()) ? "text-[#2F96A6]" : "text-[#111111]"
              }`}
            >
              {astParts(day).day}
            </div>
          </div>
        ))}
      </div>

      {hours.map((hour) => (
        <div
          key={hour}
          className="grid border-b border-gray-50"
          style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div className="text-[11px] text-gray-400 py-2 pl-2 text-left" dir="ltr">
            {String(hour).padStart(2, "0")}:00
          </div>
          {days.map((day) => {
            const slotEvents = eventsOn(day).filter((event) => {
              if (event.allDay) return hour === DAY_START_HOUR;
              return astParts(new Date(event.startAt)).hour === hour;
            });
            return (
              <button
                key={`${day.toISOString()}-${hour}`}
                onClick={() => slotEvents.length === 0 && onCreate(day)}
                className="min-h-[44px] border-r border-gray-50 p-1 text-right align-top hover:bg-gray-50/60 transition-colors"
              >
                {slotEvents.map((event) => (
                  <span
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(event);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        onSelect(event);
                      }
                    }}
                    className={`block text-[11px] leading-tight rounded-md border-r-2 px-1.5 py-1 mb-1 truncate cursor-pointer ${
                      EVENT_TYPE_STYLES[event.type]
                    }`}
                  >
                    {event.title}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MonthGrid({
  days,
  anchor,
  eventsOn,
  onSelect,
}: {
  days: Date[];
  anchor: Date;
  eventsOn: (day: Date) => EventRow[];
  onSelect: (event: EventRow) => void;
}) {
  return (
    <div className="min-w-[640px]">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="text-center text-xs text-gray-500 py-2">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayEvents = eventsOn(day);
          // Days padded in from the neighbouring months are dimmed rather than
          // hidden, so the grid stays rectangular and the week rows line up.
          const outside = !isSameAstMonth(day, anchor);
          return (
            <div
              key={day.toISOString()}
              className={`min-h-[92px] border-b border-l border-gray-50 p-1.5 ${
                outside ? "bg-gray-50/40" : ""
              }`}
            >
              <div
                className={`text-xs mb-1 ${
                  isSameAstDay(day, new Date())
                    ? "text-[#2F96A6] font-bold"
                    : outside
                      ? "text-gray-300"
                      : "text-gray-600"
                }`}
              >
                {astParts(day).day}
              </div>
              {dayEvents.slice(0, 3).map((event) => (
                <button
                  key={event.id}
                  onClick={() => onSelect(event)}
                  className={`block w-full text-right text-[11px] leading-tight rounded-md border-r-2 px-1.5 py-0.5 mb-1 truncate ${
                    EVENT_TYPE_STYLES[event.type]
                  }`}
                  title={`${EVENT_TYPE_LABELS[event.type]}: ${event.title}`}
                >
                  {event.title}
                </button>
              ))}
              {dayEvents.length > 3 && (
                <span className="text-[10px] text-gray-400">
                  +{dayEvents.length - 3} أخرى
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
