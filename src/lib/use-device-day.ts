"use client";
import { useSyncExternalStore } from "react";
import { calendarToday, deviceTimeZone } from "@/lib/device-date";

function snapshot() { return `${deviceTimeZone()}|${calendarToday().toISOString().slice(0, 10)}`; }
function subscribe(change: () => void) {
  const timer = window.setInterval(change, 30_000);
  window.addEventListener("focus", change);
  document.addEventListener("visibilitychange", change);
  return () => { window.clearInterval(timer); window.removeEventListener("focus", change); document.removeEventListener("visibilitychange", change); };
}
/** Refresh date-sensitive requests after midnight or a device-zone change. */
export function useDeviceDay() { return useSyncExternalStore(subscribe, snapshot, () => ""); }
