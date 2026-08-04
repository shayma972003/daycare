"use client";

/**
 * The week at a glance (tasks 2.14 and 2.16).
 *
 * A grid rather than a day-at-a-time list because the questions a nursery asks
 * are weekly ones — who keeps missing Sundays, is this child actually coming
 * three days as agreed — and those are invisible one day at a time.
 *
 * Every cell is a `<select>`. It is not the prettiest control and it is the
 * right one here: a teacher correcting Tuesday's register needs the current
 * value and the alternatives without a modal between her and the change.
 */

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import {
  ATTENDANCE_STATUS_COLORS,
  WEEKDAY_LABELS,
} from "@/lib/attendance-schedule";
import type { AttendanceStatus } from "@/generated/prisma/enums";
import { useT } from "@/lib/i18n-provider";

interface Cell {
  date: string;
  weekday: number;
  expected: boolean;
  status: AttendanceStatus;
  statusNote: string | null;
}

interface Row {
  studentId: string;
  name: string;
  expectedDays: number[];
  cells: Cell[];
  ratio: { attended: number; expected: number };
}

interface WeekResponse {
  weekStart: string;
  days: { date: string; weekday: number }[];
  rows: Row[];
  dayTotals: { date: string; weekday: number; present: number; expected: number }[];
  class: {
    id: string;
    name: string;
    capacityState: { count: number; capacity: number | null; over: boolean };
  } | null;
}

/** Only the states a teacher sets by hand — checkout has its own action. */
const SETTABLE: AttendanceStatus[] = ["PRESENT", "ABSENT", "LEAVE", "NO_RECORD"];

export function WeeklyAttendanceGrid({ classId }: { classId?: string }) {
  const t = useT();
  const [data, setData] = useState<WeekResponse | null>(null);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const load = useCallback(
    async (start?: string | null) => {
      const params = new URLSearchParams();
      if (classId) params.set("classId", classId);
      if (start) params.set("start", start);
      try {
        const response = await axios.get<WeekResponse>(
          `/api/attendance/week?${params.toString()}`
        );
        setData(response.data);
        setError(null);
      } catch (err) {
        setError(describeApiError(err, "تعذر تحميل الحضور"));
      }
    },
    [classId]
  );

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (classId) params.set("classId", classId);
    if (weekStart) params.set("start", weekStart);
    axios
      .get<WeekResponse>(`/api/attendance/week?${params.toString()}`)
      .then((response) => {
        if (!cancelled) setData(response.data);
      })
      .catch((err) => {
        if (!cancelled) setError(describeApiError(err, "تعذر تحميل الحضور"));
      });
    return () => {
      cancelled = true;
    };
  }, [classId, weekStart]);

  async function setStatus(row: Row, cell: Cell, status: AttendanceStatus) {
    const cellKey = `${row.studentId}|${cell.date}`;
    setSavingCell(cellKey);
    setError(null);
    try {
      await axios.post("/api/attendance/students/status", {
        studentIds: [row.studentId],
        status,
        date: cell.date,
      });
      await load(data?.weekStart);
    } catch (err) {
      setError(describeApiError(err, "تعذر تحديث الحضور"));
    } finally {
      setSavingCell(null);
    }
  }

  function shiftWeek(days: number) {
    if (!data) return;
    const start = new Date(`${data.weekStart}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() + days);
    setWeekStart(start.toISOString().slice(0, 10));
  }

  if (error && !data) {
    return (
      <p role="alert" className="text-sm text-red-600 py-4">
        {error}
      </p>
    );
  }

  if (!data) return <p className="text-sm text-gray-400 py-4">جارٍ التحميل…</p>;

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftWeek(-7)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
          >
            الأسبوع السابق
          </button>
          <button
            onClick={() => setWeekStart(null)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
          >
            هذا الأسبوع
          </button>
          <button
            onClick={() => shiftWeek(7)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
          >
            التالي
          </button>
        </div>

        {data.class?.capacityState.capacity !== null && data.class && (
          <span
            className={`text-sm ${
              data.class.capacityState.over ? "text-red-500 font-medium" : "text-gray-500"
            }`}
          >
            السعة: {data.class.capacityState.count}/{data.class.capacityState.capacity}
            {data.class.capacityState.over && " — تجاوز السعة"}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky right-0 bg-white px-3 py-2 text-right text-gray-500 font-medium border-b border-gray-100">
                الطفل
              </th>
              {data.days.map((day, index) => (
                <th key={day.date} className="px-2 py-2 text-center border-b border-gray-100">
                  <div className="text-gray-600 font-medium">{WEEKDAY_LABELS[day.weekday]}</div>
                  <div className="text-[11px] text-gray-400">{day.date.slice(5)}</div>
                  {/* "2/3 حاضر" per column — task 2.13. */}
                  <div className="text-[11px] text-[#2F96A6] mt-0.5">
                    {data.dayTotals[index].present}/{data.dayTotals[index].expected} حاضر
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-center text-gray-500 font-medium border-b border-gray-100">
                الحضور
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.studentId}>
                <td className="sticky right-0 bg-white px-3 py-2 border-b border-gray-50 text-[#111111] whitespace-nowrap">
                  {row.name}
                </td>
                {row.cells.map((cell) => {
                  const cellKey = `${row.studentId}|${cell.date}`;
                  if (!cell.expected) {
                    // Not enrolled on this weekday. Rendered as nothing at all
                    // rather than as "absent" — the child has missed nothing.
                    return (
                      <td
                        key={cell.date}
                        className="px-2 py-2 border-b border-gray-50 text-center bg-gray-50/50"
                      >
                        <span className="text-gray-300 text-xs">—</span>
                      </td>
                    );
                  }
                  return (
                    <td key={cell.date} className="px-2 py-2 border-b border-gray-50 text-center">
                      <select
                        value={cell.status}
                        disabled={savingCell === cellKey}
                        onChange={(e) =>
                          setStatus(row, cell, e.target.value as AttendanceStatus)
                        }
                        className={`text-xs bg-transparent border border-gray-200 rounded-lg px-1.5 py-1 ${
                          ATTENDANCE_STATUS_COLORS[cell.status]
                        } disabled:opacity-50`}
                      >
                        {/* CHECKED_OUT appears only when it is already the value:
                            it is produced by the checkout action, not chosen. */}
                        {cell.status === "CHECKED_OUT" && (
                          <option value="CHECKED_OUT">
                            {t("attendanceStatus.CHECKED_OUT")}
                          </option>
                        )}
                        {SETTABLE.map((status) => (
                          <option key={status} value={status}>
                            {t(`attendanceStatus.${status}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
                <td className="px-3 py-2 border-b border-gray-50 text-center text-gray-600 whitespace-nowrap">
                  {row.ratio.attended}/{row.ratio.expected} أيام
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.rows.length === 0 && (
        <p className="text-sm text-gray-400 py-6 text-center">لا يوجد أطفال</p>
      )}
    </div>
  );
}
