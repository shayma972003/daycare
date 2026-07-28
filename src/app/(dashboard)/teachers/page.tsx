"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { AvatarPlaceholder } from "@/components/ui/IconPlaceholder";
import { PeriodBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { t, formatTime } from "@/lib/utils";

interface TodayAttendance {
  id: string;
  teacherId: string;
  checkinAt: string | null;
  checkoutAt: string | null;
  lateMinutes: number;
}

interface Teacher {
  id: string;
  name: string;
  period?: "MORNING" | "EVENING" | null;
  classes?: { id: string; name: string }[];
}

function LiveTimer({ from }: { from: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(from).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [from]);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const fmt = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="font-mono text-sm font-semibold text-success-text tabular-nums">
      {fmt(h)}:{fmt(m)}:{fmt(s)}
    </span>
  );
}

export default function TeachersPage() {
  const router = useRouter();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [xlsxUploading, setXlsxUploading] = useState(false);
  const [xlsxResult, setXlsxResult] = useState<{ added: number; failed: number; errors: string[] } | null>(null);
  const xlsxInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Today's attendance map: teacherId → attendance record
  const [todayAtt, setTodayAtt] = useState<Record<string, TodayAttendance>>({});

  const fetchTodayAttendance = useCallback(async () => {
    try {
      const res = await axios.get<TodayAttendance[]>("/api/attendance/teachers/today");
      const map: Record<string, TodayAttendance> = {};
      res.data.forEach((a) => { map[a.teacherId] = a; });
      setTodayAtt(map);
    } catch { /* silent */ }
  }, []);

  const fetchTeachers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      const res = await axios.get<Teacher[]>("/api/teachers", { params });
      setTeachers(res.data);
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchTeachers();
    fetchTodayAttendance();
  }, [fetchTeachers, fetchTodayAttendance]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === teachers.length) setSelected(new Set());
    else setSelected(new Set(teachers.map((tc) => tc.id)));
  }

  async function handleCheckin(id: string) {
    setActionLoading(id + ":checkin");
    try {
      await axios.post(`/api/teachers/${id}/checkin`);
      await fetchTodayAttendance();
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCheckout(id: string) {
    setActionLoading(id + ":checkout");
    try {
      await axios.post(`/api/teachers/${id}/checkout`);
      await fetchTodayAttendance();
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  }

  async function applyBulk() {
    const ids = Array.from(selected);
    if (!bulkAction || ids.length === 0) return;
    setBulkLoading(true);
    try {
      await axios.post("/api/attendance/teachers/bulk-action", { teacherIds: ids, action: bulkAction });
      await fetchTodayAttendance();
    } catch {
      // silent
    } finally {
      setBulkLoading(false);
      setSelected(new Set());
      setBulkAction("");
    }
  }

  async function handleXlsxUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setXlsxUploading(true);
    setXlsxResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post<{ added: number; failed: number; errors: string[] }>("/api/teachers/bulk", fd);
      setXlsxResult(res.data);
      fetchTeachers();
    } catch (err) {
      setXlsxResult({ added: 0, failed: 1, errors: [axios.isAxiosError(err) ? err.response?.data?.error ?? "خطأ" : "خطأ"] });
    } finally {
      setXlsxUploading(false);
      if (xlsxInputRef.current) xlsxInputRef.current.value = "";
    }
  }

  return (
    <div dir="rtl" className="flex flex-col min-h-screen">
      <Topbar title={t("teachers.title")} />

      <div className="flex-1 p-6 space-y-5">
        {/* Top bar */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("students.searchPlaceholder")}
              className="w-64 px-4 py-2 pr-9 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#F64651] text-sm bg-white shadow-sm"
            />
            <span className="absolute left-auto right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          </div>

          <div className="flex gap-2 items-center">
            {/* Bulk action */}
            <div className="flex items-center gap-2">
              <select
                value={bulkAction}
                onChange={(e) => setBulkAction(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
              >
                <option value="">{t("students.bulkAction")}</option>
                <option value="checkin">تسجيل الدخول</option>
                <option value="checkout">تسجيل الخروج</option>
              </select>
              <button
                onClick={applyBulk}
                disabled={!bulkAction || selected.size === 0 || bulkLoading}
                className="px-3 py-2 bg-[#1a2340] text-white rounded-lg text-sm disabled:opacity-40"
              >
                تنفيذ
              </button>
            </div>

            {/* Add teacher dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-1 px-4 py-2 bg-[#F64651] text-white rounded-xl text-sm font-bold hover:bg-[#D93A44] transition-all shadow-md"
              >
                + {t("teachers.addTeacher")}
                <span className="text-xs mr-1">▼</span>
              </button>
              {dropdownOpen && (
                <div className="absolute left-0 top-full mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-100 z-30 overflow-hidden">
                  <button
                    onClick={() => { setDropdownOpen(false); router.push("/teachers/new"); }}
                    className="w-full text-right px-4 py-3 text-sm text-[#1a2340] hover:bg-gray-50 transition-colors border-b border-gray-50"
                  >
                    أضف معلم جديد
                  </button>
                  <button
                    onClick={() => { setDropdownOpen(false); router.push("/teachers/import"); }}
                    className="w-full text-right px-4 py-3 text-sm text-[#1a2340] hover:bg-gray-50 transition-colors"
                  >
                    ارفع ملف المعلمين
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <input ref={xlsxInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleXlsxUpload} />

        {xlsxUploading && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">جاري معالجة الملف...</div>
        )}
        {xlsxResult && (
          <div className={`p-4 rounded-lg text-sm border ${xlsxResult.failed > 0 ? "bg-orange-50 border-orange-200" : "bg-success-bg border-success-text/20"}`}>
            <p className="font-medium mb-1">
              تمت الإضافة: <span className="text-success-text">{xlsxResult.added} معلم</span>
              {xlsxResult.failed > 0 && <> · فشل: <span className="text-red-600">{xlsxResult.failed} صف</span></>}
            </p>
            {xlsxResult.errors.length > 0 && (
              <ul className="text-xs text-red-600 mt-1 space-y-0.5">
                {xlsxResult.errors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-400 text-sm">{t("common.loading")}</div>
          ) : teachers.length === 0 ? (
            <EmptyState title="لا يوجد معلمون بعد" description="ابدأ بإضافة أول معلم لعرضه هنا" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-right">
                      <input type="checkbox" checked={selected.size === teachers.length && teachers.length > 0} onChange={toggleAll} className="rounded" />
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">{t("teachers.columns.name")}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">{t("teachers.columns.period")}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">{t("teachers.columns.class")}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">{t("common.viewMore")}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">{t("teachers.columns.checkinTime")}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {teachers.map((teacher) => {
                    const att = todayAtt[teacher.id];
                    const checkedIn = !!att?.checkinAt;
                    const checkedOut = !!att?.checkoutAt;
                    const primaryClass = teacher.classes?.[0];

                    return (
                      <tr key={teacher.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={selected.has(teacher.id)} onChange={() => toggleSelect(teacher.id)} className="rounded" />
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <AvatarPlaceholder name={teacher.name} />
                            <span className="font-medium text-[#1a2340] text-sm">{teacher.name}</span>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          {teacher.period ? <PeriodBadge period={teacher.period} /> : <span className="text-gray-400">—</span>}
                        </td>

                        <td className="px-4 py-3 text-gray-600">
                          {primaryClass?.name ?? <span className="text-gray-400">—</span>}
                        </td>

                        <td className="px-4 py-3">
                          <button
                            onClick={() => router.push(`/teachers/${teacher.id}`)}
                            className="px-3 py-1.5 border border-[#1a2340] text-[#1a2340] rounded-lg text-xs font-medium hover:bg-[#1a2340] hover:text-white transition-all"
                          >
                            {t("teachers.actions.viewMore")}
                          </button>
                        </td>

                        {/* Check-in time + live timer */}
                        <td className="px-4 py-3 text-xs">
                          {checkedIn && !checkedOut && att?.checkinAt ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-gray-500">{formatTime(att.checkinAt)}</span>
                              <LiveTimer from={att.checkinAt} />
                            </div>
                          ) : checkedIn && checkedOut && att?.checkoutAt ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-gray-500">{formatTime(att.checkinAt!)}</span>
                              <span className="text-gray-400">خرج {formatTime(att.checkoutAt)}</span>
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            {!checkedIn ? (
                              <button
                                onClick={() => handleCheckin(teacher.id)}
                                disabled={actionLoading === teacher.id + ":checkin"}
                                className="px-3 py-1.5 bg-[#F64651] text-white rounded-lg text-xs font-medium hover:bg-[#D93A44] transition-all disabled:opacity-60"
                              >
                                {actionLoading === teacher.id + ":checkin" ? "..." : t("teachers.actions.checkin")}
                              </button>
                            ) : !checkedOut ? (
                              <button
                                onClick={() => handleCheckout(teacher.id)}
                                disabled={actionLoading === teacher.id + ":checkout"}
                                className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition-all disabled:opacity-60"
                              >
                                {actionLoading === teacher.id + ":checkout" ? "..." : t("teachers.actions.checkout")}
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400 px-3 py-1.5">✓ خرج</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
