"use client";

import Link from "next/link";
import Image from "next/image";
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
import { useEffect, useState, type RefObject } from "react";
import type { SchoolSubscriptionAccess } from "@/lib/school-subscription";

interface SidebarProps {
  schoolName?: string | null;
  schoolLogo?: string | null;
  subscriptionAccess?: SchoolSubscriptionAccess;
  supportReadOnly?: boolean;
}

function SidebarContent({
  schoolName: schoolNameProp,
  schoolLogo,
  subscriptionAccess,
  supportReadOnly = false,
  onNavigate,
}: SidebarProps & { onNavigate?: () => void }) {
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const pathname = usePathname();
  const { data: session } = useSession();
  const { can, loading: permissionsLoading } = usePermissions();
  const canViewFinance = !permissionsLoading && can("finance.view");
  const [financeDueCount, setFinanceDueCount] = useState(0);

  useEffect(() => {
    if (!canViewFinance) return;
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      fetch("/api/expenses/occurrences?status=PENDING&due=1&limit=1", { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ count?: number }> : null)
        .then((data) => setFinanceDueCount(data?.count ?? 0))
        .catch(() => undefined);
    };
    load();
    window.addEventListener("finance-expenses-updated", load);
    return () => {
      controller.abort();
      window.removeEventListener("finance-expenses-updated", load);
    };
  }, [canViewFinance]);

  const schoolName =
    schoolNameProp ??
    (session?.user as { schoolName?: string } | undefined)?.schoolName ??
    t("app.name");

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden border-e border-[#E7DEF8] bg-white">

      <div className="relative flex h-[76px] items-center justify-center overflow-hidden border-b border-[#EEE8F8] px-5">
        <div aria-hidden className="absolute -start-7 -top-8 h-20 w-20 rounded-full bg-[#FFF0EB]" />
        <div aria-hidden className="absolute -end-5 -bottom-9 h-20 w-20 rounded-full bg-[#F1EBFD]" />
        <Image
          src="/brand/logo-orange-purpule.svg"
          alt={t("app.name")}
          width={154}
          height={40}
          priority
          className="relative h-auto w-[150px]"
        />
      </div>

      {/* School identity */}
      <div className="relative mb-2 flex items-center gap-3 border-b border-[#EEE8F8] px-4 py-4">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-[#DFD1F7] bg-[#F1EBFD] shadow-sm">
          {schoolLogo ? (
            <SchoolLogo src={schoolLogo} name={schoolName ?? t("layout.schoolLogo")} className="h-full w-full bg-[#F1EBFD] text-[#4A2799]" />
          ) : (
            <span className="text-sm font-bold text-[#4A2799]">{schoolName.slice(0, 1)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-bold leading-tight text-[#291B45]">{schoolName}</p>
          <p className="mt-0.5 text-[11px] text-[#8C8298]">{t("app.name")}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="relative flex-1 flex flex-col gap-0.5 px-3 overflow-y-auto">
        {NAV_GROUPS.map((group, groupIndex) => {
          /* While the permission list is still in flight, show only what needs
             no permission. Filling a short menu in reads better than showing
             everything and taking entries away a moment later. */
          const visible = group.items.filter((item) => {
            if (supportReadOnly) return item.href !== "/assistant";
            if (subscriptionAccess?.mode === "locked" && item.href !== "/subscription") return false;
            return item.permission === null || (!permissionsLoading && can(item.permission));
          });
          if (visible.length === 0) return null;

          return (
            <div key={group.key ?? `group-${groupIndex}`} className={group.key ? "mt-4" : undefined}>
              {group.key && (
                <p className="px-4 pb-1.5 text-[10px] font-medium tracking-wide text-[#9C91AA]">
                  {t(group.key)}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {visible.map((item) => {
                  const isActive =
                    item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : item.href === "/settings"
                        ? pathname === "/settings" ||
                          (pathname.startsWith("/settings/") &&
                            !pathname.startsWith("/settings/permissions"))
                      : pathname.startsWith(item.href);

                  const link = (
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm transition-all duration-150",
                        isActive
                          ? "border-[#DED0F7] bg-[#F1EBFD] font-bold text-[#4A2799] shadow-[0_6px_18px_rgba(74,39,153,0.08)]"
                          : "border-transparent font-normal text-[#6F647B] hover:border-[#EEE6FA] hover:bg-[#FBF9FF] hover:text-[#4A2799]"
                      )}
                    >
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full flex-shrink-0",
                          isActive ? "bg-[#FF6B4A]" : "border border-[#B8AFC3] bg-transparent group-hover:border-[#6D3FD6]"
                        )}
                      />
                      <span>{t(item.key)}</span>
                      {item.href === "/subscription" && (subscriptionAccess?.mode !== "active" || subscriptionAccess.showRenewalWarning) && (
                        <span
                          aria-label={t("schoolSubscription.expiredIndicator")}
                          className="ms-auto h-2.5 w-2.5 shrink-0 rounded-full bg-red-500"
                        />
                      )}
                      {item.href === "/statistics" && financeDueCount > 0 && (
                        <span
                          aria-label={t("finance.expensesNeedAction", { n: String(financeDueCount) })}
                          className="ms-auto inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
                        >
                          {financeDueCount > 99 ? "99+" : financeDueCount}
                        </span>
                      )}
                    </Link>
                  );

                  return supportReadOnly || item.permission === null ? (
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
      <div className="relative space-y-1 border-t border-[#EEE8F8] p-3">
        <LanguageSwitcher />
        {supportReadOnly ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
            {t("layout.supportPreviewHint")}
          </p>
        ) : <button
          onClick={() => {
            clearPermissions();
            void signOut({ callbackUrl: "/login", redirect: false });
          }}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-[#8B8095] transition-all hover:bg-[#FFF0EB] hover:text-[#DC4728]"
        >
          <div className="h-2 w-2 flex-shrink-0 rounded-full border border-[#B8AFBF]" />
          <span>{t("auth.logout")}</span>
        </button>}
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
      headerClassName="border-[#E7DEF8] bg-white [&_h2]:truncate [&_h2]:text-[#291B45] [&_button]:text-[#6F647B]"
      contentClassName="bg-white p-0"
    >
      <SidebarContent {...props} onNavigate={onClose} />
    </Drawer>
  );
}
