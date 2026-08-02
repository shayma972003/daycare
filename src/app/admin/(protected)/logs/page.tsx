"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { formatAst } from "@/lib/datetime";

interface LogEntry {
  id: string;
  action: string;
  schoolName: string | null;
  school_id: string | null;
  metadata: unknown;
  performed_by: string;
  performed_at: string;
}

interface School { id: string; name: string }

const ACTION_LABELS: Record<string, string> = {
  school_registered: "تسجيل مدرسة",
  school_suspended: "إيقاف مدرسة",
  school_reactivated: "تفعيل مدرسة",
  school_deleted: "حذف مدرسة",
  plan_changed: "تغيير خطة",
  renewal_extended: "تجديد اشتراك",
  message_sent: "إرسال رسالة",
  alert_triggered: "تنبيه تلقائي",
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [filterSchool, setFilterSchool] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (filterSchool) params.set("school_id", filterSchool);
    if (filterAction) params.set("action", filterAction);
    if (filterFrom) params.set("from", filterFrom);
    if (filterTo) params.set("to", filterTo);

    const res = await axios.get<{ logs: LogEntry[]; total: number; totalPages: number }>(`/api/admin/logs?${params}`);
    setLogs(res.data.logs);
    setTotal(res.data.total);
    setTotalPages(res.data.totalPages);
  }, [page, filterSchool, filterAction, filterFrom, filterTo]);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get<{ id: string; name: string }[]>("/api/admin/schools")
      .then((r) => setSchools(r.data.map((s) => ({ id: s.id, name: s.name }))))
      // Was an unhandled promise: a failure left the school filter silently empty.
      .catch(() => setSchools([]));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
      .then(() => setError(null))
      .catch((err) => setError(describeApiError(err, "فشل تحميل السجلات")))
      .finally(() => setLoading(false));
  }, [load]);

  /**
   * Wraps every field in quotes and doubles any quote inside it.
   *
   * Fields were joined with a bare comma, so a school name or a metadata blob
   * containing a comma — which the JSON always does — shifted every following
   * column. The file looked fine and was quietly wrong.
   */
  function csvField(value: unknown): string {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const header = ["الإجراء", "المدرسة", "المنفذ", "التاريخ", "التفاصيل"].map(csvField).join(",");
    const rows = logs.map((l) =>
      [
        l.action,
        l.schoolName ?? "",
        l.performed_by,
        formatAst(new Date(l.performed_at), {
          dateStyle: "short",
          timeStyle: "short",
        }),
        JSON.stringify(l.metadata ?? {}),
      ]
        .map(csvField)
        .join(",")
    );

    // The button says "export"; it only ever exported the page on screen.
    const note = totalPages > 1 ? ` (صفحة ${page + 1} من ${totalPages})` : "";
    const csv = [header, ...rows].join("\r\n");

    // BOM so Excel opens the Arabic text in UTF-8 rather than the ANSI codepage.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs${note ? `-page-${page + 1}` : ""}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8 space-y-6">
      {error && (
        <div
          role="alert"
          className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300"
        >
          {error}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">السجل</h1>
          <p className="text-gray-400 text-sm mt-1">{total} سجل</p>
        </div>
        <button onClick={exportCsv} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-xl">
          تصدير CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={filterSchool} onChange={(e) => { setFilterSchool(e.target.value); setPage(1); }} className="input-admin">
          <option value="">كل المدارس</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(1); }} className="input-admin">
          <option value="">كل الإجراءات</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }} className="input-admin" placeholder="من" />
        <input type="date" value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(1); }} className="input-admin" placeholder="إلى" />
      </div>

      {/* Table */}
      <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400 text-sm text-center">جاري التحميل...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {["الإجراء", "المدرسة", "التفاصيل", "المنفذ", "التاريخ والوقت"].map((h) => (
                  <th key={h} className="px-5 py-3 text-right text-gray-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-white/2 transition-colors">
                  <td className="px-5 py-3 text-white">{ACTION_LABELS[l.action] ?? l.action}</td>
                  <td className="px-5 py-3 text-gray-300">{l.schoolName ?? "—"}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs font-mono">
                    {l.metadata ? JSON.stringify(l.metadata).substring(0, 60) : "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-400">{l.performed_by}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs">{new Date(l.performed_at).toLocaleString("ar-SA")}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">لا توجد سجلات</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white text-sm rounded-lg">
            السابق
          </button>
          <span className="text-gray-400 text-sm py-1.5 px-2">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white text-sm rounded-lg">
            التالي
          </button>
        </div>
      )}
    </div>
  );
}
