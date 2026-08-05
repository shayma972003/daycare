"use client";

/**
 * Staff rota (task 2.28).
 *
 * A week grid of staff × days. Clicking a cell edits it in place — a rota is
 * filled in by sweeping across a row, and a modal per cell would make that
 * fifteen dialogs.
 */

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { describeApiError } from "@/lib/api-error";
import { WEEKDAY_LABEL_KEYS } from "@/lib/attendance-schedule";
import { useT } from "@/lib/i18n-provider";

interface Teacher {
  id: string;
  name: string;
}

interface Shift {
  id: string;
  teacherId: string;
  date: string;
  startTime: string;
  endTime: string;
  role: string | null;
  notes: string | null;
}

interface ShiftsResponse {
  weekStart: string;
  days: string[];
  teachers: Teacher[];
  shifts: Shift[];
}

/** Prefilled when a blank cell is opened — the shift most rooms actually run. */
const DEFAULT_START = "07:00";
const DEFAULT_END = "15:00";

export default function ShiftsPage() {
  // Locale-aware translation — see src/lib/i18n.ts.
  const t = useT();
  const [data, setData] = useState<ShiftsResponse | null>(null);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ teacherId: string; date: string } | null>(null);
  const [startTime, setStartTime] = useState(DEFAULT_START);
  const [endTime, setEndTime] = useState(DEFAULT_END);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (start?: string | null) => {
    try {
      const response = await axios.get<ShiftsResponse>(
        `/api/shifts${start ? `?start=${start}` : ""}`
      );
      setData(response.data);
      setError(null);
    } catch (err) {
      setError(describeApiError(err, t("shifts.loadFailed")));
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<ShiftsResponse>(`/api/shifts${weekStart ? `?start=${weekStart}` : ""}`)
      .then((response) => {
        if (!cancelled) setData(response.data);
      })
      .catch((err) => {
        if (!cancelled) setError(describeApiError(err, t("shifts.loadFailed")));
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, t]);

  function shiftFor(teacherId: string, date: string): Shift | undefined {
    return data?.shifts.find(
      (shift) => shift.teacherId === teacherId && shift.date === date
    );
  }

  function openCell(teacherId: string, date: string) {
    const existing = shiftFor(teacherId, date);
    setStartTime(existing?.startTime ?? DEFAULT_START);
    setEndTime(existing?.endTime ?? DEFAULT_END);
    setEditing({ teacherId, date });
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await axios.post("/api/shifts", { ...editing, startTime, endTime });
      setEditing(null);
      await load(data?.weekStart);
    } catch (err) {
      setError(describeApiError(err, t("shifts.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setSaving(true);
    try {
      await axios.delete("/api/shifts", { data: editing });
      setEditing(null);
      await load(data?.weekStart);
    } catch (err) {
      setError(describeApiError(err, t("shifts.deleteFailed")));
    } finally {
      setSaving(false);
    }
  }

  function shiftWeek(days: number) {
    if (!data) return;
    const start = new Date(`${data.weekStart}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() + days);
    setWeekStart(start.toISOString().slice(0, 10));
  }

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title={t("shifts.title")} />

      <div className="p-6 space-y-4">
        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-2 flex-wrap">
          <button onClick={() => shiftWeek(-7)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
            {t("attendance.previousWeek")}
          </button>
          <button onClick={() => setWeekStart(null)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
            {t("attendance.thisWeek")}
          </button>
          <button onClick={() => shiftWeek(7)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
            {t("common.next")}
          </button>
          {data && <span className="text-sm text-gray-500">{t("attendance.weekFrom", { date: data.weekStart })}</span>}
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4 overflow-x-auto">
          {!data ? (
            <p className="text-sm text-gray-400 py-8 text-center">{t("common.loadingDots")}</p>
          ) : data.teachers.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">{t("shifts.noActiveStaff")}</p>
          ) : (
            <table className="w-full text-sm min-w-[760px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky right-0 bg-white px-3 py-2 text-right text-gray-500 font-medium border-b border-gray-100">
                    {t("fields.employee")}
                  </th>
                  {data.days.map((date) => (
                    <th key={date} className="px-2 py-2 text-center border-b border-gray-100">
                      <div className="text-gray-600 font-medium">
                        {t(WEEKDAY_LABEL_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()])}
                      </div>
                      <div className="text-[11px] text-gray-400">{date.slice(5)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.teachers.map((teacher) => (
                  <tr key={teacher.id}>
                    <td className="sticky right-0 bg-white px-3 py-2 border-b border-gray-50 text-[#111111] whitespace-nowrap">
                      {teacher.name}
                    </td>
                    {data.days.map((date) => {
                      const shift = shiftFor(teacher.id, date);
                      return (
                        <td key={date} className="px-1 py-1 border-b border-gray-50 text-center">
                          <button
                            onClick={() => openCell(teacher.id, date)}
                            className={`w-full rounded-lg px-2 py-2 text-xs transition-colors ${
                              shift
                                ? "bg-[#E0F7FA] text-[#12626f] hover:bg-[#c9eff5]"
                                : "text-gray-300 hover:bg-gray-50"
                            }`}
                            dir="ltr"
                          >
                            {shift ? `${shift.startTime}–${shift.endTime}` : "+"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-xs space-y-4" dir="rtl">
            <h3 className="font-bold text-[#111111]">
              {data?.teachers.find((t) => t.id === editing.teacherId)?.name} — {editing.date}
            </h3>

            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("common.from")}</label>
              {/* `type="time"` gives the platform's own picker on a phone, which
                  is better than anything hand-built — see the note on task 2.15. */}
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("common.to")}</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                dir="ltr"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e] disabled:opacity-60"
              >
                {saving ? "..." : t("common.save")}
              </button>
              {shiftFor(editing.teacherId, editing.date) && (
                <button
                  onClick={remove}
                  disabled={saving}
                  className="px-4 py-2.5 border border-red-200 text-red-600 rounded-xl text-sm hover:bg-red-50"
                >
                  {t("common.delete")}
                </button>
              )}
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
