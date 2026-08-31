"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { WEEKDAY_LABEL_KEYS } from "@/lib/attendance-schedule";
import { deviceHeaders } from "@/lib/device-date";
import { useT } from "@/lib/i18n-provider";
import { usePermissions } from "@/lib/use-permissions";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, closeDialogOnOpenChange } from "@/components/ui/Dialog";

interface Teacher { id: string; name: string }
interface Classroom { id: string; name: string }
interface Shift { id: string; teacherId: string; teacherName: string; classId: string | null; className: string | null; date: string; startTime: string; endTime: string; notes: string | null }
interface ShiftsResponse { weekStart: string; days: string[]; teachers: Teacher[]; classes: Classroom[]; shifts: Shift[] }
interface Editor { shiftId?: string; date: string; teacherId: string; classId: string; startTime: string; endTime: string; notes: string }

const blankEditor = (date: string, teacherId = ""): Editor => ({ date, teacherId, classId: "", startTime: "07:00", endTime: "15:00", notes: "" });

function requestShifts(start: string | null | undefined, teacherId: string | undefined, signal?: AbortSignal) {
  return axios.get<ShiftsResponse>("/api/shifts", {
    params: { ...(start ? { start } : {}), ...(teacherId ? { teacherId } : {}) },
    headers: deviceHeaders(), signal,
  });
}

export function ShiftsPanel({ teacherId }: { teacherId?: string }) {
  const t = useT();
  const { can } = usePermissions();
  const canManage = can("schedule.manage");
  const [data, setData] = useState<ShiftsResponse | null>(null);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (start?: string | null, signal?: AbortSignal) => {
    try {
      const response = await requestShifts(start, teacherId, signal);
      setData(response.data); setError(null);
    } catch (cause) {
      if (!axios.isCancel(cause)) setError(describeApiError(cause, t("shifts.loadFailed")));
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [t, teacherId]);

  useEffect(() => {
    const controller = new AbortController();
    requestShifts(weekStart, teacherId, controller.signal)
      .then((response) => { setData(response.data); setError(null); })
      .catch((cause) => { if (!axios.isCancel(cause)) setError(describeApiError(cause, t("shifts.loadFailed"))); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [teacherId, t, weekStart]);

  function shiftWeek(offset: number) {
    if (!data) return;
    const date = new Date(`${data.weekStart}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + offset);
    setLoading(true);
    setWeekStart(date.toISOString().slice(0, 10));
  }
  function openCreate(date: string) { setEditor(blankEditor(date, teacherId ?? "")); }
  function openEdit(shift: Shift) {
    setEditor({ shiftId: shift.id, date: shift.date, teacherId: shift.teacherId, classId: shift.classId ?? "", startTime: shift.startTime, endTime: shift.endTime, notes: shift.notes ?? "" });
  }
  async function save() {
    if (!editor || !editor.teacherId || saving) return;
    setSaving(true); setError(null);
    try {
      const payload = { ...editor, classId: editor.classId || null, notes: editor.notes.trim() || null };
      if (editor.shiftId) await axios.patch("/api/shifts", payload, { headers: deviceHeaders() });
      else await axios.post("/api/shifts", payload, { headers: deviceHeaders() });
      setEditor(null); await load(data?.weekStart);
    } catch (cause) { setError(describeApiError(cause, t("shifts.saveFailed"))); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!editor?.shiftId || saving) return;
    setSaving(true); setError(null);
    try {
      await axios.delete("/api/shifts", { data: { shiftId: editor.shiftId } });
      setEditor(null); await load(data?.weekStart);
    } catch (cause) { setError(describeApiError(cause, t("shifts.deleteFailed"))); }
    finally { setSaving(false); }
  }

  return <>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-white p-3">
        <button type="button" onClick={() => shiftWeek(-7)} className="rounded-lg border px-3 py-2 text-sm">{t("attendance.previousWeek")}</button>
        <button type="button" onClick={() => { setLoading(true); if (weekStart === null) void load(null); else setWeekStart(null); }} className="rounded-lg border px-3 py-2 text-sm">{t("attendance.thisWeek")}</button>
        <button type="button" onClick={() => shiftWeek(7)} className="rounded-lg border px-3 py-2 text-sm">{t("common.next")}</button>
        {data && <span className="text-sm text-gray-500">{t("attendance.weekFrom", { date: data.weekStart })}</span>}
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error} <button type="button" onClick={() => { setLoading(true); void load(data?.weekStart); }} className="underline">{t("common.retry")}</button></div>}
      {loading && !data ? <p className="py-8 text-center text-sm text-gray-400">{t("common.loading")}</p> :
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {data?.days.map((date) => {
            const shifts = data.shifts.filter((shift) => shift.date === date);
            const eligibleTeacherIds = new Set(data.teachers.map((teacher) => teacher.id));
            return <section key={date} className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
              <header className="mb-3 flex items-center justify-between gap-3">
                <div><h3 className="font-semibold text-gray-900">{t(WEEKDAY_LABEL_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()])}</h3><p className="text-xs text-gray-500" dir="ltr">{date}</p></div>
                {canManage && data.teachers.length > 0 && <button type="button" onClick={() => openCreate(date)} className="rounded-lg bg-[#4f00c1] px-3 py-2 text-xs font-semibold text-white">{t("shifts.add")}</button>}
              </header>
              <div className="space-y-2">
                {shifts.length === 0 ? <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">{t("shifts.noShifts")}</p> : shifts.map((shift) =>
                  <button key={shift.id} type="button" disabled={!canManage || !eligibleTeacherIds.has(shift.teacherId)} onClick={() => openEdit(shift)} className="w-full rounded-lg border border-gray-100 p-3 text-start hover:border-[#4f00c1] disabled:cursor-default disabled:hover:border-gray-100">
                    <span className="block font-medium text-gray-900">{shift.teacherName}</span>
                    <span className="block text-sm text-gray-600" dir="ltr">{shift.startTime}–{shift.endTime}</span>
                    {shift.className && <span className="block text-xs text-gray-500">{shift.className}</span>}
                  </button>)}
              </div>
            </section>;
          })}
        </div>}
    </div>
    {editor && <Dialog open onOpenChange={(open) => closeDialogOnOpenChange(open, saving, () => setEditor(null))}>
      <DialogContent dismissBlocked={saving} className="max-w-md space-y-4 p-5">
        <DialogHeader><div><DialogTitle>{editor.shiftId ? t("shifts.edit") : t("shifts.add")}</DialogTitle><DialogDescription>{t("shifts.editDescription")}</DialogDescription></div></DialogHeader>
        <label className="block text-sm">{t("shifts.day")}<input readOnly value={editor.date} dir="ltr" className="mt-1 w-full rounded-lg border bg-gray-50 px-3 py-2" /></label>
        <label className="block text-sm">{t("fields.employee")}<select disabled={!!teacherId} value={editor.teacherId} onChange={(e) => setEditor({ ...editor, teacherId: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">{t("common.select")}</option>{data?.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>
        <label className="block text-sm">{t("fields.classroom")}<select value={editor.classId} onChange={(e) => setEditor({ ...editor, classId: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">{t("shifts.noClass")}</option>{data?.classes.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">{t("common.from")}<input type="time" value={editor.startTime} onChange={(e) => setEditor({ ...editor, startTime: e.target.value })} dir="ltr" className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="text-sm">{t("common.to")}<input type="time" value={editor.endTime} onChange={(e) => setEditor({ ...editor, endTime: e.target.value })} dir="ltr" className="mt-1 w-full rounded-lg border px-3 py-2" /></label></div>
        <label className="block text-sm">{t("shifts.notes")}<textarea value={editor.notes} onChange={(e) => setEditor({ ...editor, notes: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
        <DialogFooter className="pt-4"><button type="button" onClick={() => void save()} disabled={saving || !editor.teacherId} className="rounded-lg bg-[#4f00c1] px-4 py-2 text-white disabled:opacity-50">{saving ? t("common.loading") : t("common.save")}</button>{editor.shiftId && <button type="button" onClick={() => void remove()} disabled={saving} className="rounded-lg border border-red-200 px-4 py-2 text-red-700">{t("common.delete")}</button>}<DialogClose asChild><button type="button" disabled={saving} className="rounded-lg border px-4 py-2">{t("common.cancel")}</button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>}
  </>;
}
