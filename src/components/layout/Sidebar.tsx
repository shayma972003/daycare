"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n-provider";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";

/**
 * Nav entries as translation *keys*, resolved inside the component.
 *
 * They were resolved here at module scope, which froze every label to whatever
 * language was active when the module first loaded — switching language would
 * have changed the whole product except the menu.
 *
 * Every entry now has a key. Four of them carried a literal Arabic label
 * instead, left over from when those screens were added — so switching to
 * English translated the menu around them and left four Arabic words in the
 * middle of it.
 */
const navItems: Array<{ href: string; key: string }> = [
  { href: "/dashboard", key: "nav.home" },
  { href: "/students", key: "nav.students" },
  { href: "/care", key: "nav.care" },
  { href: "/calendar", key: "nav.calendar" },
  { href: "/units", key: "nav.units" },
  { href: "/classes", key: "nav.classes" },
  { href: "/statistics", key: "nav.statistics" },
  { href: "/teachers", key: "nav.teachers" },
  { href: "/shifts", key: "nav.shifts" },
  { href: "/settings", key: "nav.settings" },
];

interface SidebarProps {
  schoolName?: string | null;
  schoolLogo?: string | null;
}

export function Sidebar({ schoolName: schoolNameProp, schoolLogo }: SidebarProps = {}) {
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const pathname = usePathname();
  const { data: session } = useSession();

  const schoolName =
    schoolNameProp ??
    (session?.user as { schoolName?: string } | undefined)?.schoolName ??
    t("app.name");

  return (
    <aside className="fixed right-0 top-0 h-screen w-[220px] bg-navy flex flex-col z-40 overflow-hidden">
      {/* Faint dot pattern overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* School identity */}
      <div className="relative flex items-center gap-3 p-5 mb-2">
        <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-white/10 bg-white/5 flex-shrink-0 flex items-center justify-center">
          {schoolLogo ? (
            <img src={schoolLogo} alt={schoolName ?? t("layout.schoolLogo")} className="w-full h-full object-contain" />
          ) : (
            <span className="text-white/20 text-xs">✦</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm leading-tight truncate">{schoolName}</p>
          <p className="text-white/30 text-xs mt-0.5">{t("app.name")}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="relative flex-1 flex flex-col gap-0.5 px-3">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all duration-150",
                isActive
                  ? "bg-white text-gray-900 font-bold shadow-sm border-r-[3px] border-r-coral"
                  : "text-white/50 font-normal hover:text-white/80 hover:bg-white/5"
              )}
            >
              <div className={cn("w-2 h-2 rounded-full flex-shrink-0", isActive ? "bg-coral" : "bg-white/20")} />
              <span>{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>

      {/* Language and logout */}
      <div className="relative p-3 border-t border-white/5 space-y-1">
        <LanguageSwitcher />
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-white/30 hover:text-white/60 hover:bg-white/5 text-sm transition-all"
        >
          <div className="w-2 h-2 rounded-full bg-white/10 flex-shrink-0" />
          <span>{t("auth.logout")}</span>
        </button>
      </div>
    </aside>
  );
}
