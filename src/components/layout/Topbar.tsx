"use client";

import { useRouter } from "next/navigation";
import AdminNotificationBell from "@/components/AdminNotificationBell";

interface TopbarProps {
  title: string;
}

export function Topbar({ title }: TopbarProps) {
  const router = useRouter();

  return (
    <header className="h-16 bg-white border-b border-brand-border flex items-center justify-between px-6 shadow-card sticky top-0 z-30">
      <h1 className="text-lg font-bold text-navy">{title}</h1>
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push("/attendance")}
          className="w-9 h-9 rounded-lg flex items-center justify-center border border-gray-200 text-gray-500 hover:border-teal hover:text-teal hover:bg-teal-light transition-all"
          title="صفحة تسجيل الدخول والخروج"
        >
          <div className="w-5 h-5 bg-gray-300 rounded" />
        </button>
        <AdminNotificationBell />
      </div>
    </header>
  );
}
