"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";

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

const ENTITY_TYPE_LABELS: Record<string, string> = {
  student: "الطلاب",
  teacher: "المعلمون",
  class: "الفصول",
  invoice: "الفواتير",
  settings: "الإعدادات",
  auth: "تسجيل الدخول",
};

const PAGE_SIZE = 50;

export default function ActivityLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(0);

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

  useEffect(() => {
    setPage(0);
  }, [search, entityType]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title="سجل التغييرات والإجراءات" />
      <div className="p-6">
        <div className="bg-white rounded-xl p-6 shadow-card">
          {/* Header */}
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
            <button onClick={() => router.push("/settings")} className="text-sm text-gray-400 hover:text-gray-600">
              → العودة للإعدادات
            </button>
            <h1 className="text-lg font-bold text-gray-900">سجل التغييرات والإجراءات</h1>
          </div>

          {/* Filter bar */}
          <div className="flex gap-3 mb-6">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في السجل..."
              className="flex-1 px-4 py-2 rounded-md border border-gray-200 text-sm text-right focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
            />
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="px-3 py-2 rounded-md border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
            >
              <option value="">جميع الإجراءات</option>
              <option value="student">الطلاب</option>
              <option value="teacher">المعلمون</option>
              <option value="class">الفصول</option>
              <option value="invoice">الفواتير</option>
              <option value="settings">الإعدادات</option>
              <option value="auth">تسجيل الدخول</option>
            </select>
          </div>

          {/* Log entries */}
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">جاري التحميل...</div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">لا توجد سجلات</div>
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
                          {ENTITY_TYPE_LABELS[log.entity_type ?? ""] ?? log.entity_type} · {log.entity_name}
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
