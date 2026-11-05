"use client";

import { useRouter } from "next/navigation";
import AdminNotificationBell from "@/components/AdminNotificationBell";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { useT } from "@/lib/i18n-provider";
import { useDashboardNavigation } from "@/components/layout/DashboardShell";

interface TopbarProps {
  title?: string;
}

export function Topbar({ title }: TopbarProps = {}) {
  const t = useT();
  const router = useRouter();
  const { mobileOpen, subscriptionLocked, openMobile, closeMobile, triggerRef } = useDashboardNavigation();

  return (
    <header className="sticky top-0 z-30 flex min-h-16 w-full min-w-0 items-center gap-2 border-b border-[#E7DEF8] bg-white/95 px-3 py-2 shadow-[0_6px_20px_rgba(74,39,153,0.04)] backdrop-blur sm:gap-3 sm:px-4 lg:px-6">
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-[#FF6B4A] via-[#6D3FD6] to-transparent opacity-70" />
      <button
        ref={triggerRef}
        type="button"
        onClick={mobileOpen ? closeMobile : openMobile}
        aria-label={t(mobileOpen ? "layout.closeNavigation" : "layout.openNavigation")}
        aria-expanded={mobileOpen}
        aria-controls="mobile-dashboard-navigation"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E2D8F4] bg-[#FBF9FF] text-[#4A2799] hover:border-[#6D3FD6] hover:bg-[#F1EBFD] xl:hidden"
      >
        <span aria-hidden className="text-xl leading-none">☰</span>
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-bold text-[#291B45] sm:text-lg">{title ?? t("dashboard.title")}</h1>
        <div aria-hidden className="mt-1 h-1 w-8 rounded-full bg-[#FF6B4A]" />
      </div>
      {!subscriptionLocked && <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {/* The palette's own trigger. A keyboard shortcut nobody is told about
            is a shortcut nobody uses — and this is also the only way in on a
            touch device, which has no Ctrl+K. */}
        <button
          onClick={() =>
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
            )
          }
          className="hidden md:flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 text-gray-400 hover:border-teal hover:text-teal transition-all text-xs"
          title={t("palette.title")}
        >
          <span>{t("palette.search")}</span>
          <kbd dir="ltr" className="font-sans text-[10px] bg-gray-100 rounded px-1.5 py-0.5">{t("palette.shortcut")}</kbd>
        </button>
        <PermissionGate permission="attendance.students">
          <button
            onClick={() => router.push("/attendance")}
            className="w-9 h-9 rounded-lg flex items-center justify-center border border-gray-200 text-gray-500 hover:border-teal hover:text-teal hover:bg-teal-light transition-all"
            title={t("nav.attendance")}
          >
            <div className="w-5 h-5 bg-gray-300 rounded" />
          </button>
        </PermissionGate>
        <PermissionGate permission="settings.manage">
          <AdminNotificationBell />
        </PermissionGate>
      </div>}
    </header>
  );
}
