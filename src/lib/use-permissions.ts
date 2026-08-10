"use client";

import { useEffect, useSyncExternalStore } from "react";
import axios from "axios";
import { useSession } from "next-auth/react";
import { grants } from "@/lib/permissions";

/**
 * The caller's permissions, for deciding what to *show*.
 *
 * This is presentation only. Every route still enforces its requirement from
 * `route-permissions.ts`. The store deliberately drops `me` while loading or
 * after an error, so a protected action is never rendered from stale data.
 */
export interface Me {
  id: string;
  name: string | null;
  role: string;
  schoolName: string;
  permissions: string[];
}

export type PermissionStatus = "idle" | "loading" | "ready" | "error";

export interface PermissionSnapshot {
  sessionKey: string | null;
  status: PermissionStatus;
  me: Me | null;
  error: Error | null;
}

const EMPTY_SNAPSHOT: PermissionSnapshot = {
  sessionKey: null,
  status: "idle",
  me: null,
  error: null,
};

let snapshot = EMPTY_SNAPSHOT;
let generation = 0;
let inFlight: {
  sessionKey: string;
  generation: number;
  promise: Promise<PermissionSnapshot>;
} | null = null;
const listeners = new Set<() => void>();

function publish(next: PermissionSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function fetchPermissions(sessionKey: string, force = false): Promise<PermissionSnapshot> {
  if (!force && snapshot.sessionKey === sessionKey) {
    if (snapshot.status === "ready" || snapshot.status === "error") {
      return Promise.resolve(snapshot);
    }
    if (inFlight?.sessionKey === sessionKey) return inFlight.promise;
  }

  const requestGeneration = ++generation;
  publish({ sessionKey, status: "loading", me: null, error: null });

  const promise = axios
    .get<Me>("/api/me")
    .then((response) => {
      if (generation !== requestGeneration || snapshot.sessionKey !== sessionKey) {
        return snapshot;
      }
      const next: PermissionSnapshot = {
        sessionKey,
        status: "ready",
        me: response.data,
        error: null,
      };
      publish(next);
      return next;
    })
    .catch((cause: unknown) => {
      if (generation !== requestGeneration || snapshot.sessionKey !== sessionKey) {
        return snapshot;
      }
      const error = cause instanceof Error ? cause : new Error("Failed to load permissions");
      const next: PermissionSnapshot = {
        sessionKey,
        status: "error",
        me: null,
        error,
      };
      publish(next);
      return next;
    })
    .finally(() => {
      if (inFlight?.generation === requestGeneration) inFlight = null;
    });

  inFlight = { sessionKey, generation: requestGeneration, promise };
  return promise;
}

/**
 * The single permission state source used by the hook and by mutation screens.
 * Exposed as an object so tests can prove subscription, de-duplication and
 * session isolation without adding a second cache implementation.
 */
export const permissionStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return snapshot;
  },
  syncSession(sessionKey: string | null) {
    if (!sessionKey) {
      this.clear();
      return Promise.resolve(snapshot);
    }
    if (snapshot.sessionKey !== sessionKey) return fetchPermissions(sessionKey, true);
    return fetchPermissions(sessionKey);
  },
  invalidate() {
    if (!snapshot.sessionKey) return Promise.resolve(snapshot);
    return fetchPermissions(snapshot.sessionKey, true);
  },
  clear() {
    generation += 1;
    inFlight = null;
    if (snapshot !== EMPTY_SNAPSHOT) publish(EMPTY_SNAPSHOT);
  },
};

function sessionKey(
  user: { id: string; schoolId: string; role: string } | undefined
): string | null {
  if (!user?.id || !user.schoolId) return null;
  return `${user.schoolId}:${user.id}:${user.role}`;
}

export function usePermissions() {
  const { data: session, status: sessionStatus } = useSession();
  const storeSnapshot = useSyncExternalStore(
    permissionStore.subscribe,
    permissionStore.getSnapshot,
    permissionStore.getSnapshot
  );
  const currentSessionKey =
    sessionStatus === "authenticated" ? sessionKey(session?.user) : null;

  useEffect(() => {
    if (sessionStatus === "loading") return;
    void permissionStore.syncSession(currentSessionKey);
  }, [currentSessionKey, sessionStatus]);

  const belongsToCurrentSession =
    currentSessionKey !== null && storeSnapshot.sessionKey === currentSessionKey;
  const current = belongsToCurrentSession ? storeSnapshot : EMPTY_SNAPSHOT;
  const loading =
    sessionStatus === "loading" ||
    (sessionStatus === "authenticated" &&
      (!belongsToCurrentSession || current.status === "idle" || current.status === "loading"));
  const status: PermissionStatus = loading ? "loading" : current.status;
  const me = status === "ready" ? current.me : null;

  return {
    me,
    status,
    loading,
    error: status === "error" ? current.error : null,
    can: (permission: string) => (me ? grants(me.permissions, permission) : false),
    canAny: (permissions: readonly string[]) =>
      me ? permissions.some((permission) => grants(me.permissions, permission)) : false,
  };
}

/** Refetches now and notifies every mounted permission consumer. */
export function invalidatePermissions() {
  return permissionStore.invalidate();
}

/** Clears permissions synchronously; call before ending or replacing a session. */
export function clearPermissions() {
  permissionStore.clear();
}

/** @deprecated Use `invalidatePermissions()` or `clearPermissions()` explicitly. */
export function forgetPermissions() {
  clearPermissions();
}
