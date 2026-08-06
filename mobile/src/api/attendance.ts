import { request } from "./client";

/**
 * Attendance, as the app sees it.
 *
 * `nextAction` is computed on the server rather than derived here from the two
 * timestamps. The rule — no record means check in, a check-in without a
 * check-out means check out, both means done — belongs next to the rows it
 * describes; deriving it a second time on the client is how the button starts
 * disagreeing with the database.
 */
export type NextAction = "checkin" | "checkout" | "done";

export interface RosterChild {
  id: string;
  name: string;
  avatarUrl: string | null;
  period: string | null;
  classId: string | null;
  className: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  nextAction: NextAction;
}

export async function fetchRoster(classId?: string): Promise<RosterChild[]> {
  const query = classId ? `?classId=${encodeURIComponent(classId)}` : "";
  const data = await request<{ children: RosterChild[] }>(
    `/api/mobile/v1/attendance/today${query}`
  );
  return data.children;
}

export interface MarkResult {
  id: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  nextAction: NextAction;
}

export async function markAttendance(
  studentId: string,
  action: "checkin" | "checkout"
): Promise<MarkResult> {
  return request<MarkResult>("/api/mobile/v1/attendance", {
    method: "POST",
    body: { studentId, action },
  });
}

/**
 * A wall-clock time in Riyadh terms.
 *
 * The server sends instants; the phone may be set to any zone. Every other
 * surface in this product shows Riyadh time, and a check-in that reads 14:00 on
 * the dashboard must not read 11:00 in the app.
 */
export function riyadhTime(iso: string | null): string {
  if (!iso) return "";
  const shifted = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000);
  const hour = shifted.getUTCHours();
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  const suffix = hour < 12 ? "ص" : "م";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}
