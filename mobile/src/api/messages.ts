import { request } from "@/api/client";

export type MobileMessage = {
  recipientId: string;
  readAt: string | null;
  id: string;
  body: string;
  createdAt: string;
  kind: "absence" | "calendar" | "activity";
  activity: { id: string; name: string } | null;
  calendarEvent: { id: string; title: string; type: string } | null;
  student: { id: string; name: string } | null;
  absenceDate: string | null;
};

export function loadMessages() {
  return request<{ messages: MobileMessage[] }>("/api/mobile/v1/messages");
}

export function markMessageRead(recipientId?: string) {
  return request<{ success: true; updated: number }>("/api/mobile/v1/messages", {
    method: "PATCH",
    body: recipientId ? { recipientId } : {},
  });
}
