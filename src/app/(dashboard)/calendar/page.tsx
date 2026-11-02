"use client";

/**
 * The nursery calendar (tasks 2.19–2.21).
 *
 * Day and week are drawn on an hour grid because their question is "when, and
 * does it clash". Month is drawn as cells because at that zoom the hour is
 * noise and the question is "what is happening this month" — so it lists titles
 * rather than positioning blocks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { describeApiError } from "@/lib/api-error";
import {
  dateKeyInTimeZone,
  deviceHeaders,
  deviceTimeZone,
} from "@/lib/device-date";
import {
  rangeFor,
  shiftAnchor,
  CALENDAR_VIEW_LABEL_KEYS,
  EVENT_TYPE_LABEL_KEYS,
  DAY_START_HOUR,
  DAY_END_HOUR,
  calendarSpanOnDay,
  type CalendarView,
} from "@/lib/calendar";
import { CalendarEventModal } from "@/components/calendar/CalendarEventModal";
import { HourGrid, MonthGrid, type EventRow, type ShiftRow } from "@/components/calendar/CalendarGrids";
import type { Activity as ActivityRecord } from "@/components/activities/ActivityGrid";
import type { CalendarEventType } from "@/generated/prisma/enums";
import { useT, useLocale } from "@/lib/i18n-provider";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { usePermissions } from "@/lib/use-permissions";

interface Option {
  id: string;
  name: string;
}

export default function CalendarPage() {
  // Locale-aware translation — see src/lib/i18n.ts.
  const t = useT();
  // The header range is built by Intl, which needs the language told to it —
  // otherwise the month and weekday names follow the host and stay Arabic.
  const { locale } = useLocale();
  const { can } = usePermissions();
  const [timeZone] = useState(() => deviceTimeZone());
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<EventRow[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [teachers, setTeachers] = useState<Option[]>([]);
  const [classFilter, setClassFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [creating, setCreating] = useState<Date | null>(null);
  /* Activities are edited in their own form — they carry a fee, a stage and
     guardian invitations that the event form has no fields for. */
  const [activity, setActivity] = useState<ActivityRecord | null>(null);
  const calendarRequestId = useRef(0);
  const calendarRequestController = useRef<AbortController | null>(null);

  function openRow(row: EventRow) {
    if (row.kind !== "activity" || !row.activity) {
      setEditing(row);
      return;
    }
    // No second request: the calendar row already carries the record, in the
    // shape the editor reads.
    setActivity(row.activity);
  }

  const range = useMemo(() => rangeFor(view, anchor, timeZone), [view, anchor, timeZone]);

  const requestCalendar = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      fromDate: dateKeyInTimeZone(range.from, timeZone),
      toDate: dateKeyInTimeZone(range.to, timeZone),
    });
    if (classFilter) params.set("classId", classFilter);
    if (teacherFilter) params.set("teacherId", teacherFilter);
    if (typeFilter) params.set("type", typeFilter);

    const response = await axios.get<EventRow[]>(`/api/calendar?${params.toString()}`, {
      signal,
      headers: deviceHeaders(),
    });
    return response.data;
  }, [range.from, range.to, classFilter, teacherFilter, typeFilter, timeZone]);

  const beginCalendarRequest = useCallback(() => {
    calendarRequestController.current?.abort();
    const controller = new AbortController();
    const id = ++calendarRequestId.current;
    calendarRequestController.current = controller;
    return { id, controller, promise: requestCalendar(controller.signal) };
  }, [requestCalendar]);

  const isCurrentCalendarRequest = useCallback(
    (request: { id: number; controller: AbortController }) =>
      request.id === calendarRequestId.current &&
      request.controller === calendarRequestController.current &&
      !request.controller.signal.aborted,
    []
  );

  const cancelCurrentCalendarRequest = useCallback(() => {
    calendarRequestController.current?.abort();
    calendarRequestController.current = null;
    // Some transports resolve even after AbortSignal is raised. Invalidating
    // the sequence makes both their success and failure branches inert.
    calendarRequestId.current += 1;
  }, []);

  useEffect(() => {
    const pending = beginCalendarRequest();
    void pending.promise
      .then((rows) => {
        if (!isCurrentCalendarRequest(pending)) return;
        setEvents(rows);
        setError(null);
      })
      .catch((err) => {
        if (isCurrentCalendarRequest(pending)) {
          setError(describeApiError(err, t("calendar.loadFailed")));
        }
      })
      .finally(() => {
        if (isCurrentCalendarRequest(pending)) setLoading(false);
      });
    return cancelCurrentCalendarRequest;
  }, [beginCalendarRequest, cancelCurrentCalendarRequest, isCurrentCalendarRequest, t]);

  const retryCalendar = useCallback(async () => {
    setLoading(true);
    const pending = beginCalendarRequest();
    try {
      const rows = await pending.promise;
      if (!isCurrentCalendarRequest(pending)) return;
      setEvents(rows);
      setError(null);
    } catch (err) {
      if (isCurrentCalendarRequest(pending)) {
        setError(describeApiError(err, t("calendar.loadFailed")));
      }
    } finally {
      if (isCurrentCalendarRequest(pending)) setLoading(false);
    }
  }, [beginCalendarRequest, isCurrentCalendarRequest, t]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
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
      axios.get<Option[]>("/api/classes", { signal: controller.signal }),
      axios.get<Option[]>("/api/teachers", { signal: controller.signal }),
    ]).then(([classesRes, teachersRes]) => {
      if (cancelled) return;
      if (classesRes.status === "fulfilled") setClasses(classesRes.value.data);
      if (teachersRes.status === "fulfilled") setTeachers(teachersRes.value.data);
    });
    return () => {
      cancelled = true;
      controller.abort();
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
    const controller = new AbortController();
    const params = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      teacherId: teacherFilter,
    });
    axios
      .get<{ shifts: ShiftRow[] }>(`/api/shifts?${params.toString()}`, {
        signal: controller.signal,
        headers: deviceHeaders(),
      })
      .then((response) => {
        if (!cancelled) setShifts(response.data.shifts ?? []);
      })
      .catch(() => {
        // The rota is an overlay; the calendar is still readable without it.
        if (!cancelled) setShifts([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [teacherFilter, range.from, range.to]);

  const shiftOn = useCallback(
    (day: Date) => {
      // Gated on the filter, not on the array: whatever was fetched for the
      // previously selected teacher must not keep showing after she is
      // deselected, and this is true the render it happens rather than one
      // render later once a fetch has come back.
      if (!teacherFilter) return [];
      const key = dateKeyInTimeZone(day, timeZone);
      return shifts.filter((shift) => shift.date.slice(0, 10) === key);
    },
    [shifts, teacherFilter, timeZone]
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
   * Compared in the device calendar zone rather than by UTC day, so midnight
   * boundaries stay aligned with the dates the user selected.
   */
  function eventsOn(day: Date) {
    return events.filter((event) => calendarSpanOnDay(event, day, timeZone));
  }

  /** True on the days after the first — those render as a band, not at an hour. */

  const formatDate = (value: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
      timeZone,
      ...options,
    }).format(value);
  const periodLabel =
    view === "month"
      ? formatDate(anchor, { year: "numeric", month: "long" })
      : view === "day"
        ? formatDate(anchor, { weekday: "long", year: "numeric", month: "long", day: "numeric" })
        : `${formatDate(range.days[0], { month: "short", day: "numeric" })} — ${formatDate(
            range.days[6],
            { month: "short", day: "numeric" }
          )}`;

  return (
    <div className="min-h-screen bg-brand-bg">
      <Topbar title={t("calendar.title")} />

      <div className="space-y-4 p-3 sm:p-6">
        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            <span>{error}</span>
            <button type="button" onClick={() => void retryCalendar()} className="ms-3 underline">
              {t("common.retry")}
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 shadow-sm sm:p-4">
          <div className="inline-flex w-full rounded-xl bg-gray-100 p-1 sm:w-auto">
            {(["day", "week", "month"] as CalendarView[]).map((option) => (
              <button
                key={option}
                onClick={() => {
                  if (option === view) return;
                  setLoading(true);
                  setView(option);
                }}
                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-all sm:flex-none sm:px-4 ${
                  view === option ? "bg-white shadow text-[#111111]" : "text-gray-500"
                }`}
              >
                {t(CALENDAR_VIEW_LABEL_KEYS[option])}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setLoading(true);
                setAnchor((current) => shiftAnchor(view, current, -1, timeZone));
              }}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
            >
              {t("common.previous")}
            </button>
            <button
              onClick={() => {
                setLoading(true);
                setAnchor((current) => shiftAnchor(view, current, 1, timeZone));
              }}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
            >
              {t("common.next")}
            </button>
          </div>

          <span className="min-w-0 flex-1 text-sm font-medium text-[#111111]">{periodLabel}</span>

          <div className="grid w-full grid-cols-2 gap-2 sm:ms-auto sm:flex sm:w-auto sm:items-center">
            <select
              value={classFilter}
              onChange={(e) => {
                setLoading(true);
                setClassFilter(e.target.value);
              }}
              className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">{t("common.allClasses")}</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => {
                setLoading(true);
                setTypeFilter(e.target.value);
              }}
              className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm"
              aria-label={t("finance.type")}
            >
              <option value="">{t("calendar.allTypes")}</option>
              {(Object.keys(EVENT_TYPE_LABEL_KEYS) as CalendarEventType[]).map((type) => (
                <option key={type} value={type}>{t(EVENT_TYPE_LABEL_KEYS[type])}</option>
              ))}
            </select>
            <select
              value={teacherFilter}
              onChange={(e) => {
                setLoading(true);
                setTeacherFilter(e.target.value);
              }}
              className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">{t("common.allTeachers")}</option>
              {teachers.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <PermissionGate permission="schedule.manage">
              <button
                onClick={() => setCreating(anchor)}
                className="w-full rounded-xl bg-[#5B14D1] px-4 py-2 text-sm font-medium text-white hover:bg-[#490EA9] sm:w-auto"
              >
                {t("common.add")}
              </button>
            </PermissionGate>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4 overflow-x-auto">
          {loading && events.length === 0 ? (
            <div role="status" className="py-16 text-center text-sm text-gray-500">{t("common.loading")}</div>
          ) : !error && events.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500">{t("calendar.empty")}</div>
          ) : view === "month" ? (
            <MonthGrid days={range.days} anchor={anchor} eventsOn={eventsOn} onSelect={openRow} timeZone={timeZone} />
          ) : (
            <HourGrid
              days={range.days}
              hours={hours}
              eventsOn={eventsOn}
              shiftOn={shiftOn}
              locale={locale}
              timeZone={timeZone}
              onSelect={openRow}
              onCreate={can("schedule.manage") ? setCreating : undefined}
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
            void retryCalendar();
          }}
        />
      )}

    </div>
  );
}

