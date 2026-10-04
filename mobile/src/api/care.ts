import { request } from "@/api/client";

export type CareReportType =
  | "MEAL"
  | "NAP"
  | "TOILET"
  | "MOOD"
  | "MEDICATION"
  | "HEALTH"
  | "SUPPLIES"
  | "GENERAL";

export type GuardianCareReport = {
  id: string;
  type: CareReportType;
  typeLabel: string;
  summary: string;
  occurredAt: string;
  reportedByName: string | null;
  note: string | null;
  photoUrl: string | null;
  student: { id: string; name: string };
};

export type CareStudent = {
  id: string;
  name: string;
  classId: string | null;
  className: string | null;
  hasDailyCareReportToday?: boolean;
};

export type DailyCareEntry = {
  studentId: string;
  mealAmount: "ALL" | "HALF" | "LITTLE" | "REFUSED" | null;
  napStatus: "NO_RECORD" | "SLEPT" | "DID_NOT_SLEEP";
  napStartAt: string | null;
  napEndAt: string | null;
  toilet: "NO_RECORD" | "DIAPER_WET" | "DIAPER_SOILED" | "POTTY";
  toiletOccurredAt: string | null;
  mood: "HAPPY" | "CALM" | "TIRED" | "UPSET" | "CRYING" | "UNWELL" | null;
  note: string | null;
  extraEvents: [];
  supplies: string | null;
  health: string | null;
  medication: {
    name: string;
    dose: string;
    occurredAt: string | null;
  } | null;
};

export type DailyCarePayload = {
  idempotencyKey: string;
  meal: {
    source: "CENTER" | "HOME";
    name: string | null;
    occurredAt: string;
  };
  entries: DailyCareEntry[];
};

export type CareSubmissionStatus = "PENDING_REVIEW" | "APPROVED";
export type CareSubmissionResult = {
  created: number;
  replayed: boolean;
  status: CareSubmissionStatus;
};
export type CareReportPolicy = { reviewRequired: boolean };

export type ReturnedDailyCareBatch = {
  batchId: string;
  reviewNote: string | null;
  returnedAt: string | null;
  reportedByName: string | null;
  meal: DailyCarePayload["meal"];
  students: (CareStudent & { avatarUrl: string | null })[];
  entries: DailyCareEntry[];
};

export function loadGuardianCareReports(studentId?: string) {
  const query = studentId ? `?studentId=${encodeURIComponent(studentId)}` : "";
  return request<GuardianCareReport[]>(`/api/mobile/v1/care-reports${query}`);
}

export function loadGuardianCareReportsForDate(date: string) {
  const query = new URLSearchParams({ date });
  return request<GuardianCareReport[]>(`/api/mobile/v1/care-reports?${query.toString()}`);
}

export async function loadCareStudents(): Promise<CareStudent[]> {
  const response = await request<{ children: CareStudent[] }>("/api/mobile/v1/attendance/today");
  return response.children;
}

export function loadCareReportPolicy() {
  return request<CareReportPolicy>("/api/mobile/v1/care-reports/settings");
}

export function createDailyCareReports(payload: DailyCarePayload) {
  return request<CareSubmissionResult>("/api/mobile/v1/care-reports/daily", {
    method: "POST",
    body: payload,
  });
}

export function loadReturnedDailyCareReports() {
  return request<ReturnedDailyCareBatch[]>("/api/mobile/v1/care-reports/returned");
}

export function resubmitReturnedDailyCareReport(
  batchId: string,
  payload: DailyCarePayload
) {
  return request<CareSubmissionResult>(
    `/api/mobile/v1/care-reports/returned/${encodeURIComponent(batchId)}/resubmit`,
    { method: "POST", body: payload }
  );
}
