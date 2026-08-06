import { request } from "./client";

/**
 * What a parent's app reads.
 *
 * Every one of these is scoped on the server through `guardianChildIds` — the
 * app never sends a child id to ask "may I see this one". It asks for what it
 * is entitled to and receives exactly that.
 */

export interface Child {
  id: string;
  name: string;
  avatarUrl: string | null;
  period: string | null;
  class: { id: string; name: string } | null;
}

export interface GuardianMe {
  kind: "guardian";
  id: string;
  name: string;
  schoolName: string;
  children: Child[];
}

export async function fetchMyChildren(): Promise<GuardianMe> {
  return request<GuardianMe>("/api/mobile/v1/me");
}

export interface ChildAttendance {
  childId: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  status: string | null;
}

export async function fetchMyAttendance(): Promise<ChildAttendance[]> {
  const data = await request<{ children: ChildAttendance[] }>("/api/mobile/v1/attendance/mine");
  return data.children;
}

export interface CareEntry {
  id: string;
  type: string;
  typeLabel?: string;
  summary?: string;
  occurredAt: string;
  note: string | null;
  student: { id: string; name: string };
}

/** The feed. Returns a bare array — see the route. */
export async function fetchCareFeed(childId?: string): Promise<CareEntry[]> {
  const query = childId ? `?studentId=${encodeURIComponent(childId)}` : "";
  return request<CareEntry[]>(`/api/mobile/v1/care-reports${query}`);
}

export interface Invoice {
  id: string;
  type: string;
  amount: number;
  vatAmount: number;
  issuedAt: string;
  childId: string | null;
  childName: string | null;
}

export async function fetchInvoices(): Promise<Invoice[]> {
  const data = await request<{ invoices: Invoice[] }>("/api/mobile/v1/invoices");
  return data.invoices;
}
