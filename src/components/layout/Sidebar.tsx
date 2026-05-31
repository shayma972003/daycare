"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { cn, t } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: t("nav.home"), icon: "🏠" },
  { href: "/students", label: t("nav.students"), icon: "👦" },
  { href: "/classes", label: t("nav.classes"), icon: "📚" },
  { href: "/statistics", label: t("nav.statistics"), icon: "📊" },
  { href: "/teachers", label: t("nav.teachers"), icon: "👩‍🏫" },
  { href: "/settings", label: t("nav.settings"), icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const schoolName =
    (session?.user as { schoolName?: string } | undefined)?.schoolName ??
    t("app.name");

  return (
    <aside className="fixed right-0 top-0 h-screen w-60 bg-[#1a2340] flex flex-col z-40 shadow-xl">
      {/* School branding */}
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xs text-white font-bold shrink-0">
            [logo]
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight truncate">
              {schoolName}
            </p>
            <p className="text-white/50 text-xs mt-0.5">
              {t("app.name")}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                isActive
                  ? "bg-white text-[#1a2340] shadow-md"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              )}
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User / logout */}
      <div className="p-3 border-t border-white/10">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all"
        >
          <span className="text-base">🚪</span>
          <span>{t("auth.logout")}</span>
        </button>
      </div>
    </aside>
  );
}
