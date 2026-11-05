import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Alert } from "react-native";

import { currentAccount, signOut as revokeSession, type Account } from "@/api/auth";
import { useLanguage } from "@/language";
import { registerDeviceForPush, unregisterDeviceForPush } from "@/notifications/device";
import { stopLocationAttendance, syncLocationAttendance } from "@/location-attendance";

type SessionContextValue = {
  account: Account | null;
  loading: boolean;
  setAccount: (account: Account | null) => void;
  refreshAccount: () => Promise<Account | null>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const promptedLocationAccountId = useRef<string | null>(null);

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
        const setup = await syncLocationAttendance().catch(() => null);
        const needsSetup = setup?.status === "permission-required"
          || setup?.status === "services-disabled";
        if (needsSetup && promptedLocationAccountId.current !== account.id) {
          promptedLocationAccountId.current = account.id;
          Alert.alert(
            t("تفعيل الحضور التلقائي"),
            t("يلزم تشغيل موقع الجهاز ومنح تطبيق طفولة تيك إذن الموقع طوال الوقت لتسجيل الدخول والخروج تلقائيًا."),
            [
              { text: t("لاحقًا"), style: "cancel" },
              {
                text: t("تشغيل الموقع ومنح الإذن"),
                onPress: () => {
                  void syncLocationAttendance({
                    requestPermissions: true,
                    requestServices: true,
                  }).catch(() => undefined);
                },
              },
            ]
          );
        }
      }
    })();
  }, [account, t]);

  const refreshAccount = useCallback(async () => {
    const current = await currentAccount();
    setAccount(current);
    return current;
  }, []);

  const signOut = useCallback(async () => {
    await stopLocationAttendance().catch(() => undefined);
    await unregisterDeviceForPush();
    await revokeSession();
    promptedLocationAccountId.current = null;
    setAccount(null);
  }, []);

  const value = useMemo(
    () => ({ account, loading, setAccount, refreshAccount, signOut }),
    [account, loading, refreshAccount, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
