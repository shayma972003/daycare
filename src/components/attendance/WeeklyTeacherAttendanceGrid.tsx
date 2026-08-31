"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { deviceHeaders, formatDeviceTime } from "@/lib/device-date";
import { useLocale, useT } from "@/lib/i18n-provider";

type Cell = { date: string; status: "PRESENT" | "CHECKED_OUT" | "NO_RECORD"; checkinAt: string | null; checkoutAt: string | null };
type ResponseData = { weekStart: string; days: { date: string; weekday: number }[]; rows: { teacherId: string; name: string; cells: Cell[] }[] };

export function WeeklyTeacherAttendanceGrid({ classId, search = "" }: { classId?: string; search?: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [data, setData] = useState<ResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  function shiftWeek(days: number) {
    if (!data) return;
    const start = new Date(`${data.weekStart}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() + days);
    setWeekStart(start.toISOString().slice(0, 10));
  }
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (classId) params.set("classId", classId);
    if (search.trim()) params.set("search", search.trim());
    if (weekStart) params.set("start", weekStart);
    axios.get<ResponseData>(`/api/attendance/teachers/week?${params}`, { signal: controller.signal, headers: deviceHeaders() })
      .then((response) => { setData(response.data); setError(null); })
      .catch((err) => { if (!axios.isCancel(err)) setError(t("attendance.loadFailed")); });
    return () => controller.abort();
  }, [classId, retry, search, t, weekStart]);
  if (error && !data) return <div role="alert" className="space-y-2 py-4 text-sm text-red-600"><p>{error}</p><button onClick={() => setRetry((value) => value + 1)} className="underline">{t("common.retry")}</button></div>;
  if (!data) return <p className="py-4 text-sm text-gray-400">{t("common.loading")}</p>;
  return <div className="space-y-3">
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" aria-label={t("attendance.previousWeek")} onClick={() => shiftWeek(-7)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm">{t("attendance.previousWeek")}</button>
      <button type="button" onClick={() => setWeekStart(null)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm">{t("attendance.thisWeek")}</button>
      <button type="button" aria-label={t("attendance.nextWeek")} onClick={() => shiftWeek(7)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm">{t("attendance.nextWeek")}</button>
    </div>
    {data.rows.length === 0 ? <p className="py-6 text-center text-sm text-gray-400">{t("attendance.noTeachers")}</p> : <div className="overflow-x-auto"><table className="min-w-[760px] w-full text-sm"><thead><tr><th className="px-3 py-2 text-start">{t("fields.teacher")}</th>{data.days.map((day) => <th key={day.date} className="px-2 py-2 text-center">{day.date.slice(5)}</th>)}</tr></thead><tbody>{data.rows.map((row) => <tr key={row.teacherId}><td className="px-3 py-2 font-medium">{row.name}</td>{row.cells.map((cell) => <td key={cell.date} className="px-2 py-2 text-center">{cell.status === "NO_RECORD" ? <span className="text-gray-400">{t("attendance.noRecord")}</span> : <div className="space-y-0.5"><div>{t(`attendanceStatus.${cell.status}`)}</div><div className="text-xs text-gray-500">{cell.checkinAt ? formatDeviceTime(new Date(cell.checkinAt), { hour: "2-digit", minute: "2-digit" }, locale) : "—"}{cell.checkoutAt ? ` – ${formatDeviceTime(new Date(cell.checkoutAt), { hour: "2-digit", minute: "2-digit" }, locale)}` : ` · ${t("attendance.notCheckedOut")}`}</div></div>}</td>)}</tr>)}</tbody></table></div>}
  </div>;
}
