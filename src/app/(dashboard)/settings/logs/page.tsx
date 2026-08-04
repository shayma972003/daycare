"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { useT } from "@/lib/i18n-provider";

interface LogEntry {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  performed_by: string;
  ip_address: string | null;
  device_info: string | null;
  created_at: string;
}

/**
 * Keys, not labels. A map built here resolves once when the module loads and
 * then never changes language again.
 */
const ENTITY_TYPE_KEYS: Record<string, string> = {
  student: "fields.students",
  teacher: "fields.teachers",
  class: "fields.classes",
  invoice: "fields.invoices",
  settings: "fields.settings",
  auth: "logs.signIn",
};

const PAGE_SIZE = 50;

export default function ActivityLogsPage() {
  const t = useT();
  const router = useRouter();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  async function handleExportLogs() {
    setExporting(true);
    try {
      const res = await axios.post<{ file_url: string }>("/api/settings/logs/export");
      const link = document.createElement("a");
      link.href = res.data.file_url;
      link.download = "سجل-التغييرات.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      alert(t("logs.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  const fetchLogs = useCallback(() => {
    setLoading(true);
    axios
      .get<{ logs: LogEntry[]; total: number }>("/api/settings/logs", {
        params: {
          search: search || undefined,
          entity_type: entityType || undefined,
          skip: page * PAGE_SIZE,
        },
      })
      .then((res) => {
        setLogs(res.data.logs);
        setTotal(res.data.total);
      })
      .finally(() => setLoading(false));
  }, [search, entityType, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  /**
   * Changing a filter returns to the first page.
   *
   * Done where the filter changes, not in an effect watching it. As an effect it
   * rendered page 5 of the new filter first — usually an empty list — then
   * corrected itself, and fired a wasted request for that page on the way.
   */
  function applyFilter(change: () => void) {
    change();
    setPage(0);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title={t("logs.title")} />
      <div className="p-6">
        <div className="bg-white rounded-xl p-6 shadow-card">
          {/* Header */}
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
            <button onClick={() => router.push("/settings")} className="text-sm text-gray-400 hover:text-gray-600">
              → العودة للإعدادات
            </button>
            <h1 className="text-lg font-bold text-gray-900">{t("logs.title")}</h1>
          </div>

          {/* Filter bar */}
          <div className="flex gap-3 mb-6">
            <input
              value={search}
              onChange={(e) => applyFilter(() => setSearch(e.target.value))}
              placeholder={t("logs.search")}
              className="flex-1 px-4 py-2 rounded-md border border-gray-200 text-sm text-right focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
            />
            <select
              value={entityType}
              onChange={(e) => applyFilter(() => setEntityType(e.target.value))}
              className="px-3 py-2 rounded-md border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
            >
              <option value="">{t("logs.allActions")}</option>
              <option value="student">{t("fields.students")}</option>
              <option value="teacher">{t("fields.teachers")}</option>
              <option value="class">{t("fields.classes")}</option>
              <option value="invoice">{t("fields.invoices")}</option>
              <option value="settings">{t("fields.settings")}</option>
              <option value="auth">{t("logs.signIn")}</option>
            </select>
            <button
              onClick={handleExportLogs}
              disabled={exporting}
              className="px-4 py-2 rounded-md bg-white border border-[#666666] text-[#666666] text-sm hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA] transition-all disabled:opacity-60 whitespace-nowrap"
            >
              {exporting ? t("logs.exporting") : t("logs.downloadPdf")}
            </button>
          </div>

          {/* Log entries */}
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">{t("logs.loading")}</div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">{t("logs.empty")}</div>
          ) : (
            <div className="space-y-0 font-mono text-sm">
              {logs.map((log, index) => (
                <div
                  key={log.id}
                  className={`py-3 px-4 border-b border-gray-50 text-right ${
                    index % 2 === 0 ? "bg-white" : "bg-gray-50/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-gray-900 font-medium text-sm">{log.action}</p>
                      {log.entity_name && (
                        <p className="text-gray-400 text-xs mt-0.5">
                          {ENTITY_TYPE_KEYS[log.entity_type ?? ""] ? t(ENTITY_TYPE_KEYS[log.entity_type ?? ""]) : log.entity_type} · {log.entity_name}
                        </p>
                      )}
                    </div>

                    <div className="text-left flex-shrink-0">
                      <p className="text-gray-400 text-xs">
                        {new Date(log.created_at).toLocaleDateString("ar-SA")}{" "}
                        {new Date(log.created_at).toLocaleTimeString("ar-SA")}
                      </p>
                      <p className="text-gray-400 text-xs mt-0.5">{log.performed_by}</p>
                      {log.device_info && <p className="text-gray-300 text-xs mt-0.5">{log.device_info}</p>}
                      {log.ip_address && <p className="text-gray-300 text-xs">{log.ip_address}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-4 py-2 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                السابق
              </button>
              <span className="text-xs text-gray-400 px-2">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-4 py-2 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                التالي
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
