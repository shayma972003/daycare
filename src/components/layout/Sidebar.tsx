"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n-provider";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { usePermissions } from "@/lib/use-permissions";
import { NAV_GROUPS } from "@/lib/nav";

interface SidebarProps {
  schoolName?: string | null;
  schoolLogo?: string | null;
}

export function Sidebar({ schoolName: schoolNameProp, schoolLogo }: SidebarProps = {}) {
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const pathname = usePathname();
  const { data: session } = useSession();
  const { can, loading: permissionsLoading } = usePermissions();

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
      <nav className="relative flex-1 flex flex-col gap-0.5 px-3 overflow-y-auto">
        {NAV_GROUPS.map((group, groupIndex) => {
          /* While the permission list is still in flight, show only what needs
             no permission. Filling a short menu in reads better than showing
             everything and taking entries away a moment later. */
          const visible = group.items.filter(
            (item) => item.permission === null || (!permissionsLoading && can(item.permission))
          );
          if (visible.length === 0) return null;

          return (
            <div key={group.key ?? `group-${groupIndex}`} className={group.key ? "mt-4" : undefined}>
              {group.key && (
                <p className="px-4 pb-1.5 text-[10px] font-medium tracking-wide text-white/25">
                  {t(group.key)}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {visible.map((item) => {
                  const isActive =
                    item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname.startsWith(item.href);

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
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full flex-shrink-0",
                          isActive ? "bg-coral" : "bg-white/20"
                        )}
                      />
                      <span>{t(item.key)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
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
