"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { MobileSidebar, Sidebar } from "@/components/layout/Sidebar";
import { SubscriptionAccessBanner } from "@/components/layout/SubscriptionAccessBanner";
import type { SchoolSubscriptionAccess } from "@/lib/school-subscription";
import { useT } from "@/lib/i18n-provider";
import { SupportPresenceBanner } from "@/components/layout/SupportPresenceBanner";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { AssistantDock } from "@/components/assistant/AssistantDock";

interface DashboardNavigationContextValue {
  mobileOpen: boolean;
  subscriptionLocked: boolean;
  openMobile: () => void;
  closeMobile: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

const DashboardNavigationContext = createContext<DashboardNavigationContextValue | null>(null);

export function useDashboardNavigation() {
  const value = useContext(DashboardNavigationContext);
  if (!value) throw new Error("useDashboardNavigation must be used inside DashboardShell");
  return value;
}

export function DashboardShell({
  children,
  schoolName,
  schoolLogo,
  subscriptionAccess,
  supportAccess,
}: {
  children: ReactNode;
  schoolName?: string | null;
  schoolLogo?: string | null;
  subscriptionAccess: SchoolSubscriptionAccess;
  supportAccess?: { expiresAt: string } | null;
}) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mobileOpen = openedOnPath === pathname;
  const openMobile = useCallback(() => setOpenedOnPath(pathname), [pathname]);
  const closeMobile = useCallback(() => setOpenedOnPath(null), []);
  const navigation = useMemo(
    () => ({ mobileOpen, subscriptionLocked: subscriptionAccess.mode === "locked" && !supportAccess, openMobile, closeMobile, triggerRef }),
    [mobileOpen, subscriptionAccess.mode, supportAccess, openMobile, closeMobile]
  );
  const lockedAwayFromPayment = subscriptionAccess.mode === "locked" && !supportAccess && pathname !== "/subscription";

  useEffect(() => {
    if (lockedAwayFromPayment) router.replace("/subscription");
  }, [lockedAwayFromPayment, router]);

  return (
    <DashboardNavigationContext.Provider value={navigation}>
      <div className="min-h-screen w-full overflow-x-clip bg-brand-bg">
        <Sidebar schoolName={schoolName} schoolLogo={schoolLogo} subscriptionAccess={supportAccess ? undefined : subscriptionAccess} supportReadOnly={Boolean(supportAccess)} />
        <MobileSidebar
          open={mobileOpen}
          onClose={closeMobile}
          returnFocusRef={triggerRef}
          schoolName={schoolName}
          schoolLogo={schoolLogo}
          subscriptionAccess={supportAccess ? undefined : subscriptionAccess}
          supportReadOnly={Boolean(supportAccess)}
        />
        <main
          id="dashboard-main"
          className="min-h-screen min-w-0 overflow-x-clip bg-brand-bg xl:ms-[220px]"
        >
          <SupportPresenceBanner initial={supportAccess ? { active: true, expiresAt: supportAccess.expiresAt, isSupportViewer: true } : null} />
          <SubscriptionAccessBanner access={subscriptionAccess} />
          {lockedAwayFromPayment ? (
            <div className="p-8 text-center text-sm text-gray-500">{t("schoolSubscription.redirecting")}</div>
          ) : children}
        </main>
        {subscriptionAccess.mode !== "locked" && !supportAccess && pathname !== "/assistant" && (
          <PermissionGate permission="settings.ai">
            <AssistantDock />
          </PermissionGate>
        )}
      </div>
    </DashboardNavigationContext.Provider>
  );
}
