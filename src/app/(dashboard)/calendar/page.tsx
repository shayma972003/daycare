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
import { WEEKDAY_LABEL_KEYS } from "@/lib/attendance-schedule";
import {
  rangeFor,
  shiftAnchor,
  isSameAstDay,
  isSameAstMonth,
  CALENDAR_VIEW_LABEL_KEYS,
  EVENT_TYPE_LABEL_KEYS,
  EVENT_TYPE_STYLES,
  DAY_START_HOUR,
  DAY_END_HOUR,
  hourLabel,
  hoursOccupied,
  coversDay,
  type CalendarView,
} from "@/lib/calendar";
import { CalendarEventModal } from "@/components/calendar/CalendarEventModal";
import type { Activity as ActivityRecord } from "@/components/activities/ActivityGrid";
import type { CalendarEventType } from "@/generated/prisma/enums";
import { useT, useLocale } from "@/lib/i18n-provider";

interface EventRow {
  id: string;
  /** "activity" rows come from the Activity table and open a different editor. */
  kind?: "event" | "activity";
  /** Present on activity rows — the record the activity editor reads. */
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
}

interface Option {
  id: string;
  name: string;
}

/** A rota entry, shown read-only. Editing one happens on the staff screens. */
interface ShiftRow {
  id: string;
  teacherId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export default function CalendarPage() {
  // Locale-aware translation — see src/lib/i18n.ts.
  const t = useT();
  // The header range is built by Intl, which needs the language told to it —
  // otherwise the month and weekday names follow the host and stay Arabic.
  const { locale } = useLocale();
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<EventRow[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [teachers, setTeachers] = useState<Option[]>([]);
  const [classFilter, setClassFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [creating, setCreating] = useState<Date | null>(null);
  /* Activities are edited in their own form — they carry a fee, a stage and
     guardian invitations that the event form has no fields for. */
  const [activity, setActivity] = useState<ActivityRecord | null>(null);

  function openRow(row: EventRow) {
    if (row.kind !== "activity" || !row.activity) {
      setEditing(row);
      return;
    }
    // No second request: the calendar row already carries the record, in the
    // shape the editor reads.
    setActivity(row.activity);
  }

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
      setError(describeApiError(err, t("calendar.loadFailed")));
    }
  }, [range.from, range.to, classFilter, teacherFilter, t]);

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
        if (!cancelled) setError(describeApiError(err, t("calendar.loadFailed")));
      });

    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, classFilter, teacherFilter, t]);

  useEffect(() => {
    let cancelled = false;
    /**
     * `allSettled`, not `all`.
     *
     * These two lists need different permissions — `/api/classes` wants
     * `classes.view` and `/api/teachers` wants `staff.view` — and a teacher
     * holds the first without the second. Under `Promise.all` her 403 on
     * teachers rejected the whole batch, so the classes that *had* loaded were
     * thrown away with it. The visible symptom was the event form's class
     * picker rendering its heading above nothing at all, on exactly the roles
     * that use the calendar most.
     *
     * Each list now stands or falls on its own.
     */
    Promise.allSettled([
      axios.get<Option[]>("/api/classes"),
      axios.get<Option[]>("/api/teachers"),
    ]).then(([classesRes, teachersRes]) => {
      if (cancelled) return;
      if (classesRes.status === "fulfilled") setClasses(classesRes.value.data);
      if (teachersRes.status === "fulfilled") setTeachers(teachersRes.value.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A teacher's rota, drawn under the day headings.
   *
   * Only fetched when a teacher is chosen. Every staff member's shifts at once
   * would be a band of overlapping times that answers no question — the useful
   * question is "when is *she* working", and that is what the filter already
   * says the reader is asking.
   *
   * Shifts stay their own records rather than becoming calendar events: a shift
   * is unique per teacher per day, and that constraint is what stops the same
   * person being rostered twice. An event table has no such rule.
   */
  useEffect(() => {
    // No clearing here — `shiftOn` below already answers null without a filter,
    // so the state is simply left alone rather than reset from an effect.
    if (!teacherFilter) return;
    let cancelled = false;
    const params = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      teacherId: teacherFilter,
    });
    axios
      .get<{ shifts: ShiftRow[] }>(`/api/shifts?${params.toString()}`)
      .then((response) => {
        if (!cancelled) setShifts(response.data.shifts ?? []);
      })
      .catch(() => {
        // The rota is an overlay; the calendar is still readable without it.
        if (!cancelled) setShifts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherFilter, range.from, range.to]);

  const shiftOn = useCallback(
    (day: Date) => {
      // Gated on the filter, not on the array: whatever was fetched for the
      // previously selected teacher must not keep showing after she is
      // deselected, and this is true the render it happens rather than one
      // render later once a fetch has come back.
      if (!teacherFilter) return null;
      const parts = astParts(day);
      const key = `${parts.year}-${String(parts.month + 1).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
      return shifts.find((shift) => shift.date.slice(0, 10) === key) ?? null;
    },
    [shifts, teacherFilter]
  );

  const hours = useMemo(
    () =>
      Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i),
    []
  );

  /**
   * Every day an event covers, not just the one it starts on.
   *
   * A programme running the 5th to the 19th was drawn on the 5th and nowhere
   * else, so a fortnight of activity looked like a single morning — and the
   * week containing the 12th showed an empty calendar for something that was
   * running all week.
   *
   * Compared by AST calendar day rather than by instant: an event ending at
   * 09:00 on the 19th still belongs on the 19th, and one starting at 23:00 does
   * not belong on the 20th.
   */
  function eventsOn(day: Date) {
    return events.filter((event) =>
      coversDay(new Date(event.startAt), event.endAt ? new Date(event.endAt) : null, day)
    );
  }

  /** True on the days after the first — those render as a band, not at an hour. */
  function isContinuation(event: EventRow, day: Date) {
    return !isSameAstDay(new Date(event.startAt), day);
  }

  const periodLabel =
    view === "month"
      ? formatAst(anchor, { year: "numeric", month: "long" }, locale)
      : view === "day"
        ? formatAst(anchor, { weekday: "long", year: "numeric", month: "long", day: "numeric" }, locale)
        : `${formatAst(range.days[0], { month: "short", day: "numeric" }, locale)} — ${formatAst(
            range.days[6],
            { month: "short", day: "numeric" },
            locale
          )}`;

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title={t("calendar.title")} />

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
                {t(CALENDAR_VIEW_LABEL_KEYS[option])}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setAnchor((current) => shiftAnchor(view, current, -1))}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
            >
              {t("common.previous")}
            </button>
            <button
              onClick={() => setAnchor((current) => shiftAnchor(view, current, 1))}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
            >
              {t("common.next")}
            </button>
          </div>

          <span className="text-sm font-medium text-[#111111]">{periodLabel}</span>

          <div className="flex items-center gap-2 mr-auto">
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t("common.allClasses")}</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <select
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t("common.allTeachers")}</option>
              {teachers.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <button
              onClick={() => setCreating(anchor)}
              className="px-4 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e]"
            >
              {t("common.add")}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4 overflow-x-auto">
          {view === "month" ? (
            <MonthGrid days={range.days} anchor={anchor} eventsOn={eventsOn} onSelect={openRow} />
          ) : (
            <HourGrid
              days={range.days}
              hours={hours}
              eventsOn={eventsOn}
              isContinuation={isContinuation}
              shiftOn={shiftOn}
              locale={locale}
              onSelect={openRow}
              onCreate={setCreating}
            />
          )}
        </div>
      </div>

      {(creating || editing || activity) && (
        <CalendarEventModal
          event={editing}
          activity={activity}
          defaultDate={creating ?? new Date()}
          classes={classes}
          teachers={teachers}
          onClose={() => {
            setCreating(null);
            setEditing(null);
            setActivity(null);
          }}
          onSaved={() => {
            setCreating(null);
            setEditing(null);
            setActivity(null);
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
  isContinuation,
  shiftOn,
  locale,
  onSelect,
  onCreate,
}: {
  days: Date[];
  hours: number[];
  eventsOn: (day: Date) => EventRow[];
  isContinuation: (event: EventRow, day: Date) => boolean;
  shiftOn: (day: Date) => ShiftRow | null;
  /** The hour column is written in words, so it needs the reader's language. */
  locale: "ar" | "en";
  onSelect: (event: EventRow) => void;
  onCreate: (day: Date) => void;
}) {
  const t = useT();
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
              {t(WEEKDAY_LABEL_KEYS[new Date(Date.UTC(astParts(day).year, astParts(day).month, astParts(day).day)).getUTCDay()])}
            </div>
            <div
              className={`text-sm font-medium ${
                isSameAstDay(day, new Date()) ? "text-[#2F96A6]" : "text-[#111111]"
              }`}
            >
              {astParts(day).day}
            </div>
            {/* The rota, when a teacher is selected. Read-only on purpose —
                a shift is changed where it is planned, not in passing. */}
            {shiftOn(day) && (
              <div
                className="mt-1 mx-1 rounded-md bg-[#F3EEFF] text-[#4c1d95] text-[10px] py-0.5"
                dir="ltr"
                title={t("shifts.title")}
              >
                {shiftOn(day)!.startTime}–{shiftOn(day)!.endTime}
              </div>
            )}
          </div>
        ))}
      </div>

      {hours.map((hour) => (
        <div
          key={hour}
          className="grid border-b border-gray-50"
          style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div className="text-[11px] text-gray-400 py-2 px-2 text-start whitespace-nowrap">
            {hourLabel(hour, locale)}
          </div>
          {days.map((day) => {
            const slotEvents = eventsOn(day).filter((event) => {
              // Days after the first have no start hour of their own, so they
              // sit in the first row like an all-day band.
              if (event.allDay || isContinuation(event, day)) return hour === DAY_START_HOUR;

              /**
               * Every hour the event occupies, not only the one it starts in.
               *
               * A lesson from 17:00 to 19:00 was a single cell at 17:00, so two
               * rooms booked 17:00–19:00 and 18:00–19:00 looked like they never
               * met. The row an event sits in is what "does this clash" is read
               * from, and one row cannot answer it.
               */
              const startParts = astParts(new Date(event.startAt));
              const end = event.endAt ? new Date(event.endAt) : null;
              // Null hour/minute means "finishes on a later day" — see hoursOccupied.
              const sameDayEnd = end && isSameAstDay(end, day) ? astParts(end) : null;
              return hoursOccupied(
                startParts.hour,
                startParts.minute,
                end ? (sameDayEnd ? sameDayEnd.hour : null) : startParts.hour,
                end ? (sameDayEnd ? sameDayEnd.minute : null) : startParts.minute
              ).includes(hour);
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
  const t = useT();
  return (
    <div className="min-w-[640px]">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {WEEKDAY_LABEL_KEYS.map((key) => (
          <div key={key} className="text-center text-xs text-gray-500 py-2">
            {t(key)}
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
                  title={`${t(EVENT_TYPE_LABEL_KEYS[event.type])}: ${event.title}`}
                >
                  {event.title}
                </button>
              ))}
              {dayEvents.length > 3 && (
                <span className="text-[10px] text-gray-400">
                  {t("calendar.moreEvents", { n: String(dayEvents.length - 3) })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
