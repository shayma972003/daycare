"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { grants } from "@/lib/permissions";

/**
 * The caller's permissions, for deciding what to *show*.
 *
 * Fetched rather than read from the session: the JWT carries only a role name,
 * and `requireSession()` re-reads the permission list from the database on every
 * request. A copy in the token would go stale the moment a role was edited, and
 * the product already treats drifted permissions as a reason to end the session.
 *
 * This is presentation only. Every route enforces its own requirement from
 * `route-permissions.ts`, and an unmatched path is refused by default. Hiding a
 * link the server would reject is a courtesy — it stops a user hunting for a
 * screen that will 403 — never the control itself.
 *
 * While loading, `can()` answers false. Briefly showing a short menu that fills
 * in is better than showing every entry and taking some away, which reads as the
 * product breaking.
 */
export interface Me {
  id: string;
  name: string | null;
  role: string;
  schoolName: string;
  permissions: string[];
}

let cached: Me | null = null;
let inFlight: Promise<Me | null> | null = null;

/**
 * Shared across every component that asks.
 *
 * The sidebar, the command palette and the topbar all want this on the same
 * paint; without a module-level cache that is three identical requests, each
 * paying a session re-validation.
 */
function loadMe(): Promise<Me | null> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = axios
      .get<Me>("/api/me")
      .then((response) => {
        cached = response.data;
        return cached;
      })
      .catch(() => null)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function usePermissions() {
  const [me, setMe] = useState<Me | null>(cached);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let cancelled = false;
    loadMe().then((result) => {
      if (cancelled) return;
      setMe(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    me,
    loading,
    can: (permission: string) => (me ? grants(me.permissions, permission) : false),
  };
}

/** Drops the cache so the next read re-fetches — call after changing a role. */
export function forgetPermissions() {
  cached = null;
}
