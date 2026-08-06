import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { currentAccount, signOut as endSession, type Account } from "./api/auth";

/**
 * Who is signed in, for the whole app.
 *
 * `kind` comes from the server, never from a picker. The sign-in screen offers
 * two doors because staff and guardians authenticate differently, but which
 * home screen a person lands on is decided by the token they were issued — a
 * chosen role is a claim, and this one is proved.
 */
interface SessionValue {
  account: Account | null;
  /** True until the launch check finishes; the router waits on it. */
  loading: boolean;
  setAccount: (account: Account | null) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    /* Asked of the server rather than decoded locally: a token can be
       cryptographically valid while the account behind it has been disabled. */
    currentAccount()
      .then((result) => {
        if (!cancelled) setAccount(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await endSession();
    setAccount(null);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ account, loading, setAccount, signOut }),
    [account, loading, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
