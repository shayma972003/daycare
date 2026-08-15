"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { clearPermissions } from "@/lib/use-permissions";

/**
 * Keeps authenticated dashboard effects unmounted until the client session is
 * known. The server layout already rejects a missing session; this boundary
 * covers hydration, expiry and sign-out without letting protected pollers run
 * against an absent cookie.
 */
export function DashboardSessionBoundary({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    if (status === "authenticated") {
      redirected.current = false;
      return;
    }
    if (status !== "unauthenticated" || redirected.current) return;
    redirected.current = true;
    clearPermissions();
    router.replace("/login");
  }, [router, status]);

  if (status !== "authenticated") return null;
  return children;
}
