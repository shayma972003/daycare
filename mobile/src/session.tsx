import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { currentAccount, signOut as revokeSession, type Account } from "@/api/auth";
import { registerDeviceForPush, unregisterDeviceForPush } from "@/notifications/device";
import { stopLocationAttendance, syncLocationAttendance } from "@/location-attendance";

type SessionContextValue = {
  account: Account | null;
  loading: boolean;
  setAccount: (account: Account | null) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    currentAccount()
      .then((current) => {
        if (!cancelled) setAccount(current);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!account) return;
    void (async () => {
      // Ask for one system permission at a time. Android may dismiss one of two
      // overlapping permission dialogs, which previously made location setup
      // appear to do nothing immediately after sign-in.
      await registerDeviceForPush().catch(() => undefined);
      if (account.kind === "staff" && account.teacherId) {
        await syncLocationAttendance({ requestPermissions: true }).catch(() => undefined);
      }
    })();
  }, [account]);

  const signOut = useCallback(async () => {
    await stopLocationAttendance().catch(() => undefined);
    await unregisterDeviceForPush();
    await revokeSession();
    setAccount(null);
  }, []);

  const value = useMemo(
    () => ({ account, loading, setAccount, signOut }),
    [account, loading, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
