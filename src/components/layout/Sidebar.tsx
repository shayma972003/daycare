"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { cn, t } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: t("nav.home") },
  { href: "/students", label: t("nav.students") },
  { href: "/classes", label: t("nav.classes") },
  { href: "/statistics", label: t("nav.statistics") },
  { href: "/teachers", label: t("nav.teachers") },
  { href: "/settings", label: t("nav.settings") },
];

interface SidebarProps {
  schoolName?: string | null;
  schoolLogo?: string | null;
}

export function Sidebar({ schoolName: schoolNameProp, schoolLogo }: SidebarProps = {}) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const schoolName =
    schoolNameProp ??
    (session?.user as { schoolName?: string } | undefined)?.schoolName ??
    t("app.name");

  return (
    <aside
      className="fixed right-0 top-0 h-screen w-[220px] bg-navy flex flex-col z-40 overflow-hidden"
      style={{ borderRadius: "0 0 0 20px" }}
    >
      {/* Faint dot pattern overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* School identity */}
      <div className="relative flex items-center gap-3 p-5 border-b border-white/10">
        <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-white/20 bg-white/10 flex-shrink-0 flex items-center justify-center">
          {schoolLogo ? (
            <img src={schoolLogo} alt={schoolName ?? "شعار المدرسة"} className="w-full h-full object-contain" />
          ) : (
            <span className="text-white/30 text-xs">[شعار]</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm leading-tight truncate">{schoolName}</p>
          <p className="text-white/40 text-xs mt-0.5">{t("app.name")}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="relative flex-1 flex flex-col gap-1 p-3 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-white text-navy shadow-card border-r-4 border-r-coral"
                  : "text-white/60 hover:text-white hover:bg-white/10"
              )}
            >
              <div className={cn("w-5 h-5 rounded flex-shrink-0", isActive ? "bg-coral/20" : "bg-white/10")} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="relative p-3 border-t border-white/10">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-white/50 hover:text-white hover:bg-white/10 text-sm transition-all"
        >
          <div className="w-5 h-5 bg-white/10 rounded flex-shrink-0" />
          <span>{t("auth.logout")}</span>
        </button>
      </div>
    </aside>
  );
}
