"use client";

import { useRouter } from "next/navigation";
import AdminNotificationBell from "@/components/AdminNotificationBell";
import { useT } from "@/lib/i18n-provider";

interface TopbarProps {
  title: string;
}

export function Topbar({ title }: TopbarProps) {
  const t = useT();
  const router = useRouter();

  return (
    <header className="h-16 bg-white border-b border-brand-border flex items-center justify-between px-6 shadow-card sticky top-0 z-30">
      <h1 className="text-lg font-bold text-navy">{title}</h1>
      <div className="flex items-center gap-2">
        {/* The palette's own trigger. A keyboard shortcut nobody is told about
            is a shortcut nobody uses — and this is also the only way in on a
            touch device, which has no Ctrl+K. */}
        <button
          onClick={() =>
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
            )
          }
          className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 text-gray-400 hover:border-teal hover:text-teal transition-all text-xs"
          title={t("palette.title")}
        >
          <span>{t("palette.search")}</span>
          <kbd className="font-sans text-[10px] bg-gray-100 rounded px-1.5 py-0.5">Ctrl K</kbd>
        </button>
        <button
          onClick={() => router.push("/attendance")}
          className="w-9 h-9 rounded-lg flex items-center justify-center border border-gray-200 text-gray-500 hover:border-teal hover:text-teal hover:bg-teal-light transition-all"
          title={t("layout.kioskPage")}
        >
          <div className="w-5 h-5 bg-gray-300 rounded" />
        </button>
        <AdminNotificationBell />
      </div>
    </header>
  );
}
