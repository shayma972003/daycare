import { request } from "@/api/client";

export type ArrivalNoticeResponse = {
  noticeId: string;
  message: string;
  expectedAt: string;
  recipients: number;
};

export type StaffArrivalNotice = {
  id: string;
  senderName: string;
  expectedAt: string;
  createdAt: string;
  readAt: string | null;
};

export function sendArrivalNotice() {
  return request<ArrivalNoticeResponse>("/api/mobile/v1/arrival", { method: "POST" });
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
