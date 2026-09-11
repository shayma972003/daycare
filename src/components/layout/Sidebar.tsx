"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n-provider";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { clearPermissions, usePermissions } from "@/lib/use-permissions";
import { NAV_GROUPS } from "@/lib/nav";
import { Drawer } from "@/components/ui/Drawer";
import { SchoolLogo } from "@/components/layout/SchoolLogo";
import type { RefObject } from "react";

interface SidebarProps {
  schoolName?: string | null;
  schoolLogo?: string | null;
}

function SidebarContent({
  schoolName: schoolNameProp,
  schoolLogo,
  onNavigate,
}: SidebarProps & { onNavigate?: () => void }) {
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
    <div className="relative flex h-full w-full flex-col overflow-hidden border-e border-[#E8E3EF] bg-white">

      {/* School identity */}
      <div className="relative mb-2 flex items-center gap-3 border-b border-[#EEEAF2] p-5">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#E2D7F3] bg-[#F1E8FF]">
          {schoolLogo ? (
            <SchoolLogo src={schoolLogo} name={schoolName ?? t("layout.schoolLogo")} className="h-full w-full bg-[#F1E8FF] text-[#5B14D1]" />
          ) : (
            <span className="text-sm font-bold text-[#5B14D1]">{schoolName.slice(0, 1)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-bold leading-tight text-[#2D2238]">{schoolName}</p>
          <p className="mt-0.5 text-xs text-[#9A909F]">{t("app.name")}</p>
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
                <p className="px-4 pb-1.5 text-[10px] font-medium tracking-wide text-[#AAA1B0]">
                  {t(group.key)}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {visible.map((item) => {
                  const isActive =
                    item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname.startsWith(item.href);

                  const link = (
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all duration-150",
                        isActive
                          ? "bg-[#F1E8FF] text-[#5B14D1] font-bold"
                          : "text-[#776C80] font-normal hover:text-[#5B14D1] hover:bg-[#FAF8FC]"
                      )}
                    >
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full flex-shrink-0",
                          isActive ? "bg-[#5B14D1]" : "border border-[#B8AFBF] bg-transparent"
                        )}
                      />
                      <span>{t(item.key)}</span>
                    </Link>
                  );

                  return item.permission === null ? (
                    <div key={item.href}>{link}</div>
                  ) : (
                    <PermissionGate key={item.href} permission={item.permission}>
                      {link}
                    </PermissionGate>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Language and logout */}
      <div className="relative space-y-1 border-t border-[#EEEAF2] p-3">
        <LanguageSwitcher />
        <button
          onClick={() => {
            clearPermissions();
            void signOut({ callbackUrl: "/login", redirect: false });
          }}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-[#8B8095] transition-all hover:bg-[#FAF8FC] hover:text-[#5B14D1]"
        >
          <div className="h-2 w-2 flex-shrink-0 rounded-full border border-[#B8AFBF]" />
          <span>{t("auth.logout")}</span>
        </button>
      </div>
    </div>
  );
}

export function Sidebar(props: SidebarProps = {}) {
  const t = useT();
  return (
    <aside
      aria-label={t("layout.mainNavigation")}
      className="fixed start-0 top-0 z-40 hidden h-screen w-[220px] overflow-hidden xl:flex"
    >
      <SidebarContent {...props} />
    </aside>
  );
}

export function MobileSidebar({
  open,
  onClose,
  returnFocusRef,
  ...props
}: SidebarProps & {
  open: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  return (
    <Drawer
      open={open}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      title={props.schoolName ?? t("app.name")}
      panelId="mobile-dashboard-navigation"
      panelClassName="max-w-[min(20rem,calc(100vw-2.5rem))] bg-white sm:max-w-[20rem] xl:hidden"
      headerClassName="border-[#E8E3EF] bg-white [&_h2]:truncate [&_h2]:text-[#2D2238] [&_button]:text-[#776C80]"
      contentClassName="bg-white p-0"
    >
      <SidebarContent {...props} onNavigate={onClose} />
    </Drawer>
  );
}
