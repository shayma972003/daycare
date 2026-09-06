"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { MobileSidebar, Sidebar } from "@/components/layout/Sidebar";
import { SubscriptionAccessBanner } from "@/components/layout/SubscriptionAccessBanner";
import type { SchoolSubscriptionAccess } from "@/lib/school-subscription";

interface DashboardNavigationContextValue {
  mobileOpen: boolean;
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
}: {
  children: ReactNode;
  schoolName?: string | null;
  schoolLogo?: string | null;
  subscriptionAccess: SchoolSubscriptionAccess;
}) {
  const pathname = usePathname();
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mobileOpen = openedOnPath === pathname;
  const openMobile = useCallback(() => setOpenedOnPath(pathname), [pathname]);
  const closeMobile = useCallback(() => setOpenedOnPath(null), []);
  const navigation = useMemo(
    () => ({ mobileOpen, openMobile, closeMobile, triggerRef }),
    [mobileOpen, openMobile, closeMobile]
  );

  return (
    <DashboardNavigationContext.Provider value={navigation}>
      <div className="min-h-screen w-full overflow-x-clip bg-brand-bg">
        <Sidebar schoolName={schoolName} schoolLogo={schoolLogo} />
        <MobileSidebar
          open={mobileOpen}
          onClose={closeMobile}
          returnFocusRef={triggerRef}
          schoolName={schoolName}
          schoolLogo={schoolLogo}
        />
        <main
          id="dashboard-main"
          className="min-h-screen min-w-0 overflow-x-clip bg-brand-bg xl:ms-[220px]"
        >
          <SubscriptionAccessBanner access={subscriptionAccess} />
          {children}
        </main>
      </div>
    </DashboardNavigationContext.Provider>
  );
}
