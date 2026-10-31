import { request } from "@/api/client";

export type ArrivalNoticeResponse = {
  noticeId: string;
  message: string;
  expectedAt: string;
  cooldownUntil: string;
  recipients: number;
};

export type ArrivalMinutes = 0 | 5 | 10 | 15;

export type StaffArrivalNotice = {
  id: string;
  senderName: string;
  expectedAt: string;
  createdAt: string;
  readAt: string | null;
  message: string;
};

export function sendArrivalNotice(minutes: ArrivalMinutes) {
  return request<ArrivalNoticeResponse>("/api/mobile/v1/arrival", {
    method: "POST",
    body: { minutes },
  });
}

export function loadArrivalNotices() {
  return request<{ notices: StaffArrivalNotice[] }>("/api/mobile/v1/arrival");
}

export function acknowledgeArrivalNotice(noticeId: string) {
  return request<{ success: true }>("/api/mobile/v1/arrival", {
    method: "PATCH",
    body: { noticeId },
  });
}
