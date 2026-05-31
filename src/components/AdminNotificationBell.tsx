"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";

interface AdminMsg {
  recipientId: string;
  messageId: string;
  subject: string;
  preview: string;
  sent_at: string | null;
  read_at: string | null;
}

interface NotifData {
  unreadCount: number;
  messages: AdminMsg[];
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "الآن";
  if (m < 60) return `${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} س`;
  return `${Math.floor(h / 24)} ي`;
}

export default function AdminNotificationBell() {
  const [data, setData] = useState<NotifData>({ unreadCount: 0, messages: [] });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await axios.get<NotifData>("/api/notifications/admin-messages");
      setData(res.data);
    } catch {
      // not critical
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function markRead(recipientId: string) {
    await axios.patch("/api/notifications/admin-messages", { recipientId });
    setData((prev) => ({
      ...prev,
      unreadCount: Math.max(0, prev.unreadCount - 1),
      messages: prev.messages.map((m) =>
        m.recipientId === recipientId ? { ...m, read_at: new Date().toISOString() } : m
      ),
    }));
  }

  async function markAllRead() {
    await axios.patch("/api/notifications/admin-messages", {});
    setData((prev) => ({
      ...prev,
      unreadCount: 0,
      messages: prev.messages.map((m) => ({ ...m, read_at: m.read_at ?? new Date().toISOString() })),
    }));
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen((v) => !v); if (!open) load(); }}
        className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors"
        title="رسائل الإدارة"
      >
        <span className="text-lg text-gray-500">🔔</span>
        {data.unreadCount > 0 && (
          <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {data.unreadCount > 9 ? "9+" : data.unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-11 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden" dir="rtl">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-bold text-gray-800 text-sm">رسائل الإدارة</span>
            {data.unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-indigo-600 hover:text-indigo-700">
                تحديد الكل كمقروء
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
            {data.messages.length === 0 && (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">لا توجد رسائل</div>
            )}
            {data.messages.slice(0, 5).map((m) => (
              <div
                key={m.recipientId}
                className={`px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${!m.read_at ? "bg-indigo-50/40" : ""}`}
                onClick={() => { if (!m.read_at) markRead(m.recipientId); }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${!m.read_at ? "text-indigo-900" : "text-gray-800"}`}>
                      {m.subject}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{m.preview}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-xs text-gray-400">{timeAgo(m.sent_at)}</span>
                    {!m.read_at && <span className="w-2 h-2 bg-indigo-500 rounded-full" />}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {data.messages.length > 5 && (
            <div className="px-4 py-2.5 border-t border-gray-100 text-center">
              <span className="text-xs text-gray-400">عرض {data.messages.length} رسالة</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
